import { ArrowRight, GitBranch, Info, Link2, Unlink, HelpCircle } from 'lucide-react';
import type { simulateDraft } from '../../shared/preview';
import { money, shortValue } from '../lib/format';

export function RouteResults({ preview }: { preview: ReturnType<typeof simulateDraft> }) {
  const labels = {
    new: 'Newly discoverable',
    retained: 'Still discoverable',
    removed: 'No checked route',
    unknown: 'Unknown result',
  };
  const icons = { new: ArrowRight, retained: Link2, removed: Unlink, unknown: HelpCircle };
  return (
    <section className="route-results" aria-label="Preview consequences">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            <GitBranch size={14} /> THE CONSEQUENCES
          </span>
          <h2>What changes. What stays.</h2>
        </div>
      </div>
      <p className="section-description">
        Each outcome has a reason. This measures discoverable paths within the checked scope, never
        anonymity.
      </p>
      {!preview.changed.length && (
        <div className="notice">
          <Info size={18} />
          <span>
            Make a draft edit to explore its consequences. For the fallback demo, clear the Base
            address first.
          </span>
        </div>
      )}
      <div className="route-cards">
        {preview.routes.map((route) => {
          const Icon = icons[route.status];
          return (
            <article className={`route-card ${route.status}`} key={route.id}>
              <div className="route-card-heading">
                <span className={`outcome ${route.status}`}>
                  <Icon size={16} /> {labels[route.status]}
                </span>
                <span>{route.chain}</span>
              </div>
              <code title={route.address}>{shortValue(route.address)}</code>
              <div className="route-value">
                {money(route.wallet?.totalUsd ?? null)}{' '}
                <span>
                  {route.wallet ? 'observed portfolio estimate' : 'portfolio not queried'}
                </span>
              </div>
              <ul>
                {route.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {route.wallet && (
                <small>
                  Holdings observation is independent of the ENS block. A removed path does not
                  remove these assets or earlier disclosures.
                </small>
              )}
            </article>
          );
        })}
      </div>
      {!preview.routes.length && (
        <div className="notice">
          No supported Ethereum/Base routes in this draft. This is not evidence of privacy.
        </div>
      )}
      {!!preview.unknown && (
        <div className="notice amber">
          <HelpCircle size={18} />
          <span>
            {preview.unknown} record result(s) are unknown or unsupported. No missing value is
            treated as a privacy improvement.
          </span>
        </div>
      )}
    </section>
  );
}
