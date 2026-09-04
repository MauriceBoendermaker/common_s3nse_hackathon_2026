/**
 * Step 2 — the passport, with its evidence attached.
 *
 * BORROWER-ONLY. This is one of exactly two components in the app that render a
 * `Witness`, and both live under `borrower/`. Nothing here is passed anywhere:
 * the values are read from the context and painted.
 */

import { ArrowLeft, ArrowRight, Database, EyeOff, LockKeyhole } from "lucide-react";

import { ProvenanceStrip } from "../components/ProvenanceStrip";
import { Button, Card, StatusPill } from "../components/ui";
import { formatPercent, formatTokenAmount, formatUsd } from "../shared/format";
import { shortHash } from "../shared/policy";
import { useNow } from "../state/useNow";
import { useWitness } from "./witnessStore";

export function PassportReview({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const witness = useWitness();
  const now = useNow(1000);
  const passport = witness.passport;

  if (!passport || !witness.commitment) return null;

  const { assets, collateralQuality, historyMonths, restrictedExposure } = passport.witness;
  const historyUnknown = historyMonths === null;

  return (
    <Card className="task-card">
      <div className="task-card__heading">
        <span className="task-icon">
          <Database size={22} />
        </span>
        <div>
          <span className="section-label">Step 2 · Passport</span>
          <h2>Your private passport</h2>
          <p>Four values from your live balances. They stay in this tab; only their hash is listed.</p>
        </div>
      </div>

      <div className="witness-grid">
        <div>
          <span>Allowlisted collateral</span>
          <strong>{formatUsd(assets)}</strong>
          <small>Sum of allowlisted mints, priced with liquidity</small>
        </div>
        <div>
          <span>Collateral quality</span>
          <strong>{formatPercent(collateralQuality, 1)}</strong>
          <small>Share held in stables and liquid staking tokens</small>
        </div>
        <div className={historyUnknown ? "is-flagged" : undefined}>
          <span>Account history</span>
          <strong>{historyUnknown ? "cannot establish" : `${historyMonths} months`}</strong>
          <small>
            {historyUnknown
              ? "The bounded signature scan hit its page cap without reaching the first transaction. This fails ANY positive history threshold — it is not silently read as 'old enough'. Every policy on offer sets one, so this address cannot reach an eligible verdict; a lower-activity account (under ten thousand lifetime signatures) reads as exact."
              : "From a bounded backwards scan of the signature history"}
          </small>
        </div>
        <div className={restrictedExposure ? "is-flagged" : undefined}>
          <span>Restricted exposure</span>
          <strong>{restrictedExposure ? "Yes" : "No"}</strong>
          <small>
            {restrictedExposure
              ? "A denylisted mint is held with a non-zero balance"
              : "No denylisted mint held with a non-zero balance"}
          </small>
        </div>
      </div>

      <div className="commitment-panel">
        <div>
          <span className="section-label">Passport commitment</span>
          <strong className="mono-value">{witness.commitment}</strong>
          <small>
            Poseidon(assets, collateralQuality, historyMonths, restrictedExposure, salt) — computed here,
            in this tab, from the four values above and a 32-byte salt generated once for this passport.
          </small>
        </div>
        <StatusPill tone="dark">
          <LockKeyhole size={13} /> {shortHash(witness.commitment)}
        </StatusPill>
      </div>

      <p className="commitment-note">
        <strong>This is published with the request, before any lender issues a policy.</strong> That
        ordering is the whole mechanism: an applicant who could re-derive the commitment after seeing the
        thresholds would simply pick numbers that fit, and the proof would prove nothing. Re-reading the
        address generates a new salt and a new commitment — and a new request.
      </p>

      <div className="proof-section-heading">
        <span>
          <Database size={15} /> Allowlisted holdings
        </span>
        <small>
          {passport.holdings.length} priced · {passport.ignoredTokenAccounts} token accounts ignored
        </small>
      </div>

      {passport.holdings.length > 0 ? (
        <div className="holdings-table" role="table" aria-label="Allowlisted holdings">
          <div className="holdings-table__row holdings-table__head" role="row">
            <span role="columnheader">Symbol</span>
            <span role="columnheader">Amount</span>
            <span role="columnheader">USD value</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Counts to quality</span>
          </div>
          {passport.holdings.map((holding) => (
            <div className="holdings-table__row" role="row" key={holding.mint}>
              <span role="cell" data-label="Symbol">
                <strong>{holding.symbol}</strong>
              </span>
              <span role="cell" data-label="Amount">
                {formatTokenAmount(holding.amount)}
              </span>
              <span role="cell" data-label="USD value">
                {formatUsd(holding.usdValue)}
              </span>
              <span role="cell" data-label="Price">
                {holding.priceUsd.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 4,
                })}
              </span>
              <span role="cell" data-label="Counts to quality">
                {holding.qualityAsset ? "yes" : "no"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="inline-state">
          <EyeOff size={19} />
          <div>
            <strong>No allowlisted holdings</strong>
            <span>
              This account holds nothing from the nine committed mints. The passport is still real — it
              just reads zero, and will fail any positive asset threshold.
            </span>
          </div>
        </div>
      )}

      <div className="provenance-mount">
        <ProvenanceStrip
          provenance={passport.provenance}
          ignoredTokenAccounts={passport.ignoredTokenAccounts}
          pricedHoldings={passport.holdings.length}
          now={now}
        />
      </div>

      <div className="task-card__action">
        <Button variant="quiet" onClick={onBack} icon={<ArrowLeft size={15} />}>
          Read again
        </Button>
        <Button onClick={onContinue} icon={<ArrowRight size={16} />}>
          Continue to terms
        </Button>
      </div>
    </Card>
  );
}
