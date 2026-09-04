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
        <span className="section-label">Request inbox</span>
        <h2>No open credit requests</h2>
        <p>
          Open the applicant workspace in a <strong>second browser tab or window</strong> and publish a
          request. This page will update by itself — it is holding a long-poll open against{" "}
          <code>GET /api/state</code>, not refreshing on a timer.
        </p>
        <small>
          The two tabs hold two different session ids and talk to each other only through the API. That
          separation is the demo: this tab has no object, no import and no code path that could read the
          other tab&apos;s portfolio.
        </small>
      </Card>
    );
  }

  return (
    <div className="request-inbox">
      {requests.map((request) => {
        const selected = request.id === selectedId;
        return (
          <article
            className={selected ? "request-inbox__row is-selected" : "request-inbox__row"}
            key={request.id}
          >
            <div className="request-inbox__summary">
              <div>
                <span className="section-label">{request.borrowerLabel}</span>
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
                <dt>Portfolio values received</dt>
                <dd>none</dd>
              </div>
              <div>
                <dt>Address read</dt>
                <dd className="mono-value">{shortHash(request.provenance.address)}</dd>
              </div>
            </dl>

            <ProvenanceStrip provenance={request.provenance} compact now={now} />

            <div className="request-inbox__action">
              <Button
                variant={selected ? "secondary" : "primary"}
                onClick={() => onSelect(request.id)}
                icon={<ArrowRight size={15} />}
              >
                {selected ? "Selected" : "Underwrite this request"}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
