/**
 * Steps 3 and 4 — verify the receipt, then price it.
 *
 * The lender NEVER recomputes the verdict. There is no witness in this module,
 * no import that could reach one, and `ProofReceipt` is given only the
 * submission and the challenge. What the lender gets instead is better
 * evidence: `verification.checks`, the list of bindings the SERVER re-checked,
 * each with the server's own detail string, rendered verbatim and unfiltered.
 * A green badge asserts; a checklist of re-derivations shows.
 *
 * The row that matters most is `groth16_verified`, and its detail names the
 * sha256 of the verifying key the pairing check ran against. That is what
 * makes the row falsifiable: a reader can hash
 * `zk/build/verification_key.json` themselves and compare. Nothing in this
 * component edits, reorders or summarises that array — a checklist the client
 * is allowed to prettify is a checklist the client is allowed to launder.
 *
 * Funding is offered only when the server says `verified` and the receipt says
 * `eligible`. The backend enforces this too — the button simply does not lie
 * about what would happen.
 */

import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Landmark, ShieldCheck } from "lucide-react";

import { ProofReceipt } from "../components/ProofReceipt";
import { Button, Card, Spinner, StatusPill } from "../components/ui";
import { ApiError, createOffer, verifyProof, withdrawChallenge } from "../shared/apiClient";
import { formatCountdown, formatUsd } from "../shared/format";
import { shortHash } from "../shared/policy";
import type { CreditRequest, PolicyChallenge, ProofSubmission } from "../shared/protocol-types";

type VerificationPanelProps = {
  request: CreditRequest;
  challenge: PolicyChallenge;
  proof: ProofSubmission | null;
  sessionId: string;
  onChanged: () => void;
  onOpenBorrower: () => void;
  now: number;
};

function describe(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.detail ? `${cause.message} — ${cause.detail}` : cause.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export function VerificationPanel({
  request,
  challenge,
  proof,
  sessionId,
  onChanged,
  onOpenBorrower,
  now,
}: VerificationPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apr, setApr] = useState(10.4);
  const [fee, setFee] = useState(125);
  const [note, setNote] = useState("Funded after verifying the policy receipt");

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const verified = proof?.verification.status === "verified";
  const eligible = proof?.publicSignals.eligible === true;
  const canFund = Boolean(proof) && verified && eligible;

  return (
    <Card className="task-card proof-task-card">
      <div className="task-card__heading">
        <span className="task-icon task-icon--zk" aria-hidden="true">
          ZK
        </span>
        <div>
          <span className="section-label">Step 3 · Verify</span>
          <h2>{proof ? "Verify the proof" : "Waiting for the borrower's proof"}</h2>
          <p>
            The challenge is bound to this session&apos;s verifier commitment{" "}
            {shortHash(challenge.verifierCommitment)} and to policy hash {shortHash(challenge.policyHash)}.
            {proof
              ? " The checklist below is the server's own array, printed as it came back — including which verifying key the pairing check used."
              : ""}
          </p>
        </div>
      </div>

      <div className="policy-summary">
        <div>
          <span>Borrower</span>
          <strong>{request.ensName}</strong>
        </div>
        <div>
          <span>Requested</span>
          <strong>{formatUsd(request.amount)}</strong>
        </div>
        <div>
          <span>Challenge</span>
          <strong>{formatCountdown(challenge.expiresAt, now)}</strong>
        </div>
        <div>
          <span>Minimum collateral</span>
          <strong>{formatUsd(challenge.policy.minimumAssets)}</strong>
        </div>
        <div>
          <span>Minimum quality</span>
          <strong>{challenge.policy.minimumCollateralQuality}%</strong>
        </div>
        <div>
          <span>Minimum history</span>
          <strong>{challenge.policy.minimumHistoryMonths} months</strong>
        </div>
      </div>

      {proof ? (
        <ProofReceipt proof={proof} challenge={challenge} showVerification now={now} />
      ) : (
        <div className="waiting-state">
          <span className="waiting-pulse" aria-hidden="true" />
          <div>
            <strong>Policy delivered to {request.ensName}</strong>
            <span>They generate the proof in their browser. This updates when it lands.</span>
          </div>
          <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>
            Open the borrower side
          </Button>
        </div>
      )}

      {proof && verified && !eligible ? (
        <div className="inline-state inline-state--danger">
          <AlertTriangle size={19} />
          <div>
            <strong>Verified, and the applicant does not qualify</strong>
            <span>
              Every binding checked out — the receipt is genuine — and signal [1] is 0. One or more of the
              four comparisons failed. Which values caused it was never sent.
            </span>
          </div>
        </div>
      ) : null}

      {canFund ? (
        <>
          <div className="offer-builder">
            <div>
              <span className="section-label">Fund an offer</span>
              <h3>Price the verified request</h3>
              <small>The borrower sees this offer next to any competing ones.</small>
            </div>
            <label className="apr-field">
              <span>APR</span>
              <span className="apr-input">
                <input
                  type="number"
                  min="1"
                  max="40"
                  step="0.1"
                  value={apr}
                  onChange={(event) => setApr(Number(event.target.value))}
                />
                <span>%</span>
              </span>
            </label>
          </div>

          <div className="offer-builder">
            <label className="form-field">
              <span>Offer note</span>
              <input
                className="text-input"
                type="text"
                value={note}
                maxLength={120}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <label className="apr-field">
              <span>Origination fee</span>
              <span className="apr-input">
                <input
                  type="number"
                  min="0"
                  max="5000"
                  step="25"
                  value={fee}
                  onChange={(event) => setFee(Number(event.target.value))}
                />
                <span>USD</span>
              </span>
            </label>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>The action failed</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="task-card__action">
        <Button
          variant="quiet"
          disabled={busy}
          icon={<ArrowLeft size={15} />}
          onClick={() => void run(() => withdrawChallenge(challenge.id, sessionId))}
        >
          Withdraw challenge
        </Button>

        {proof && !verified ? (
          <Button
            disabled={busy}
            icon={busy ? <Spinner /> : <ShieldCheck size={16} />}
            onClick={() => void run(() => verifyProof(proof.id, sessionId))}
          >
            {busy ? "Verifying" : "Verify receipt"}
          </Button>
        ) : null}

        {canFund && proof ? (
          <Button
            disabled={busy}
            icon={busy ? <Spinner /> : <Landmark size={16} />}
            onClick={() =>
              void run(() =>
                createOffer({
                  sessionId,
                  requestId: request.id,
                  proofId: proof.id,
                  apr,
                  fee,
                  deposit: request.collateral,
                  note,
                }),
              )
            }
          >
            Fund and send offer
          </Button>
        ) : null}

        {proof && verified && !eligible ? (
          <StatusPill tone="danger">Not fundable under this policy</StatusPill>
        ) : null}
      </div>
    </Card>
  );
}
