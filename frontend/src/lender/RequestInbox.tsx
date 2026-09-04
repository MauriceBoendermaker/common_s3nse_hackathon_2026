/**
 * The lender's inbox. Real rows, or an empty state that tells the truth.
 *
 * The "Load sample request" button is gone, along with the `loadSampleRequest`
 * function behind it, which used to fabricate a published request, a connected
 * wallet, a verified ENS identity and three connected sources in one click. If
 * this list is empty it is because nobody has published a request.
 *
 * Each row shows the public terms, the applicant's commitment and a compact
 * provenance strip. A lender can therefore see that the passport was machine
 * read — endpoints, latencies, scan bounds — without seeing one portfolio value,
 * because `PassportProvenance` has no field that could carry one.
 */

import { ArrowRight, Inbox } from "lucide-react";

import { ProvenanceStrip } from "../components/ProvenanceStrip";
import { Button, Card, StatusPill } from "../components/ui";
import { formatRelativeTime, formatUsd } from "../shared/format";
import { shortHash } from "../shared/policy";
import type { CreditRequest } from "../shared/protocol-types";

type RequestInboxProps = {
  requests: CreditRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "dark"> = {
  open: "neutral",
  challenged: "warning",
  proven: "success",
  funded: "success",
  accepted: "dark",
  withdrawn: "danger",
};

export function RequestInbox({ requests, selectedId, onSelect, now }: RequestInboxProps) {
  if (requests.length === 0) {
    return (
      <Card className="empty-workspace">
        <span className="task-icon">
          <Inbox size={22} />
        </span>
        <span className="section-label">Marketplace</span>
        <h2>No credit requests listed</h2>
        <p>
          This page updates the moment a borrower lists one. Open the borrower side in another
          window to list a request yourself.
        </p>
      </Card>
    );
  }

  return (
    <div className="request-inbox">
      <div className="market-list-header">
        <div>
          <span className="section-label">Marketplace</span>
          <h2>Requests seeking capital</h2>
        </div>
      </div>
      {requests.map((request) => {
        const selected = request.id === selectedId;
        return (
          <article
            className={selected ? "request-inbox__row is-selected" : "request-inbox__row"}
            key={request.id}
          >
            <div className="request-inbox__summary">
              <div>
                <span className="section-label">{request.ensName}</span>
                <strong>{formatUsd(request.amount)}</strong>
                <small>
                  {request.termDays} days · {formatUsd(request.collateral)} first-loss · published{" "}
                  {formatRelativeTime(new Date(request.createdAt).toISOString(), now)}
                </small>
              </div>
              <StatusPill tone={STATUS_TONE[request.status] ?? "neutral"}>{request.status}</StatusPill>
            </div>

            <dl className="request-inbox__facts">
              <div>
                <dt>Passport commitment</dt>
                <dd className="mono-value">{shortHash(request.passportCommitment)}</dd>
              </div>
              <div>
                <dt>Borrower</dt>
                <dd>{request.borrowerLabel}</dd>
              </div>
              <div>
                <dt>Portfolio values received</dt>
                <dd>none</dd>
              </div>
            </dl>

            <ProvenanceStrip provenance={request.provenance} compact now={now} />

            <div className="request-inbox__action">
              <Button
                variant={selected ? "secondary" : "primary"}
                onClick={() => onSelect(request.id)}
                icon={<ArrowRight size={15} />}
              >
                {selected ? "Selected" : "Underwrite"}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
