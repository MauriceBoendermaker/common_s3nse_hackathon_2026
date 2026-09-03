import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDollarSign,
  Database,
  FileKey2,
  Fingerprint,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { formatCurrency, PRODUCT_CONFIG } from "../config/product";
import {
  getCapitalOffers,
  getPolicyFingerprint,
  type DemoState,
  type SourceId,
  type WalletActionKind,
} from "../state/demo";
import { FlowSteps } from "./FlowSteps";
import { LoanLifecycle } from "./LoanLifecycle";
import { OfferComparison } from "./OfferComparison";
import { PrivacyBoundary } from "./PrivacyBoundary";
import { ProofReceipt } from "./ProofReceipt";
import { Button, Card, Spinner, StatusPill } from "./ui";

type BorrowerViewProps = {
  demo: DemoState;
  setDemo: Dispatch<SetStateAction<DemoState>>;
  onWalletAction: (kind: WalletActionKind) => void;
  onOpenLender: () => void;
};

const applicantSteps = [
  { label: "Verify ENS identity", description: "Confirm name control" },
  { label: "Build passport", description: "Connect financial sources" },
  { label: "Publish request", description: "Share the loan terms" },
  { label: "Create policy proof", description: "Answer a provider challenge" },
  { label: "Compare offers", description: "Choose transparent terms" },
  { label: "Manage loan", description: "Draw and repay USDC" },
] as const;

const amountOptions = [25_000, 50_000, 100_000];
const termOptions = [30, 60, 90];

function getApplicantStep(demo: DemoState) {
  if (!demo.identityConfirmed) return 0;
  if (!demo.passportReady) return 1;
  if (!demo.requestPublished) return 2;
  if (!demo.offersAvailable && !demo.noQualifyingOffers) return 3;
  if (demo.offerStatus !== "accepted") return 4;
  return 5;
}

export function BorrowerView({ demo, setDemo, onWalletAction, onOpenLender }: BorrowerViewProps) {
  const currentStep = getApplicantStep(demo);
  const connectedSources = new Set(demo.connectedSources);
  const requiredSourcesConnected = PRODUCT_CONFIG.passportSources
    .filter((source) => source.required)
    .every((source) => connectedSources.has(source.id));
  const offers = getCapitalOffers(demo);
  const selectedOffer = offers.find((offer) => offer.id === demo.selectedOfferId) ?? offers[0];

  const toggleSource = (sourceId: SourceId) => {
    setDemo((current) => {
      const alreadyConnected = current.connectedSources.includes(sourceId);
      return {
        ...current,
        sourceUnavailable: sourceId === "lending" ? false : current.sourceUnavailable,
        connectedSources: alreadyConnected
          ? current.connectedSources.filter((id) => id !== sourceId)
          : [...current.connectedSources, sourceId],
      };
    });
  };

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Credit applicant</span>
          <h1>Request credit without exposing your portfolio.</h1>
        </div>
        <StatusPill tone={demo.requestPublished ? "success" : "neutral"}>
          {demo.requestPublished ? <Check size={14} /> : <span className="network-dot" />}
          {demo.requestPublished ? "Request live" : "Private draft"}
        </StatusPill>
      </header>

      <div className="workflow-shell">
        <aside className="workflow-sidebar">
          <div className="workflow-sidebar__intro">
            <span className="avatar avatar--ens" aria-hidden="true">A</span>
            <div>
              <strong>{PRODUCT_CONFIG.borrower.ensName}</strong>
              <span>{demo.identityConfirmed ? "ENS identity verified" : demo.applicantWalletConnected ? "Wallet connected" : "Not connected"}</span>
            </div>
          </div>
          <FlowSteps steps={applicantSteps} currentStep={currentStep} />
          <div className="sidebar-proof-note">
            <span className="zk-mark" aria-hidden="true">ZK</span>
            <p><strong>Nothing raw is published.</strong> Only policy results reach the intended capital provider.</p>
          </div>
        </aside>

        <main className="workflow-main">
          {currentStep === 0 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><Fingerprint size={22} /></span>
                <div>
                  <span className="section-label">Step 1 of 6</span>
                  <h2>Verify the ENS identity</h2>
                  <p>Confirm that this wallet controls the name before attaching a private passport commitment.</p>
                </div>
              </div>

              {!demo.applicantWalletConnected ? (
                <div className="identity-preview">
                  <div>
                    <span className="avatar avatar--large" aria-hidden="true">A</span>
                    <span><strong>{PRODUCT_CONFIG.borrower.ensName}</strong><small>Controller and resolved address will be checked</small></span>
                  </div>
                  <StatusPill tone="warning">Awaiting wallet</StatusPill>
                </div>
              ) : (
                <div className="identity-record">
                  <div className="identity-record__title">
                    <span className="avatar avatar--large" aria-hidden="true">A</span>
                    <span><strong>{PRODUCT_CONFIG.borrower.ensName}</strong><small>Forward and reverse resolution match</small></span>
                    <StatusPill tone="success"><ShieldCheck size={14} /> Controller verified</StatusPill>
                  </div>
                  <dl className="identity-details">
                    <div><dt>Resolved wallet</dt><dd>{PRODUCT_CONFIG.borrower.walletAddress}</dd></div>
                    <div><dt>Passport commitment</dt><dd>{PRODUCT_CONFIG.borrower.passportCommitment}</dd></div>
                    <div><dt>Recovery model</dt><dd>Underlying proving wallet can rotate</dd></div>
                  </dl>
                </div>
              )}

              <div className="task-card__action">
                <span className="action-note"><KeyRound size={15} /> Identity check only; no asset approval</span>
                {demo.applicantWalletConnected ? (
                  <Button onClick={() => setDemo((current) => ({ ...current, identityConfirmed: true }))} icon={<ArrowRight size={16} />}>Confirm ENS identity</Button>
                ) : (
                  <Button onClick={() => onWalletAction("connect-applicant")} icon={<WalletCards size={16} />}>Connect MetaMask</Button>
                )}
              </div>
            </Card>
          ) : null}

          {currentStep === 1 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><Database size={22} /></span>
                <div>
                  <span className="section-label">Step 2 of 6</span>
                  <h2>Build the private passport</h2>
                  <p>Select the sources used for underwriting. Raw records remain inside the proving environment.</p>
                </div>
              </div>

              <div className="source-grid">
                {PRODUCT_CONFIG.passportSources.map((source) => {
                  const sourceId = source.id as SourceId;
                  const connected = connectedSources.has(sourceId);
                  const unavailable = sourceId === "lending" && demo.sourceUnavailable;
                  return (
                    <article className={unavailable ? "source-card source-card--error" : connected ? "source-card is-connected" : "source-card"} key={source.id}>
                      <div className="source-card__header">
                        <span className="source-icon"><Database size={17} /></span>
                        <span><strong>{source.name}</strong><small>{source.provider}</small></span>
                        <StatusPill tone={unavailable ? "danger" : connected ? "success" : "neutral"}>
                          {unavailable ? "Unavailable" : connected ? "Connected" : source.required ? "Required" : "Optional"}
                        </StatusPill>
                      </div>
                      <div className="chain-list">{source.chains.map((chain) => <span key={chain}>{chain}</span>)}</div>
                      <p>{source.permission}</p>
                      <div className="source-card__footer">
                        <small>{connected ? "Updated just now" : "Not yet authorized"}</small>
                        <button type="button" className="text-button" disabled={connected && sourceId === "wallets"} onClick={() => toggleSource(sourceId)}>
                          {unavailable ? "Retry" : connected && sourceId !== "wallets" ? "Disconnect" : connected ? "Connected" : "Connect"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="compute-boundary">
                <ServerCog size={19} />
                <div><strong>Computation boundary</strong><span>This demo evaluates mock source data in the browser. Production proving would run locally or in an attested private environment.</span></div>
                <StatusPill tone="warning">Frontend simulation</StatusPill>
              </div>

              {demo.sourceUnavailable ? (
                <div className="inline-state inline-state--danger" role="alert">
                  <AlertTriangle size={18} />
                  <div><strong>Lending source unavailable</strong><span>The passport cannot be finalized until the required source responds.</span></div>
                  <Button variant="secondary" onClick={() => toggleSource("lending")} icon={<RefreshCw size={15} />}>Retry source</Button>
                </div>
              ) : null}

              <div className="task-card__action">
                <button type="button" className="text-button text-button--danger" onClick={() => setDemo((current) => ({ ...current, sourceUnavailable: true, connectedSources: current.connectedSources.filter((id) => id !== "lending") }))}>Preview source outage</button>
                <Button disabled={!requiredSourcesConnected} onClick={() => setDemo((current) => ({ ...current, passportReady: true }))} icon={<ArrowRight size={16} />}>Finalize passport</Button>
              </div>
            </Card>
          ) : null}

          {currentStep === 2 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><CircleDollarSign size={22} /></span>
                <div>
                  <span className="section-label">Step 3 of 6</span>
                  <h2>Set the public loan terms</h2>
                  <p>Providers see the requested amount, duration and first-loss deposit—not the assets behind your passport.</p>
                </div>
              </div>

              <div className="terms-layout">
                <div className="form-stack">
                  <label className="form-field">
                    <span>Credit amount</span>
                    <select value={demo.amount} onChange={(event) => setDemo((current) => ({ ...current, amount: Number(event.target.value) }))}>
                      {amountOptions.map((amount) => <option value={amount} key={amount}>{formatCurrency(amount)} USDC</option>)}
                    </select>
                  </label>
                  <fieldset className="form-field">
                    <legend>Loan term</legend>
                    <div className="segmented-options">
                      {termOptions.map((days) => (
                        <button type="button" key={days} className={demo.termDays === days ? "is-selected" : undefined} aria-pressed={demo.termDays === days} onClick={() => setDemo((current) => ({ ...current, termDays: days }))}>{days} days</button>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div className="terms-summary">
                  <span className="section-label">Public request</span>
                  <strong>{formatCurrency(demo.amount)}</strong>
                  <dl>
                    <div><dt>Asset</dt><dd>USDC</dd></div>
                    <div><dt>Term</dt><dd>{demo.termDays} days</dd></div>
                    <div><dt>First-loss deposit</dt><dd>{formatCurrency(demo.collateral)}</dd></div>
                    <div><dt>Private data disclosed</dt><dd>None</dd></div>
                  </dl>
                </div>
              </div>

              <div className="task-card__action">
                <Button variant="quiet" onClick={() => setDemo((current) => ({ ...current, passportReady: false }))} icon={<ArrowLeft size={15} />}>Edit sources</Button>
                <Button onClick={() => onWalletAction("publish-request")} icon={<ArrowRight size={16} />}>Publish request</Button>
              </div>
            </Card>
          ) : null}

          {currentStep === 3 ? (
            <Card className="task-card proof-task-card">
              <div className="task-card__heading">
                <span className="task-icon task-icon--zk" aria-hidden="true">ZK</span>
                <div>
                  <span className="section-label">Step 4 of 6</span>
                  <h2>{demo.challengePolicy ? "Answer the provider’s policy challenge" : "Waiting for an underwriting policy"}</h2>
                  <p>{demo.challengePolicy ? "The proof is bound to this policy hash and intended provider, so it cannot be replayed for different terms." : "A provider must define its requirements before you generate a useful proof."}</p>
                </div>
              </div>

              {!demo.challengePolicy ? (
                <div className="waiting-state">
                  <span className="waiting-pulse" aria-hidden="true" />
                  <div><strong>Request published</strong><span>No policy challenge has been received yet.</span></div>
                  <Button variant="secondary" onClick={onOpenLender} icon={<ArrowRight size={16} />}>Open provider workspace</Button>
                </div>
              ) : (
                <>
                  <div className="policy-summary">
                    <div><span>Requested by</span><strong>{PRODUCT_CONFIG.lender.ensName}</strong></div>
                    <div><span>Policy hash</span><strong className="mono-value">{getPolicyFingerprint(demo.challengePolicy)}</strong></div>
                    <div><span>Minimum assets</span><strong>{formatCurrency(demo.challengePolicy.minimumAssets)}</strong></div>
                    <div><span>Maximum debt ratio</span><strong>{demo.challengePolicy.maximumDebtRatio}%</strong></div>
                    <div><span>Minimum history</span><strong>{demo.challengePolicy.minimumHistoryMonths} months</strong></div>
                    <div><span>Exposure screen</span><strong>{demo.challengePolicy.screenRestrictedExposure ? "Required" : "Not required"}</strong></div>
                  </div>

                  {demo.proofStatus === "generating" ? (
                    <div className="generating-state" role="status" aria-live="polite"><Spinner /><div><strong>Generating policy-bound proof</strong><span>Building witness → applying policy → sealing public outputs</span></div></div>
                  ) : demo.proofStatus === "ready" || demo.proofStatus === "expired" ? (
                    <ProofReceipt policy={demo.challengePolicy} status={demo.proofStatus} />
                  ) : demo.proofStatus === "failed" ? (
                    <div className="inline-state inline-state--danger" role="alert">
                      <AlertTriangle size={19} /><div><strong>Proof generation failed</strong><span>The local proving session ended before a receipt was created. No private inputs were sent.</span></div>
                      <Button variant="secondary" onClick={() => setDemo((current) => ({ ...current, proofStatus: "generating" }))} icon={<RefreshCw size={15} />}>Retry</Button>
                    </div>
                  ) : <PrivacyBoundary compact />}

                  <div className="task-card__action">
                    {demo.proofStatus === "ready" ? (
                      <button type="button" className="text-button text-button--danger" onClick={() => setDemo((current) => ({ ...current, proofStatus: "expired" }))}>Preview expired proof</button>
                    ) : demo.proofStatus === "idle" ? (
                      <button type="button" className="text-button text-button--danger" onClick={() => setDemo((current) => ({ ...current, proofStatus: "failed" }))}>Preview proving failure</button>
                    ) : <span className="action-note"><LockKeyhole size={15} /> Exact source data stays hidden</span>}
                    {demo.proofStatus === "ready" ? (
                      <Button onClick={onOpenLender} icon={<ArrowRight size={16} />}>Return proof to provider</Button>
                    ) : (
                      <Button disabled={demo.proofStatus === "generating"} onClick={() => setDemo((current) => ({ ...current, proofStatus: "generating", verificationStatus: "idle", noQualifyingOffers: false }))} icon={demo.proofStatus === "generating" ? <Spinner /> : <FileKey2 size={16} />}>
                        {demo.proofStatus === "generating" ? "Generating proof" : demo.proofStatus === "expired" ? "Generate fresh proof" : "Generate ZK proof"}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {currentStep === 4 ? (
            <Card className="task-card market-card">
              <div className="task-card__heading">
                <span className={demo.noQualifyingOffers ? "task-icon task-icon--danger" : "task-icon"}>{demo.noQualifyingOffers ? <AlertTriangle size={22} /> : <CircleDollarSign size={22} />}</span>
                <div>
                  <span className="section-label">Step 5 of 6</span>
                  <h2>{demo.noQualifyingOffers ? "No qualifying offers" : "Compare capital offers"}</h2>
                  <p>{demo.noQualifyingOffers ? "The proof did not satisfy the active policy. Exact values remain private." : "Compare the full cost and first-loss requirement before accepting."}</p>
                </div>
              </div>

              {demo.noQualifyingOffers ? (
                <div className="empty-state-panel">
                  <AlertTriangle size={22} /><div><strong>Policy requirements were not met</strong><span>The provider only received failed public outputs—never the values that caused them.</span></div>
                  <Button variant="secondary" onClick={() => setDemo((current) => ({ ...current, noQualifyingOffers: false, challengePolicy: null, proofStatus: "idle", verificationStatus: "idle" }))}>Request another policy</Button>
                </div>
              ) : (
                <OfferComparison offers={offers} amount={demo.amount} termDays={demo.termDays} selectedOfferId={demo.selectedOfferId} onSelect={(selectedOfferId) => setDemo((current) => ({ ...current, selectedOfferId }))} onAccept={() => onWalletAction("accept-offer")} />
              )}
            </Card>
          ) : null}

          {currentStep === 5 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><Link2 size={22} /></span>
                <div><span className="section-label">Step 6 of 6</span><h2>Manage the loan lifecycle</h2><p>The selected terms remain visible from funding through repayment.</p></div>
              </div>
              <LoanLifecycle amount={demo.amount} termDays={demo.termDays} offer={selectedOffer} status={demo.loanStatus} role="applicant" onDraw={() => onWalletAction("draw-loan")} onRepay={() => onWalletAction("repay-loan")} onAdvanceDue={() => setDemo((current) => ({ ...current, loanStatus: "repayment_due" }))} onShowDefaultRisk={() => setDemo((current) => ({ ...current, loanStatus: "default_risk" }))} />
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  );
}
