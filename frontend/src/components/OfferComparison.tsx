import { Check, CircleDollarSign, LockKeyhole } from "lucide-react";
import { formatCurrency } from "../config/product";
import {
  getTotalRepayment,
  type CapitalOffer,
} from "../state/demo";
import { Button, StatusPill } from "./ui";

type OfferComparisonProps = {
  offers: CapitalOffer[];
  amount: number;
  termDays: number;
  selectedOfferId: string;
  onSelect: (offerId: string) => void;
  onAccept: () => void;
};

export function OfferComparison({
  offers,
  amount,
  termDays,
  selectedOfferId,
  onSelect,
  onAccept,
}: OfferComparisonProps) {
  const totals = offers.map((offer) => ({
    id: offer.id,
    total: getTotalRepayment(amount, offer.apr, termDays, offer.fee),
  }));
  const lowestCostId = totals.reduce((lowest, item) => item.total < lowest.total ? item : lowest).id;
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? offers[0];

  return (
    <>
      <div className="offer-comparison" role="radiogroup" aria-label="Capital offers">
        {offers.map((offer) => {
          const selected = offer.id === selectedOfferId;
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
                <span className="avatar" aria-hidden="true">{offer.lender.charAt(0).toUpperCase()}</span>
                <span>
                  <strong>{offer.lender}</strong>
                  <small>{offer.isDemoCompetitor ? "Simulated competing pool" : "Policy creator"}</small>
                </span>
                {offer.id === lowestCostId ? <StatusPill tone="success">Lowest total</StatusPill> : null}
              </span>
              <span className="offer-option__rate"><strong>{offer.apr}%</strong><small>APR</small></span>
              <span className="offer-option__metrics">
                <span><small>First-loss</small><strong>{formatCurrency(offer.deposit)}</strong></span>
                <span><small>Maturity</small><strong>{termDays} days</strong></span>
                <span><small>Fee</small><strong>{formatCurrency(offer.fee)}</strong></span>
                <span><small>Total repayment</small><strong>{formatCurrency(Math.round(total))}</strong></span>
              </span>
              <span className="offer-option__note">{selected ? <Check size={14} /> : <CircleDollarSign size={14} />}{offer.note}</span>
            </button>
          );
        })}
      </div>

      <div className="task-card__action task-card__action--flush">
        <span className="action-note"><LockKeyhole size={15} /> Two competing offers are frontend demo data</span>
        <Button onClick={onAccept} icon={<Check size={16} />}>
          Accept {selectedOffer.lender}
        </Button>
      </div>
    </>
  );
}
