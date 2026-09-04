/**
 * The evidence panel that answers "how do I know this isn't hard-coded?".
 *
 * It renders `PassportProvenance` and nothing else. That type carries no
 * portfolio values — no balances, no per-mint amounts, no USD totals — which is
 * why the SAME component can be shown to the borrower (full) and to the lender
 * (compact) without leaking anything. The lender sees that a real machine read
 * a real chain, at a measured latency, over a committed allowlist, and can
 * re-read the address themselves; the lender does not see what was found.
 *
 * Designed as instrumentation, not marketing: endpoints, milliseconds, page
 * counts, signature counts, and every warning the adapter raised.
 */

import { AlertTriangle, Check, X } from "lucide-react";

import { formatRelativeTime } from "../shared/format";
import type { HistoryConfidence, PassportProvenance } from "../shared/protocol-types";
import { StatusPill } from "./ui";

type ProvenanceStripProps = {
  provenance: PassportProvenance;
  /** Borrower-side only: how many token accounts the allowlist filtered out. */
  ignoredTokenAccounts?: number;
  /** Borrower-side only: how many allowlisted holdings were priced. */
  pricedHoldings?: number;
  /** Lender-side inbox rendering: drops the allowlist chips and the address. */
  compact?: boolean;
  /** Ticking clock, so "12s ago" ages. Pass `useNow()`. */
  now?: number;
};

const CONFIDENCE_COPY: Record<HistoryConfidence, { label: string; detail: string }> = {
  exact: {
    label: "exact",
    detail: "A page returned fewer signatures than the page size, so the first transaction was reached.",
  },
  lower_bound: {
    label: "lower bound",
    detail: "The oldest signature seen already predates the horizon, so the real age is at least this.",
  },
  indeterminate: {
    label: "indeterminate",
    detail:
      "The page cap was hit without reaching the first transaction. Account age is reported as null and fails any positive history threshold — closed, not guessed.",
  },
};

function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function ProvenanceStrip({
  provenance,
  ignoredTokenAccounts,
  pricedHoldings,
  compact = false,
  now = Date.now(),
}: ProvenanceStripProps) {
  const history = provenance.history;
  const confidence = CONFIDENCE_COPY[history.confidence];
  const allFine = provenance.sources.every((source) => source.ok);

  return (
    <section
      className={compact ? "provenance provenance--compact" : "provenance"}
      aria-label="Passport provenance"
    >
      <div className="provenance__header">
        <span className="provenance__title">
          Provenance
          <small>machine-read evidence, not a claim</small>
        </span>
        <StatusPill tone={allFine ? "success" : "danger"}>
          {allFine ? <Check size={13} /> : <AlertTriangle size={13} />}
          {provenance.sources.length} source{provenance.sources.length === 1 ? "" : "s"}
        </StatusPill>
      </div>

      <ul className="provenance-sources">
        {provenance.sources.map((source) => (
          <li
            className={source.ok ? "provenance-source" : "provenance-source is-failed"}
            key={`${source.name}-${source.endpoint}`}
          >
            <span className="provenance-source__mark" aria-hidden="true">
              {source.ok ? <Check size={12} /> : <X size={12} />}
            </span>
            <span className="provenance-source__body">
              <strong>{source.name}</strong>
              <code>{source.endpoint}</code>
              <small>{source.detail}</small>
            </span>
            <span className="provenance-source__latency">{source.latencyMs} ms</span>
          </li>
        ))}
      </ul>

      <dl className="provenance-facts">
        {!compact ? (
          <div>
            <dt>Address read</dt>
            <dd className="mono-value">{provenance.address}</dd>
          </div>
        ) : null}
        <div>
          <dt>Read cluster</dt>
          <dd>{provenance.readCluster}</dd>
        </div>
        <div>
          <dt>Settlement cluster</dt>
          <dd>{provenance.settleCluster}</dd>
        </div>
        <div>
          <dt>Fetched</dt>
          <dd>{formatRelativeTime(provenance.fetchedAt, now)}</dd>
        </div>
        <div>
          <dt>History scan</dt>
          <dd>
            {history.pagesScanned}/{history.pageCap} pages · {history.signaturesSeen} signatures
          </dd>
        </div>
        <div>
          <dt>History confidence</dt>
          <dd>
            <span
              className={
                history.confidence === "indeterminate"
                  ? "provenance-flag provenance-flag--warn"
                  : "provenance-flag"
              }
            >
              {confidence.label}
            </span>
          </dd>
        </div>
        <div>
          <dt>Horizon</dt>
          <dd>{history.horizonMonths} months</dd>
        </div>
        <div>
          <dt>Oldest signature</dt>
          <dd>
            {history.oldestBlockTime
              ? new Date(history.oldestBlockTime).toISOString().slice(0, 10)
              : "not reached"}
          </dd>
        </div>
        {typeof ignoredTokenAccounts === "number" ? (
          <div>
            <dt>Token accounts</dt>
            <dd>
              {ignoredTokenAccounts} ignored ·{" "}
              {typeof pricedHoldings === "number" ? pricedHoldings : provenance.allowlist.length}{" "}
              allowlisted and priced
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="provenance-note">{confidence.detail}</p>

      {provenance.readCluster !== provenance.settleCluster ? (
        <p className="provenance-note provenance-note--flag">
          Balances are read from <strong>{provenance.readCluster}</strong> because that is where real
          portfolios live. Settlement happens on <strong>{provenance.settleCluster}</strong> because
          this prototype moves no real value. The two clusters are deliberately different.
        </p>
      ) : null}

      {!compact ? (
        <div className="provenance-lists">
          <div>
            <span className="provenance-lists__label">
              Allowlist · {provenance.allowlist.length} mints committed in the repo
            </span>
            <div className="provenance-chips">
              {provenance.allowlist.map((entry) => (
                <span
                  className={
                    entry.qualityAsset ? "provenance-chip provenance-chip--quality" : "provenance-chip"
                  }
                  key={entry.mint}
                  title={entry.mint}
                >
                  {entry.symbol}
                  <small>{truncateMiddle(entry.mint, 4, 4)}</small>
                </span>
              ))}
            </div>
          </div>
          {provenance.denylist.length > 0 ? (
            <div>
              <span className="provenance-lists__label">
                Denylist · {provenance.denylist.length} mints
              </span>
              <div className="provenance-chips">
                {provenance.denylist.map((entry) => (
                  <span className="provenance-chip provenance-chip--deny" key={entry.mint} title={entry.mint}>
                    {entry.symbol}
                    <small>{truncateMiddle(entry.mint, 4, 4)}</small>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {provenance.warnings.length > 0 ? (
        <ul className="provenance-warnings">
          {provenance.warnings.map((warning) => (
            <li key={warning}>
              <AlertTriangle size={13} /> {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
