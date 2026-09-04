/**
 * The capital provider's workspace — the other independent client.
 *
 * Structurally it is the twin of `BorrowerView`: its own session, its own
 * long-poll, its own projection of the shared state. What makes it interesting
 * is what it CANNOT do. There is no import path from this file, or from
 * anything in the lender directory, to anything in the borrower directory. Because
 * `App.tsx` lazy-loads both views, the two land in different Rollup chunks and
 * the witness code is physically absent from this one.
 *
 * Everything this view knows about the applicant arrives as: public loan terms,
 * a Poseidon commitment, a provenance record with no portfolio field, four
 * booleans, seven public signals, a Groth16 proof, the server's own verification
 * checks, and an ENS name.
 *
 * That last one is load-bearing. There is no field in the protocol carrying the
 * applicant's Solana address, so this client cannot pay anybody without first
 * resolving their ENS name and reading an X25519 key out of it. See
 * `lender/PayoutDerivation.tsx`.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, EyeOff, Inbox, Landmark } from "lucide-react";

import { PayoutDerivation } from "../lender/PayoutDerivation";
import { PolicyBuilder } from "../lender/PolicyBuilder";
import { RequestInbox } from "../lender/RequestInbox";
import { VerificationPanel } from "../lender/VerificationPanel";
import { markRepaymentDue } from "../shared/apiClient";
import { formatPercent, formatUsd } from "../shared/format";
import { shortHash } from "../shared/policy";
import { useProtocolState } from "../shared/useProtocolState";
import { usePublishPartyStatus } from "../state/connectionStatus";
import { useNow } from "../state/useNow";
import { FlowSteps } from "./FlowSteps";
import { LoanLifecycle } from "./LoanLifecycle";
import { SettlementPanel } from "./SettlementPanel";
import { Button, Card, Spinner, StatusPill } from "./ui";

const providerSteps = [
  { label: "Market", description: "Pick a request" },
  { label: "Policy", description: "Four thresholds" },
  { label: "Verify", description: "Check the proof" },
  { label: "Offer", description: "Price it" },
  { label: "Loan", description: "Settle and track" },
] as const;

function newest<T extends { createdAt: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.createdAt > best.createdAt ? row : best));
}

export function LenderView({ onOpenBorrower }: { onOpenBorrower: () => void }) {
  const { state, session, connection, error, refresh } = useProtocolState("lender");
  const now = useNow(1000);

  usePublishPartyStatus({
    role: "lender",
    label: session?.label ?? "provider",
    sessionId: session?.sessionId ?? null,
    connection,
  });

  const [pickedRequestId, setPickedRequestId] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const sessionId = session?.sessionId ?? null;

  const view = useMemo(() => {
    const requests = state ? state.requests.filter((row) => row.status !== "withdrawn") : [];

    // If this session already has live work on a request, land on it after a
    // reload rather than dumping the lender back at the inbox.
    const ownChallenge =
      state && sessionId
        ? newest(
            state.challenges.filter(
              (row) => row.lenderSessionId === sessionId && row.status !== "withdrawn",
            ),
          )
        : null;

    const requestId =
      pickedRequestId && requests.some((row) => row.id === pickedRequestId)
        ? pickedRequestId
        : (ownChallenge?.requestId ?? null);

    const request = requests.find((row) => row.id === requestId) ?? null;

    const challenge =
      state && request && sessionId
        ? newest(
            state.challenges.filter(
              (row) =>
                row.requestId === request.id &&
                row.lenderSessionId === sessionId &&
                row.status !== "withdrawn",
            ),
          )
        : null;

    const proof =
      state && challenge
        ? (newest(state.proofs.filter((row) => row.challengeId === challenge.id)) ?? null)
        : null;

    const offers =
      state && request && sessionId
        ? state.offers.filter(
            (row) =>
              row.requestId === request.id &&
              row.lenderSessionId === sessionId &&
              row.status !== "withdrawn" &&
              row.status !== "declined",
          )
        : [];

    const offer = newest(offers);
    const loan =
      state && offer ? (state.loans.find((row) => row.offerId === offer.id) ?? null) : null;

    // Every one-time payout address derived for this request, newest first.
    // Two rows here for one ENS name is the rotation, on screen.
    const payouts =
      state && request ? state.payouts.filter((row) => row.requestId === request.id) : [];

    // At most one settlement per offer: the loan PDA is seeded by the request
    // id, so a second `present_and_fund` for the same request cannot create it
    // twice even if the UI asked.
    const settlement =
      state && offer
        ? (state.settlements.find((row) => row.offerId === offer.id) ?? null)
        : null;

    return { requests, request, challenge, proof, offer, loan, payouts, settlement };
  }, [state, sessionId, pickedRequestId]);

  const { requests, request, challenge, proof, offer, loan, payouts, settlement } = view;

  const step = loan ? 4 : offer ? 3 : challenge ? 2 : request ? 1 : 0;

  if (!state || !session) {
    return (
      <div className="product-page" id="top">
        <Card className="empty-workspace">
          <Spinner />
          <span className="section-label">Lend</span>
          <h2>{connection === "error" ? "Cannot reach the backend" : "Opening your session"}</h2>
          <p>{error ?? "Claiming a lender session on the marketplace backend."}</p>
          <small>Connection: {connection}</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Lend · session {shortHash(session.sessionId)}</span>
          <h1>Fund borrowers you can verify, without seeing their portfolio.</h1>
        </div>
        <StatusPill tone={requests.length > 0 ? "success" : "neutral"}>
          <Inbox size={14} />
          {requests.length} listed request{requests.length === 1 ? "" : "s"}
        </StatusPill>
      </header>

      {!request ? (
        <RequestInbox
          requests={requests}
          selectedId={null}
          onSelect={setPickedRequestId}
          now={now}
        />
      ) : (
        <div className="workflow-shell lender-shell">
          <aside className="workflow-sidebar lender-sidebar">
            <div className="request-sidebar__header">
              <span className="avatar avatar--ens" aria-hidden="true">
                {request.borrowerLabel.charAt(0).toUpperCase()}
              </span>
              <div>
                <strong>{request.borrowerLabel}</strong>
                <span>session {shortHash(request.borrowerSessionId)}</span>
              </div>
            </div>
            <div className="request-sidebar__amount">
              <span>Requested</span>
              <strong>{formatUsd(request.amount)}</strong>
              <small>USDC · {request.termDays} days</small>
            </div>
            <dl className="request-sidebar__terms">
              <div>
                <dt>First-loss deposit</dt>
                <dd>{formatUsd(request.collateral)}</dd>
              </div>
              <div>
                <dt>Commitment</dt>
                <dd>{shortHash(request.passportCommitment)}</dd>
              </div>
              <div>
                <dt>Identity</dt>
                <dd>{request.ensName}</dd>
              </div>
              <div>
                <dt>Proof</dt>
                <dd>{proof ? proof.verification.status : challenge ? "awaited" : "not requested"}</dd>
              </div>
            </dl>
            <div className="sealed-note">
              <EyeOff size={16} />
              <span>
                <strong>No portfolio value was ever sent.</strong> You underwrite a proof.
              </span>
            </div>
            <FlowSteps steps={providerSteps} currentStep={step} />
            <button
              type="button"
              className="text-button sidebar-withdraw"
              onClick={() => setPickedRequestId(null)}
            >
              Back to the market
            </button>
          </aside>

          <main className="workflow-main">
            {loan && offer ? (
              <Card className="task-card">
                <div className="task-card__heading">
                  <span className="task-icon task-icon--success">
                    <Landmark size={22} />
                  </span>
                  <div>
                    <span className="section-label">Step 5 · Loan</span>
                    <h2>Settle and track the loan</h2>
                    <p>The borrower accepted your offer. Settle it on Solana, then track repayment.</p>
                  </div>
                </div>
                <LoanLifecycle
                  loan={loan}
                  lenderLabel={offer.lenderLabel}
                  role="provider"
                  busy={lifecycleBusy}
                  onMarkDue={() => {
                    setLifecycleBusy(true);
                    setLifecycleError(null);
                    void markRepaymentDue(loan.id, session.sessionId)
                      .then(() => refresh())
                      .catch((cause: unknown) =>
                        setLifecycleError(
                          cause instanceof Error ? cause.message : String(cause),
                        ),
                      )
                      .finally(() => setLifecycleBusy(false));
                  }}
                />
                {lifecycleError ? (
                  <div className="inline-state inline-state--danger" role="alert">
                    <AlertTriangle size={19} />
                    <div>
                      <strong>Could not call the loan due</strong>
                      <span>{lifecycleError}</span>
                    </div>
                  </div>
                ) : null}
                <PayoutDerivation
                  request={request}
                  offer={offer}
                  sessionId={session.sessionId}
                  payouts={payouts}
                  onChanged={refresh}
                />
                <SettlementPanel
                  role="lender"
                  sessionId={session.sessionId}
                  requestId={request.id}
                  offerId={offer.id}
                  proofId={offer.proofId}
                  payoutId={payouts.find((row) => row.offerId === offer.id)?.id ?? null}
                  settlement={settlement}
                  onChanged={refresh}
                />
                <div className="task-card__action">
                  <span className="action-note">
                    <EyeOff size={15} /> No portfolio value was received at any point
                  </span>
                  <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>
                    Open the borrower side
                  </Button>
                </div>
              </Card>
            ) : offer ? (
              <Card className="task-card">
                <div className="task-card__heading">
                  <span className="task-icon task-icon--success">
                    <Landmark size={22} />
                  </span>
                  <div>
                    <span className="section-label">Step 4 · Offer</span>
                    <h2>Your offer is on the listing</h2>
                    <p>Waiting for {request.ensName} to accept it.</p>
                  </div>
                </div>
                <div className="funding-receipt">
                  <div>
                    <span>Offered amount</span>
                    <strong>{formatUsd(request.amount)} USDC</strong>
                  </div>
                  <div>
                    <span>APR</span>
                    <strong>{formatPercent(offer.apr, 1)}</strong>
                  </div>
                  <div>
                    <span>Origination fee</span>
                    <strong>{formatUsd(offer.fee)}</strong>
                  </div>
                  <div>
                    <span>Receipt</span>
                    <strong className="mono-value">{shortHash(offer.proofId)}</strong>
                  </div>
                  <StatusPill tone="warning">Awaiting applicant decision</StatusPill>
                </div>
                <PayoutDerivation
                  request={request}
                  offer={offer}
                  sessionId={session.sessionId}
                  payouts={payouts}
                  onChanged={refresh}
                />
                <SettlementPanel
                  role="lender"
                  sessionId={session.sessionId}
                  requestId={request.id}
                  offerId={offer.id}
                  proofId={offer.proofId}
                  payoutId={payouts.find((row) => row.offerId === offer.id)?.id ?? null}
                  settlement={settlement}
                  onChanged={refresh}
                />
                <div className="task-card__action">
                  <span className="action-note">The borrower sees this offer on their listing.</span>
                  <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>
                    Open the borrower side
                  </Button>
                </div>
              </Card>
            ) : challenge ? (
              <VerificationPanel
                request={request}
                challenge={challenge}
                proof={proof}
                sessionId={session.sessionId}
                onChanged={refresh}
                onOpenBorrower={onOpenBorrower}
                now={now}
              />
            ) : request.status === "withdrawn" ? (
              <Card className="task-card">
                <div className="task-card__heading">
                  <span className="task-icon task-icon--danger">
                    <AlertTriangle size={22} />
                  </span>
                  <div>
                    <span className="section-label">Withdrawn</span>
                    <h2>The borrower withdrew this request</h2>
                    <p>Nothing further can be issued against it.</p>
                  </div>
                </div>
                <div className="task-card__action">
                  <Button
                    variant="secondary"
                    onClick={() => setPickedRequestId(null)}
                    icon={<ArrowLeft size={15} />}
                  >
                    Back to the market
                  </Button>
                </div>
              </Card>
            ) : (
              <PolicyBuilder request={request} sessionId={session.sessionId} onSent={refresh} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

export default LenderView;
