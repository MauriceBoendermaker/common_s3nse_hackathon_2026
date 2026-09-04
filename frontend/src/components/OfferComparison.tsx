/**
 * The marketplace, as it actually is.
 *
 * `PRODUCT_CONFIG.competingOffers` used to inject two invented lenders so the
 * screen looked like a market. They are gone. What renders here is exactly the
 * set of `Offer` rows the server returned for this request — often one, and if
 * it is one this says "one funded offer" and drops the comparison framing
 * rather than dressing a single offer up as a choice.
 */

import { Check, CircleDollarSign } from "lucide-react";

import { formatPercent, formatUsd } from "../shared/format";
import type { Offer } from "../shared/protocol-types";
import { getTotalRepayment } from "../state/types";
import { Button, StatusPill } from "./ui";

type OfferComparisonProps = {
  offers: Offer[];
  amount: number;
  termDays: number;
  selectedOfferId: string | null;
  onSelect: (offerId: string) => void;
  onAccept: (offer: Offer) => void;
  busy?: boolean;
};

export function OfferComparison({
  offers,
  amount,
  termDays,
  selectedOfferId,
  onSelect,
  onAccept,
  busy = false,
}: OfferComparisonProps) {
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? offers[0];
  const single = offers.length === 1;

  const lowestCostId = offers.reduce((lowest, offer) => {
    const total = getTotalRepayment(amount, offer.apr, termDays, offer.fee);
    const lowestTotal = getTotalRepayment(amount, lowest.apr, termDays, lowest.fee);
    return total < lowestTotal ? offer : lowest;
  }, offers[0]).id;

  return (
    <>
      <div className="offer-comparison" role="radiogroup" aria-label="Capital offers">
        {offers.map((offer) => {
          const selected = offer.id === selectedOffer.id;
          const total = getTotalRepayment(amount, offer.apr, termDays, offer.fee);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "offer-option is-selected" : "offer-option"}
              key={offer.id}
              onClick={() => onSelect(offer.id)}
            >
              <span className="offer-option__header">
                <span className="avatar" aria-hidden="true">
                  {offer.lenderLabel.charAt(0).toUpperCase()}
                </span>
                <span>
                  <strong>{offer.lenderLabel}</strong>
                  <small>Verified this request&apos;s receipt, then funded</small>
                </span>
                {!single && offer.id === lowestCostId ? (
                  <StatusPill tone="success">Lowest total</StatusPill>
                ) : null}
              </span>
              <span className="offer-option__rate">
                <strong>{formatPercent(offer.apr, 1)}</strong>
                <small>APR</small>
              </span>
              <span className="offer-option__metrics">
                <span>
                  <small>First-loss</small>
                  <strong>{formatUsd(offer.deposit)}</strong>
                </span>
                <span>
                  <small>Maturity</small>
                  <strong>{termDays} days</strong>
                </span>
                <span>
                  <small>Fee</small>
                  <strong>{formatUsd(offer.fee)}</strong>
                </span>
                <span>
                  <small>Total repayment</small>
                  <strong>{formatUsd(Math.round(total))}</strong>
                </span>
              </span>
              <span className="offer-option__note">
                {selected ? <Check size={14} /> : <CircleDollarSign size={14} />}
                {offer.note || "No note attached"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="task-card__action task-card__action--flush">
        <span className="action-note">
          {single ? "One offer so far." : `${offers.length} offers. Lowest total cost is marked.`}
        </span>
        <Button
          onClick={() => onAccept(selectedOffer)}
          disabled={busy}
          icon={<Check size={16} />}
        >
          Accept {selectedOffer.lenderLabel}
        </Button>
      </div>
    </>
  );
}
