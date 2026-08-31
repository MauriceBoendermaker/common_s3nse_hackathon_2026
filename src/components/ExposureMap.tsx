import { Fingerprint, Layers3, ArrowRight, Database } from 'lucide-react';
import type { AuditReport } from '../../shared/types';
import { money, shortValue } from '../lib/format';
import { RecordIcon } from './RecordIcon';

export function ExposureMap({
  report,
  selectedId,
  onSelect,
}: {
  report: AuditReport;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="exposure-graph" aria-label="Public exposure map">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">FOLLOW THE EVIDENCE</span>
          <h2>Your name is the starting point.</h2>
        </div>
        <span className="badge">{report.mode === 'demo' ? 'Synthetic' : 'Observed'} links</span>
      </div>
      <div className="graph-layout">
        <button
          className={`graph-identity ${selectedId === 'identity' ? 'selected' : ''}`}
          onClick={() => onSelect('identity')}
          aria-pressed={selectedId === 'identity'}
        >
          <span>
            <Fingerprint size={38} />
          </span>
          <strong>{report.name}</strong>
          <small>Public ENS identity</small>
          <span className="badge">{report.records.length} populated records</span>
        </button>
        <div className="graph-paths">
          {report.records.map((record) => {
            const wallet = report.wallets.find((item) => item.recordIds.includes(record.id));
            return (
              <div className="graph-path" key={record.id}>
                <button
                  className={`graph-record ${selectedId === record.id ? 'selected' : ''}`}
                  onClick={() => onSelect(record.id)}
                  aria-pressed={selectedId === record.id}
                >
                  <span className={`node-icon ${record.kind}`}>
                    <RecordIcon record={record} size={19} />
                  </span>
                  <span>
                    <small>{record.label}</small>
                    <strong title={record.value}>{shortValue(record.value)}</strong>
                    {record.origin === 'default' && <em>via Default EVM</em>}
                  </span>
                </button>
                {wallet ? (
                  <>
                    <ArrowRight className="path-arrow" size={18} />
                    <button
                      className={`graph-holding ${selectedId === `wallet:${wallet.id}` ? 'selected' : ''}`}
                      onClick={() => onSelect(`wallet:${wallet.id}`)}
                      aria-pressed={selectedId === `wallet:${wallet.id}`}
                    >
                      <Layers3 size={19} />
                      <span>
                        <small>
                          {wallet.status === 'ready'
                            ? `${wallet.assets.length}${wallet.truncated ? '+' : ''} assets observed`
                            : 'Holdings unknown'}
                        </small>
                        <strong>{money(wallet.totalUsd)}</strong>
                      </span>
                    </button>
                  </>
                ) : (
                  <span className="path-description">
                    {record.id === 'address:default'
                      ? 'Default for EVM chain resolution'
                      : record.chain === 'Solana'
                        ? 'Raw bytes · no portfolio scan'
                        : 'Public declaration'}
                  </span>
                )}
              </div>
            );
          })}
          {!report.records.length && (
            <div className="graph-empty">
              <Database size={26} />
              <strong>No populated records returned</strong>
              <p>
                {report.coverage.failedKeys.length
                  ? 'Some lookups failed. Those records remain unknown.'
                  : 'No values in the checked records. Other connections may exist.'}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="graph-footer">
        <span>
          <i className="legend-dot green" /> ENS record
        </span>
        <span>
          <i className="legend-dot blue" /> Mobula holdings
        </span>
        <span>Declared links do not prove account ownership.</span>
      </div>
    </section>
  );
}
