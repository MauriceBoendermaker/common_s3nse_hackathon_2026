import { ArrowRight, Check, Clock3, ExternalLink, History, RefreshCw } from 'lucide-react';
import type { AuditReport, DraftEdits } from '../../shared/types';
import { compareReports } from '../../shared/preview';
import { shortValue } from '../lib/format';
import { recordDefinitions } from '../../shared/records';

export function ComparisonPanel({
  before,
  after,
  edits,
  onVerify,
  loading,
  disabled,
  imported,
}: {
  before: AuditReport;
  after: AuditReport | null;
  edits: DraftEdits;
  onVerify: () => void;
  loading: boolean;
  disabled: boolean;
  imported: boolean;
}) {
  const comparison = after ? compareReports(before, after, edits) : null;
  return (
    <section className="comparison-panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            <History size={14} /> CLOSE THE LOOP
          </span>
          <h2>Verify what actually changed.</h2>
        </div>
      </div>
      <p className="section-description">
        Keep this snapshot as a baseline. Review your edit in ENS, then read the profile again.
        Footprint never signs or sends transactions.
      </p>
      <div className="verify-steps">
        <div>
          <span>1</span>
          <strong>Review the exact draft</strong>
          <p>Address changes alter payment destinations. Confirm every value.</p>
        </div>
        <div>
          <span>2</span>
          <strong>
            {before.mode === 'demo' ? 'Rehearse the update' : 'Make your change in ENS'}
          </strong>
          <p>
            {before.mode === 'demo'
              ? 'This scenario simulates an after-state. No real update occurs.'
              : 'Use the official ENS app and wait for your transaction to confirm.'}
          </p>
        </div>
        <div>
          <span>3</span>
          <strong>Fetch a fresh snapshot</strong>
          <p>Compare records at a newer block. Prior disclosures remain prior disclosures.</p>
        </div>
      </div>
      <div className="change-checklist">
        <h3>Your edit checklist</h3>
        {Object.entries(edits).length ? (
          Object.entries(edits).map(([id, value]) => (
            <div key={id}>
              <strong>{recordDefinitions.find((record) => record.id === id)?.label}</strong>
              <ArrowRight size={16} />
              <code>
                {value ||
                  (id.startsWith('address:')
                    ? 'Clear stored address bytes: 0x (may activate Default)'
                    : 'Clear text value')}
              </code>
            </div>
          ))
        ) : (
          <p>No draft edits selected. You can still compare the latest state.</p>
        )}
      </div>
      {Object.entries(edits).some(([id, value]) => id.startsWith('address:') && value === null) && (
        <p className="field-help">
          This draft means an empty stored byte string. Storing the 20-byte zero address is
          different: it can block fallback. Check the exact operation in ENS; a different stored
          result will not match this draft.
        </p>
      )}
      <div className="verification-actions">
        {before.mode === 'live' && (
          <a
            className="secondary-button"
            href={`https://app.ens.domains/${encodeURIComponent(before.name)}`}
            target="_blank"
            rel="noreferrer"
          >
            Review in ENS <ExternalLink size={16} />
          </a>
        )}
        <button className="primary-button" onClick={onVerify} disabled={disabled}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          {loading
            ? 'Reading the after-state…'
            : before.mode === 'demo'
              ? 'Rehearse after-state'
              : 'Re-audit & compare'}
        </button>
      </div>
      {comparison && after && (
        <>
          <div
            className={`verification-result ${comparison.verified && !imported ? 'success' : ''}`}
            role="status"
          >
            {comparison.verified && !imported ? <Check size={24} /> : <Clock3 size={24} />}
            <div>
              <strong>
                {before.mode === 'demo'
                  ? 'Synthetic comparison · rehearsal only'
                  : imported
                    ? 'Compared with an imported, unverified baseline'
                    : comparison.verified
                      ? 'Requested stored values observed at a newer block'
                      : !comparison.fresh
                        ? 'No newer block observed yet'
                        : 'Fresh snapshot received · review the differences'}
              </strong>
              <p>
                {comparison.resolverChanged
                  ? 'The resolver changed. Stored-record expectations are not certified against different resolver semantics.'
                  : 'This verifies observed state, not the sender or receipt of a particular transaction. Portfolio prices are not used to verify record changes.'}
              </p>
            </div>
          </div>
          <div className="comparison-times">
            <span>
              <History size={16} /> Before:{' '}
              {before.blockNumber ? `block ${before.blockNumber}` : 'synthetic baseline'} ·{' '}
              {new Date(before.observedAt).toLocaleTimeString()}
            </span>
            <span>
              After: {after.blockNumber ? `block ${after.blockNumber}` : 'synthetic after-state'} ·{' '}
              {new Date(after.observedAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Previously observed</th>
                  <th>Currently observed</th>
                  <th>Draft check</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.id} className={row.change}>
                    <th>
                      {row.label}
                      <small>{row.change}</small>
                    </th>
                    <td>
                      <code title={row.before || undefined}>
                        {row.before
                          ? shortValue(row.before)
                          : ['failed', 'unsupported'].includes(row.beforeStatus)
                            ? 'Unknown'
                            : 'No value returned'}
                      </code>
                      <small>
                        {row.beforeOrigin === 'default'
                          ? 'Via Default EVM'
                          : row.beforeOrigin === 'explicit'
                            ? 'Explicit record'
                            : 'Origin unverified'}
                      </small>
                    </td>
                    <td>
                      <code title={row.after || undefined}>
                        {row.after
                          ? shortValue(row.after)
                          : row.change === 'unknown'
                            ? 'Unknown'
                            : 'No value returned'}
                      </code>
                      <small>
                        {row.afterOrigin === 'default'
                          ? 'Via Default EVM'
                          : row.afterOrigin === 'explicit'
                            ? 'Explicit record'
                            : 'Origin unverified'}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge ${row.expected === 'matches' ? 'green' : row.expected === 'mismatch' ? 'amber' : ''}`}
                      >
                        {row.expected === 'not-requested' ? 'Not edited' : row.expected}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="notice">
            <History size={19} />
            <span>
              Previously observed evidence remains in this session until cleared. Removing a current
              record does not erase blockchain history, cached copies or earlier disclosures. This
              is not a full history scan.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
