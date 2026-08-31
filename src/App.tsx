import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CircleHelp,
  Fingerprint,
  FlaskConical,
  Globe,
  History,
  Info,
  LoaderCircle,
  Monitor,
  Network,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AuditReport,
  DraftEdits,
  ProviderHealth,
  WalletActivity,
  WalletExposure,
} from '../shared/types';
import { knownValue } from '../shared/types';
import { sameRecordSnapshot, simulateDraft, statesFor } from '../shared/preview';
import { parseSnapshot } from '../shared/snapshot';
import { getActivity, getAudit, getDemo, getDemoAfter, getHealth, getPreview } from './lib/api';
import { exportReport, money, shortValue } from './lib/format';
import { ExposureMap } from './components/ExposureMap';
import { EvidencePanel } from './components/EvidencePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { RouteResults } from './components/RouteResults';
import { ComparisonPanel } from './components/ComparisonPanel';
import { InfoDialog } from './components/InfoDialog';

type View = 'map' | 'preview' | 'compare';
type Work = 'audit' | 'preview' | 'verify' | 'activity' | null;
const views = [
  { id: 'map' as const, label: 'Exposure map', icon: Network },
  { id: 'preview' as const, label: 'Publishing preview', icon: FlaskConical },
  { id: 'compare' as const, label: 'Verify a change', icon: History },
];
const walletKey = (wallet: WalletExposure) => `${wallet.chain}:${wallet.address.toLowerCase()}`;

export function App() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [after, setAfter] = useState<AuditReport | null>(null);
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [work, setWork] = useState<Work>('audit');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('address:base');
  const [view, setView] = useState<View>('map');
  const [edits, setEdits] = useState<DraftEdits>({});
  const [enrichment, setEnrichment] = useState<WalletExposure[]>([]);
  const [activities, setActivities] = useState<Record<string, WalletActivity>>({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [imported, setImported] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function acceptReport(next: AuditReport) {
    setReport(next);
    setAfter(null);
    setEdits({});
    setEnrichment([]);
    setActivities({});
    setImported(false);
    setNotice('');
    setSelectedId(next.records[0]?.id || 'identity');
    setView('map');
  }
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void getDemo(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) acceptReport(next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load the demo.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setWork(null);
      });
    void getHealth(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setHealth(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function cancelWork() {
    controllerRef.current?.abort();
    setWork(null);
  }
  async function perform(
    kind: Exclude<Work, null>,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWork(kind);
    setError('');
    setNotice('');
    try {
      await action(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'The request could not be completed.');
    } finally {
      if (!controller.signal.aborted) {
        setWork(null);
        void getHealth()
          .then(setHealth)
          .catch(() => {});
      }
    }
  }
  function assertConsent() {
    if (report?.mode === 'live' && !consent)
      throw new Error(
        'Acknowledge the ownership/permission and provider disclosure above before a live lookup.',
      );
  }
  function updateEdits(next: DraftEdits) {
    cancelWork();
    setEdits(next);
    setAfter(null);
    setEnrichment([]);
    setNotice('');
    setError('');
  }
  function chooseMode(next: 'demo' | 'live') {
    if (next !== mode) {
      cancelWork();
      setMode(next);
      setConsent(false);
      setError('');
      setNotice('');
    }
  }
  async function audit() {
    await perform('audit', async (signal) => {
      if (mode === 'live' && !consent)
        throw new Error('Confirm permission and the provider disclosure first.');
      const next =
        mode === 'demo' ? await getDemo(signal) : await getAudit(name.trim(), consent, signal);
      if (!signal.aborted) acceptReport(next);
    });
  }
  async function enrichDraft() {
    if (!report) return;
    await perform('preview', async (signal) => {
      assertConsent();
      if (imported && report.mode === 'live')
        throw new Error(
          'Run a fresh live audit before querying a draft based on an imported snapshot.',
        );
      const result = await getPreview(report, edits, signal);
      if (signal.aborted) return;
      if (!sameRecordSnapshot(report, result.basedOn))
        throw new Error(
          'The ENS profile or its evidence coverage changed since your baseline. Run a new audit and review the draft again; the original snapshot is unchanged.',
        );
      setEnrichment(result.wallets);
      setNotice(
        'Draft wallet evidence loaded. Your original snapshot is unchanged; portfolio observations have their own fetch times.',
      );
    });
  }
  async function verify() {
    if (!report) return;
    await perform('verify', async (signal) => {
      assertConsent();
      const next =
        report.mode === 'demo'
          ? await getDemoAfter(
              edits,
              signal,
              report.records.some((record) => record.id === 'address:default')
                ? 'fallback'
                : 'classic',
            )
          : await getAudit(report.name, true, signal);
      if (!signal.aborted) setAfter(next);
    });
  }
  async function loadActivity(wallet: WalletExposure) {
    if (!report || report.mode === 'demo') return;
    await perform('activity', async (signal) => {
      assertConsent();
      const activity = await getActivity(report.name, wallet.address, wallet.chain, signal);
      if (!signal.aborted)
        setActivities((current) => ({ ...current, [walletKey(wallet)]: activity }));
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    cancelWork();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      if (file.size > 500_000) throw new Error('Snapshot exceeds the 500 KB import limit.');
      const raw = await file.text();
      if (controller.signal.aborted) return;
      const result = parseSnapshot(raw);
      acceptReport(result.report);
      setEdits(result.edits);
      setMode(result.report.mode);
      setName(result.report.name);
      setConsent(false);
      setImported(true);
      setError('');
      setNotice(
        'Imported locally. File contents and provenance claims are unverified; nothing was sent to a provider.',
      );
    } catch {
      setError(
        'Could not import this snapshot. Use a valid Footprint JSON export under 500 KB. The current report is unchanged.',
      );
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  function clearSession() {
    cancelWork();
    setReport(null);
    setAfter(null);
    setEdits({});
    setEnrichment([]);
    setActivities({});
    setName('');
    setConsent(false);
    setImported(false);
    setError('');
    setNotice(
      'Session evidence cleared from this page. Exported files and provider records are not deleted.',
    );
  }

  const preview = report ? simulateDraft(report, edits, enrichment) : null;
  const selectedWallet = report?.wallets.find((wallet) => `wallet:${wallet.id}` === selectedId);
  const currentActivity = selectedWallet
    ? activities[walletKey(selectedWallet)] || selectedWallet.activity
    : undefined;
  const liveAllowed = report?.mode !== 'live' || consent;

  return (
    <div className={`app-shell enhanced ${presentation ? 'presentation' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Footprint home">
          <Fingerprint size={29} />
          <span>
            footprint<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">YOUR PUBLIC IDENTITY</div>
        <nav aria-label="Workspace">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              onClick={() => setView(id)}
              disabled={!report}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>Choose deliberately.</strong>
          <p>See what you reveal before you publish. Verify what changes afterward.</p>
          <span>No signatures. No transactions.</span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setInfoOpen(true)}>
            <CircleHelp size={17} />
            Data & privacy
          </button>
          <div className="hackathon-label">
            <span className="status-dot" />
            COMMON S3NSE ’26<span>ENS × MOBULA</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            FOOTPRINT <span>/</span>
            <strong>PRIVACY PREFLIGHT</strong>
          </div>
          <div className="topbar-actions">
            <button
              className={`quiet-button ${presentation ? 'is-active' : ''}`}
              onClick={() => setPresentation(!presentation)}
              aria-pressed={presentation}
            >
              <Monitor size={17} />
              {presentation ? 'Exit presentation' : 'Present'}
            </button>
            <button className="provider-status" onClick={() => setInfoOpen(true)}>
              <span className={`status-dot ${!health ? 'amber' : ''}`} />
              {health
                ? health.access?.mode === 'restricted'
                  ? 'Controlled public demo'
                  : 'Local API connected'
                : 'Checking API'}
              <Info size={14} />
            </button>
          </div>
        </header>
        <div className="main-content">
          <div className="intro">
            <div>
              <div className="eyebrow">
                <span className="line-accent" /> KNOW WHAT YOU REVEAL
              </div>
              <h1>Your name. Your choice.</h1>
              <p>
                Understand your public connections. Preview a change. See what still gets through.
              </p>
            </div>
            <span className="read-only">
              <ShieldCheck size={16} />
              Evidence, not a privacy score
            </span>
          </div>
          <form
            className="audit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void audit();
            }}
          >
            <div className="search-row">
              <div className="mode-switch" aria-label="Data mode">
                <button
                  type="button"
                  className={mode === 'demo' ? 'active' : ''}
                  aria-pressed={mode === 'demo'}
                  onClick={() => chooseMode('demo')}
                >
                  <FlaskConical size={15} />
                  Demo
                </button>
                <button
                  type="button"
                  className={mode === 'live' ? 'active' : ''}
                  aria-pressed={mode === 'live'}
                  onClick={() => chooseMode('live')}
                >
                  <Globe size={15} />
                  Live
                </button>
              </div>
              <label className="name-field">
                <Search size={20} />
                <span className="sr-only">ENS name</span>
                <input
                  aria-label="ENS name"
                  value={mode === 'demo' ? 'mira.demo.eth' : name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={mode === 'demo'}
                  placeholder="yourname.eth"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={255}
                  required
                />
              </label>
              <button
                className="primary-button"
                disabled={Boolean(work) || (mode === 'live' && (!consent || !name.trim()))}
              >
                {work === 'audit' ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}
                {work === 'audit'
                  ? 'Reading evidence…'
                  : mode === 'demo'
                    ? 'Load demo'
                    : 'Inspect profile'}
              </button>
            </div>
            {mode === 'live' || report?.mode === 'live' ? (
              <div className="live-consent">
                <label>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => {
                      if (!event.target.checked) cancelWork();
                      setConsent(event.target.checked);
                    }}
                  />
                  I control this profile or have permission to inspect it, including any wallet I
                  add to the draft.
                </label>
                <p>
                  Live actions send names to the API/RPC and wallet addresses to Mobula. Draft
                  wallet lookups disclose addresses before anything is published onchain.
                </p>
                {health?.access?.mode === 'restricted' && (
                  <p>
                    Consenting demo profiles:{' '}
                    {health.access.allowedNames.length
                      ? health.access.allowedNames.join(', ')
                      : 'none configured; synthetic demo remains available'}
                    .
                  </p>
                )}
              </div>
            ) : (
              <p className="form-note">
                <FlaskConical size={14} />A fictional profile with a real design lesson: clearing an
                override can leave a Default route.
              </p>
            )}
          </form>
          {error && (
            <div className="error-banner" role="alert">
              <Info size={20} />
              <div>
                <strong>That action could not be completed.</strong>
                <p>{error}</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <X size={18} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Info size={18} />
              <span>{notice}</span>
            </div>
          )}
          {work && report && (
            <div className="loading-notice" role="status">
              <LoaderCircle className="spin" size={16} />
              Working on{' '}
              {work === 'verify'
                ? 'a fresh comparison'
                : work === 'activity'
                  ? 'a bounded activity sample'
                  : work === 'preview'
                    ? 'draft wallet evidence'
                    : 'a new snapshot'}
              . Existing evidence stays visible.
              <button className="quiet-button" onClick={cancelWork}>
                Cancel waiting
              </button>
            </div>
          )}
          {report && preview ? (
            <>
              <div className={`dataset-banner ${report.mode}`}>
                <div>
                  <span
                    className={`status-dot ${report.mode === 'demo' || imported ? 'amber' : ''}`}
                  />
                  <strong>
                    {imported
                      ? 'IMPORTED · UNVERIFIED'
                      : report.mode === 'demo'
                        ? 'SYNTHETIC DEMO'
                        : 'LIVE SNAPSHOT'}
                  </strong>
                  <span>
                    {report.mode === 'demo'
                      ? 'Fictional records, balances and transactions. No provider requests.'
                      : `${report.name} · ${new Date(report.observedAt).toLocaleString()}`}
                  </span>
                </div>
                <span className="dataset-tag">
                  {report.blockNumber ? `ENS block ${report.blockNumber}` : 'Safe to rehearse'}
                </span>
              </div>
              {mode !== report.mode && (
                <p className="mode-mismatch">
                  The report remains{' '}
                  {report.mode === 'demo' ? 'synthetic' : 'the previous live snapshot'} until you
                  run a new lookup.
                </p>
              )}
              <section className="metrics" aria-label="Snapshot summary">
                <div className="metric">
                  <span>
                    <Network size={16} />
                    Public records
                  </span>
                  <strong>
                    {report.records.length}
                    <small>populated lookups</small>
                  </strong>
                </div>
                <div className="metric">
                  <span>
                    <Wallet size={16} />
                    Wallet paths
                  </span>
                  <strong>
                    {report.wallets.length}
                    <small>Ethereum / Base</small>
                  </strong>
                </div>
                <div className="metric">
                  <span>
                    <Activity size={16} />
                    Observed portfolio value
                  </span>
                  <strong>
                    {money(knownValue(report.wallets))}
                    <small>
                      {report.wallets.some((wallet) => wallet.totalUsd === null)
                        ? 'partial · unknown portfolios excluded'
                        : report.mode === 'demo'
                          ? 'illustrative USD'
                          : 'provider estimate · native + tokens'}
                    </small>
                  </strong>
                </div>
                <div className="metric">
                  <span>
                    <ShieldCheck size={16} />
                    ENS reads completed
                  </span>
                  <strong>
                    {report.coverage.succeeded}
                    <span className="metric-denominator">/ {report.coverage.checked}</span>
                    <small>
                      {report.coverage.failedKeys.length
                        ? 'some records remain unknown'
                        : 'empty and populated distinguished'}
                    </small>
                  </strong>
                </div>
              </section>
              <div className="workflow-nav">
                <div className="workflow-tabs" role="tablist" aria-label="Audit workflow">
                  {views.map(({ id, label, icon: Icon }, index) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={view === id}
                      aria-controls={`panel-${id}`}
                      id={`tab-${id}`}
                      className={view === id ? 'active' : ''}
                      onClick={() => setView(id)}
                    >
                      <span>{index + 1}</span>
                      <Icon size={17} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="snapshot-actions">
                  <button
                    className="quiet-button"
                    onClick={() =>
                      exportReport({
                        format: 'footprint/2',
                        report: {
                          ...report,
                          wallets: report.wallets.map((wallet) => ({
                            ...wallet,
                            activity: activities[walletKey(wallet)] || wallet.activity,
                          })),
                        },
                        edits,
                      })
                    }
                  >
                    <ArrowDownToLine size={16} />
                    Export
                  </button>
                  <button className="quiet-button" onClick={() => fileRef.current?.click()}>
                    <Upload size={16} />
                    Import
                  </button>
                  <button className="quiet-button" onClick={clearSession}>
                    <Trash2 size={16} />
                    Clear session
                  </button>
                </div>
              </div>
              <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
                {view === 'map' && (
                  <>
                    {report.mode === 'demo' && (
                      <div className="demo-prompt">
                        <div>
                          <span className="eyebrow">A 30-SECOND EXPERIMENT</span>
                          <strong>Would clearing the Base address remove its connection?</strong>
                          <p>Try it. Follow the route that survives.</p>
                        </div>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            updateEdits({ 'address:base': null });
                            setView('preview');
                          }}
                        >
                          Preview the removal <ArrowRight size={17} />
                        </button>
                      </div>
                    )}
                    <div className="report-layout">
                      <ExposureMap
                        report={report}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                      <div>
                        <EvidencePanel
                          key={`${selectedId}:${report.observedAt}`}
                          report={report}
                          selectedId={selectedId}
                        />
                        {selectedWallet && (
                          <section className="activity-panel">
                            <div className="section-title">
                              <h3>
                                <Activity size={17} /> Observable activity
                              </h3>
                            </div>
                            <p>
                              A bounded sample of what this wallet makes public. No counterparties
                              are followed.
                            </p>
                            {currentActivity ? (
                              <>
                                <span className="badge">
                                  {currentActivity.status} · {currentActivity.windowDays} days · max{' '}
                                  {currentActivity.limit}
                                </span>
                                <ul>
                                  {currentActivity.items.map((item) => (
                                    <li key={item.hash}>
                                      <strong>
                                        {item.actions.join(' + ') || 'Onchain activity'}
                                      </strong>
                                      <span>
                                        {new Date(item.timestamp).toLocaleDateString()} ·{' '}
                                        {item.chain}
                                      </span>
                                      {report.mode === 'live' ? (
                                        <a
                                          href={`${item.chain === 'Ethereum' ? 'https://etherscan.io' : 'https://basescan.org'}/tx/${item.hash}`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {shortValue(item.hash)} ↗
                                        </a>
                                      ) : (
                                        <code>{shortValue(item.hash)} · synthetic</code>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                <p>{currentActivity.message}</p>
                                {currentActivity.truncated && (
                                  <p className="field-help">
                                    Sample may be truncated or indexing incomplete.
                                  </p>
                                )}
                              </>
                            ) : (
                              <p>
                                Activity has not been queried. Loading sends this address to Mobula.
                              </p>
                            )}
                            {report.mode === 'live' && (
                              <button
                                className="secondary-button"
                                onClick={() => void loadActivity(selectedWallet)}
                                disabled={
                                  Boolean(work) ||
                                  !liveAllowed ||
                                  health?.access?.activityEnabled === false
                                }
                              >
                                {work === 'activity'
                                  ? 'Loading…'
                                  : currentActivity
                                    ? 'Refresh activity sample'
                                    : 'Load activity sample'}
                              </button>
                            )}
                          </section>
                        )}
                      </div>
                    </div>
                    <section className="findings-section">
                      <div className="findings-heading">
                        <div>
                          <span className="eyebrow">MAKE AN INFORMED CHOICE</span>
                          <h2>What deserves your attention</h2>
                        </div>
                        <span>Original snapshot · evidence first</span>
                      </div>
                      <div className="findings-grid">
                        {report.findings.map((finding) => (
                          <article className="finding-card" key={finding.id}>
                            <span className={`finding-tone ${finding.tone}`}>
                              {finding.tone === 'attention'
                                ? 'Review this connection'
                                : 'Know the boundary'}
                            </span>
                            <h3>{finding.title}</h3>
                            <p>{finding.detail}</p>
                            <div className="finding-action">
                              <ArrowRight size={15} />
                              <span>{finding.action}</span>
                            </div>
                            <button
                              className="text-link"
                              onClick={() => {
                                setSelectedId(finding.recordIds[0] || 'identity');
                                document
                                  .getElementById('panel-map')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                            >
                              Inspect evidence <ArrowRight size={15} />
                            </button>
                          </article>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {view === 'preview' && (
                  <>
                    <div className="preview-heading">
                      <div>
                        <span className="badge amber">HYPOTHETICAL · NO ONCHAIN CHANGES</span>
                        <p>{report.resolverSupport?.label || 'Resolver semantics unknown'}</p>
                      </div>
                      <div>
                        <button
                          className="secondary-button"
                          onClick={() => void enrichDraft()}
                          disabled={
                            Boolean(work) ||
                            !liveAllowed ||
                            !!preview.errors.length ||
                            !preview.changed.length
                          }
                        >
                          {work === 'preview' ? 'Loading…' : 'Load draft wallet evidence'}
                        </button>
                        <button
                          className="primary-button"
                          onClick={() => setView('compare')}
                          disabled={!!preview.errors.length}
                        >
                          Review & verify <ArrowRight size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="draft-layout">
                      <PreviewPanel
                        report={report}
                        edits={edits}
                        onChange={updateEdits}
                        onReset={() => updateEdits({})}
                      />
                      <RouteResults preview={preview} />
                    </div>
                  </>
                )}
                {view === 'compare' && (
                  <>
                    <ComparisonPanel
                      before={report}
                      after={after}
                      edits={edits}
                      onVerify={() => void verify()}
                      loading={work === 'verify'}
                      disabled={Boolean(work) || !liveAllowed || !!preview.errors.length}
                      imported={imported}
                    />
                    {after && (
                      <button
                        className="quiet-button export-after"
                        onClick={() =>
                          exportReport({ format: 'footprint/2', report: after, edits: {} })
                        }
                      >
                        <ArrowDownToLine size={16} />
                        Export after-snapshot
                      </button>
                    )}
                  </>
                )}
              </div>
              <details className="coverage-panel">
                <summary>
                  <ShieldCheck size={18} />
                  Record coverage, resolver support & name control
                  <span>
                    {report.coverage.succeeded}/{report.coverage.checked} reads completed
                  </span>
                </summary>
                <p>
                  {report.resolverSupport?.reason || 'Stored-record provenance was not captured.'}
                </p>
                <div className="coverage-grid">
                  {statesFor(report).map((state) => (
                    <div key={state.id}>
                      <strong>{state.label}</strong>
                      <span
                        className={`badge ${state.status === 'failed' || state.status === 'unsupported' ? 'amber' : ''}`}
                      >
                        {state.status}
                      </span>
                      <p>{state.explanation}</p>
                    </div>
                  ))}
                </div>
                <h3>Name-control connections</h3>
                <p>
                  Owner/manager roles are separate from payment addresses. These connections are
                  unaffected by the record draft. Role coverage:{' '}
                  {report.controlStatus || 'unsupported'}.
                </p>
                {report.controlRecords?.map((control) => (
                  <div className="control-row" key={control.role}>
                    <strong>{control.role}</strong>
                    <code>{control.address}</code>
                    <span>{control.source}</span>
                  </div>
                ))}
                <ul>
                  {report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <section className="initial-state" role="status">
              {work ? <LoaderCircle className="spin" size={32} /> : <Fingerprint size={38} />}
              <h2>
                {work ? 'Reading the public connections…' : 'Start with a name. Find the evidence.'}
              </h2>
              <p>
                Load the synthetic demo, inspect a consenting profile, or import a saved snapshot.
              </p>
              <button className="secondary-button" onClick={() => fileRef.current?.click()}>
                <Upload size={16} />
                Import snapshot
              </button>
            </section>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Import Footprint snapshot"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
          <footer>
            <span>
              <Fingerprint size={18} />
              Built for deliberate disclosure.
            </span>
            <button onClick={() => setInfoOpen(true)}>
              Data, privacy & trust <ArrowRight size={14} />
            </button>
            <span className="footer-partners">
              ENS <span>×</span> Mobula
            </span>
          </footer>
        </div>
      </main>
      <InfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        health={health}
        onHealthChange={setHealth}
      />
    </div>
  );
}
