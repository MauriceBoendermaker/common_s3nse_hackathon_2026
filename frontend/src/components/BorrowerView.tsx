/**
 * The applicant's workspace — one of the two independent clients.
 *
 * This component holds NO protocol state of its own. It calls
 * `useProtocolState("borrower")` for its own long-poll against the shared
 * store, and everything it renders about requests, challenges, proofs, offers
 * and loans comes back over HTTP from the server's borrower projection.
 *
 * It is also the only file outside `frontend/src/borrower/` permitted to import
 * `witnessStore`, and it does so only to mount the provider. Because `App.tsx`
 * lazy-loads this module, Rollup emits it as its own chunk: the witness code is
 * in the borrower chunk and is absent from the lender chunk.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleDollarSign,
  Fingerprint,
  Link2,
  Radio,
} from "lucide-react";

import { PRODUCT_CONFIG } from "../config/product";
import { ChallengeResponse } from "../borrower/ChallengeResponse";
import { ConnectAccount } from "../borrower/ConnectAccount";
import { PassportReview } from "../borrower/PassportReview";
import { EnsIdentityPanel } from "../borrower/EnsIdentityPanel";
import { EnsIdentityProvider, useEnsIdentity } from "../borrower/ensIdentity";
import { PayoutRecovery } from "../borrower/PayoutRecovery";
import { ProverProvider } from "../borrower/useProver";
import { useWitness, WitnessProvider } from "../borrower/witnessStore";
import {
  acceptOffer,
  drawLoan,
  publishRequest,
  repayLoan,
  withdrawRequest,
} from "../shared/apiClient";
import { formatUsd } from "../shared/format";
import { bytesToHex0x } from "../shared/ensPayout";
import { shortHash } from "../shared/policy";
import type { Offer } from "../shared/protocol-types";
import { useProtocolState } from "../shared/useProtocolState";
import { usePublishPartyStatus } from "../state/connectionStatus";
import { getTotalRepayment } from "../state/types";
import { FlowSteps } from "./FlowSteps";
import { LoanLifecycle } from "./LoanLifecycle";
import { OfferComparison } from "./OfferComparison";
import { PrivacyBoundary } from "./PrivacyBoundary";
import { Button, Card, Spinner, StatusPill } from "./ui";
import { WalletActionDialog, type ConfirmAction } from "./WalletActionDialog";

const applicantSteps = [
  { label: "Connect account", description: "Read a Solana address" },
  { label: "Review passport", description: "Check the machine-read evidence" },
  { label: "Publish request", description: "Amount, term, first-loss" },
  { label: "Answer the policy", description: "Evaluate and submit a receipt" },
  { label: "Compare offers", description: "Real funded offers only" },
  { label: "Manage the loan", description: "Draw and repay" },
] as const;

const amountOptions = [10_000, 25_000, 50_000, 100_000];
const termOptions = [30, 60, 90];
const collateralOptions = [5_000, 10_000, 20_000, 40_000];

function newest<T extends { createdAt: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.createdAt > best.createdAt ? row : best));
}

function BorrowerWorkspace({ onOpenLender }: { onOpenLender: () => void }) {
  const { state, session, connection, error, refresh } = useProtocolState("borrower");
  const witness = useWitness();
  const ens = useEnsIdentity();

  usePublishPartyStatus({
    role: "borrower",
    label: session?.label ?? "applicant",
    sessionId: session?.sessionId ?? null,
    connection,
  });

  const [reviewed, setReviewed] = useState(false);
  const [amount, setAmount] = useState<number>(PRODUCT_CONFIG.request.amount);
  const [collateral, setCollateral] = useState<number>(PRODUCT_CONFIG.request.collateral);
  const [termDays, setTermDays] = useState<number>(PRODUCT_CONFIG.request.termDays);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sessionId = session?.sessionId ?? null;

  const view = useMemo(() => {
    const requests =
      state && sessionId
        ? state.requests.filter(
            (row) => row.borrowerSessionId === sessionId && row.status !== "withdrawn",
          )
        : [];
    const request = newest(requests);
    const challenges =
      state && request
        ? state.challenges.filter((row) => row.requestId === request.id && row.status !== "withdrawn")
        : [];
    const challenge = newest(challenges);
    const proof =
      state && challenge
        ? (newest(state.proofs.filter((row) => row.challengeId === challenge.id)) ?? null)
        : null;
    const offers =
      state && request
        ? state.offers.filter(
            (row) => row.requestId === request.id && (row.status === "open" || row.status === "accepted"),
          )
        : [];
    const loan = state && request ? (state.loans.find((row) => row.requestId === request.id) ?? null) : null;
    const payouts =
      state && request ? state.payouts.filter((row) => row.requestId === request.id) : [];
    return { request, challenge, proof, offers, loan, payouts };
  }, [state, sessionId]);

  const { request, challenge, proof, offers, loan, payouts } = view;

  /**
   * The ENS identity is required before anything can be published, because two
   * things downstream have no fallback without it: public signal [3] is
   * `Poseidon2(utf8ToField(ensName), blindingFactor)`, and the payout address
   * is derived from that name's text record. A request with no name is a
   * request nobody can pay.
   */
  const identityReady = ens.name.length > 0 && ens.effectiveKey !== null;

  const step = loan
    ? 5
    : offers.length > 0
      ? 4
      : request
        ? 3
        : witness.status === "ready" && reviewed
          ? 2
          : witness.status === "ready"
            ? 1
            : 0;

  const runAction = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const acceptedOffer: Offer | null =
    offers.find((row) => row.status === "accepted") ??
    offers.find((row) => row.id === selectedOfferId) ??
    offers[0] ??
    null;

  if (!state || !session) {
    return (
      <div className="product-page" id="top">
        <Card className="empty-workspace">
          <Spinner />
          <span className="section-label">Applicant workspace</span>
          <h2>{connection === "error" ? "Cannot reach the backend" : "Claiming a session"}</h2>
          <p>
            {error ??
              "Asking the protocol backend for a borrower session id, then opening a long-poll on the shared state."}
          </p>
          <small>Connection: {connection}</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Credit applicant · session {shortHash(session.sessionId)}</span>
          <h1>Request credit without exposing your portfolio.</h1>
        </div>
        <StatusPill tone={request ? "success" : "neutral"}>
          {request ? <Radio size={14} /> : <span className="network-dot" />}
          {request ? `Request live · ${request.status}` : "Private draft"}
        </StatusPill>
      </header>

      <div className="workflow-shell">
        <aside className="workflow-sidebar">
          <div className="workflow-sidebar__intro">
            <span className="avatar avatar--ens" aria-hidden="true">
              {session.label.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{session.label}</strong>
              <span>
                {witness.status === "ready"
                  ? `Passport read · ${shortHash(witness.commitment ?? "0x")}`
                  : "No passport yet"}
              </span>
            </div>
          </div>
          <FlowSteps steps={applicantSteps} currentStep={step} />
          <div className="sidebar-proof-note">
            <span className="zk-mark" aria-hidden="true">
              ZK
            </span>
            <p>
              <strong>The witness never leaves this tab.</strong> The backend has no field that could store
              it and the lender&apos;s bundle does not contain the code that reads it.
            </p>
          </div>
          {request && !loan ? (
            <button
              type="button"
              className="text-button text-button--danger sidebar-withdraw"
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  await withdrawRequest(request.id, session.sessionId);
                  setReviewed(true);
                })
              }
            >
              Withdraw this request
            </button>
          ) : null}
        </aside>

        <main className="workflow-main">
          {actionError ? (
            <div className="inline-state inline-state--danger" role="alert">
              <AlertTriangle size={19} />
              <div>
                <strong>The last action failed</strong>
                <span>{actionError}</span>
              </div>
            </div>
          ) : null}

          {step === 0 ? <ConnectAccount onLoaded={() => setReviewed(false)} /> : null}

          {step === 1 ? (
            <PassportReview onBack={() => witness.clear()} onContinue={() => setReviewed(true)} />
          ) : null}

          {/*
            The ENS identity spans both of the first two steps. It has to
            outlive the passport read, because the subject commitment it shows
            is Poseidon2(utf8ToField(ensName), blindingFactor) and the blinding
            factor does not exist until a passport has been loaded — showing
            the panel only on step 1 would mean the applicant never sees the
            value that will represent them.
          */}
          {step <= 1 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon">
                  <Fingerprint size={22} />
                </span>
                <div>
                  <span className="section-label">Identity · required before publishing</span>
                  <h2>Resolve the ENS name</h2>
                  <p>
                    The ENS name is who the applicant is. The Solana address above is where their
                    portfolio was read. Only the first of the two can be paid.
                  </p>
                </div>
              </div>
              <EnsIdentityPanel />
            </Card>
          ) : null}

          {step === 2 && witness.passport && witness.commitment ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon">
                  <CircleDollarSign size={22} />
                </span>
                <div>
                  <span className="section-label">Step 3 of 6</span>
                  <h2>Set the public terms</h2>
                  <p>
                    Publishing puts a row in the shared store that every lender tab can see. Choose what it
                    contains.
                  </p>
                </div>
              </div>

              <div className="terms-layout">
                <div className="form-stack">
                  <label className="form-field">
                    <span>Credit amount</span>
                    <select value={amount} onChange={(event) => setAmount(Number(event.target.value))}>
                      {amountOptions.map((value) => (
                        <option value={value} key={value}>
                          {formatUsd(value)} USDC
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>First-loss deposit</span>
                    <select
                      value={collateral}
                      onChange={(event) => setCollateral(Number(event.target.value))}
                    >
                      {collateralOptions.map((value) => (
                        <option value={value} key={value}>
                          {formatUsd(value)} USDC
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="form-field">
                    <legend>Loan term</legend>
                    <div className="segmented-options">
                      {termOptions.map((days) => (
                        <button
                          type="button"
                          key={days}
                          className={termDays === days ? "is-selected" : undefined}
                          aria-pressed={termDays === days}
                          onClick={() => setTermDays(days)}
                        >
                          {days} days
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <div className="terms-summary">
                  <span className="section-label">Becomes public</span>
                  <strong>{formatUsd(amount)}</strong>
                  <dl>
                    <div>
                      <dt>Term</dt>
                      <dd>{termDays} days</dd>
                    </div>
                    <div>
                      <dt>First-loss deposit</dt>
                      <dd>{formatUsd(collateral)}</dd>
                    </div>
                    <div>
                      <dt>Passport commitment</dt>
                      <dd>{shortHash(witness.commitment)}</dd>
                    </div>
                    <div>
                      <dt>ENS identity</dt>
                      <dd>{ens.name || "not set"}</dd>
                    </div>
                    <div>
                      <dt>Payout key source</dt>
                      <dd>{ens.effectiveKey ? ens.effectiveKey.source : "none"}</dd>
                    </div>
                    <div>
                      <dt>Provenance record</dt>
                      <dd>sources, latencies, allowlist, address</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="disclosure-split">
                <div>
                  <span className="disclosure-split__label">Published with the request</span>
                  <ul>
                    <li>Amount, term and first-loss deposit</li>
                    <li>The passport commitment (a Poseidon hash)</li>
                    <li>
                      The <strong>ENS name</strong> &mdash; the applicant&apos;s public identity, and
                      the only way a lender can derive a payout address
                    </li>
                    <li>
                      The provenance record — including <strong>the address that was read</strong>, so a
                      lender can re-read it themselves
                    </li>
                  </ul>
                </div>
                <div>
                  <span className="disclosure-split__label">Stays in this tab</span>
                  <ul>
                    <li>The four witness values</li>
                    <li>Every per-mint holding and USD figure</li>
                    <li>The salt, without which the commitment cannot be inverted</li>
                    <li>
                      The X25519 viewing scalar, and the blinding factor that hides the ENS name
                      behind the subject commitment
                    </li>
                  </ul>
                </div>
              </div>

              {identityReady ? null : (
                <div className="inline-state inline-state--danger" role="alert">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>An ENS identity is required before publishing</strong>
                    <span>
                      Go back to step 1 and resolve a name. Public signal [3] is
                      Poseidon2(utf8ToField(ensName), blindingFactor), and the payout address is
                      derived from that name&apos;s <code>privatecredit.payout-key[501]</code>{" "}
                      record &mdash; a request with no name is a request no lender can pay.
                    </span>
                  </div>
                </div>
              )}

              <div className="task-card__action">
                <Button variant="quiet" onClick={() => setReviewed(false)} icon={<ArrowLeft size={15} />}>
                  Back to the passport
                </Button>
                <Button
                  disabled={busy || !identityReady}
                  icon={<ArrowRight size={16} />}
                  onClick={() =>
                    setConfirm({
                      title: "Publish the credit request",
                      detail:
                        "Writes one row to the shared store. It carries the commitment, the provenance record and the ENS identity — no portfolio value has anywhere to go in the request body.",
                      confirmLabel: "Publish request",
                      amount,
                      successDetail:
                        "The request is live. Every lender tab will see it on its next long-poll return.",
                      run: async () => {
                        await publishRequest({
                          sessionId: session.sessionId,
                          amount,
                          collateral,
                          termDays,
                          passportCommitment: witness.commitment!,
                          provenance: witness.passport!.provenance,
                          ensName: ens.name,
                          // Only ever sent in the local-demo case, and the
                          // backend refuses the combination that would let a
                          // client claim an on-chain source for a key it
                          // shipped in the body. When ENS holds the record the
                          // lender reads it from chain and this stays null.
                          payoutKey:
                            ens.effectiveKey && ens.effectiveKey.source === "local-demo"
                              ? bytesToHex0x(ens.effectiveKey.publicKey)
                              : null,
                          payoutKeySource: ens.effectiveKey ? ens.effectiveKey.source : null,
                        });
                        refresh();
                      },
                    })
                  }
                >
                  Publish request
                </Button>
              </div>
            </Card>
          ) : null}

          {step === 3 && request ? (
            <ChallengeResponse
              request={request}
              challenge={challenge}
              proof={proof}
              sessionId={session.sessionId}
              onSubmitted={refresh}
              onOpenLender={onOpenLender}
            />
          ) : null}

          {step === 4 && request ? (
            <Card className="task-card market-card">
              <div className="task-card__heading">
                <span className="task-icon">
                  <CircleDollarSign size={22} />
                </span>
                <div>
                  <span className="section-label">Step 5 of 6</span>
                  <h2>{offers.length === 1 ? "One funded offer" : "Compare the funded offers"}</h2>
                  <p>
                    {offers.length === 1
                      ? "A single lender verified the receipt and funded. That is the whole market right now — nothing here is padded with invented competitors."
                      : "Every row below is a real offer another session created after verifying the receipt."}
                  </p>
                </div>
              </div>

              <OfferComparison
                offers={offers}
                amount={request.amount}
                termDays={request.termDays}
                selectedOfferId={selectedOfferId}
                busy={busy}
                onSelect={setSelectedOfferId}
                onAccept={(offer) =>
                  setConfirm({
                    title: `Accept ${offer.lenderLabel}`,
                    detail:
                      "Accepting creates the loan row on the server. Nothing is signed and no funds move — settlement would land with the Solana program, which is not implemented.",
                    confirmLabel: "Accept offer",
                    amount: request.amount,
                    successDetail: "Offer accepted and the loan row exists.",
                    run: async () => {
                      await acceptOffer(offer.id, session.sessionId);
                      refresh();
                    },
                  })
                }
              />

              {proof ? <PrivacyBoundary proof={proof} /> : null}
            </Card>
          ) : null}

          {step === 5 && loan ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon">
                  <Link2 size={22} />
                </span>
                <div>
                  <span className="section-label">Step 6 of 6</span>
                  <h2>Manage the loan</h2>
                  <p>
                    Each transition below is a POST to the backend that changes the shared row. The lender
                    tab sees the same change.
                  </p>
                </div>
              </div>

              <PayoutRecovery requestId={loan.requestId} payouts={payouts} />

              <LoanLifecycle
                loan={loan}
                lenderLabel={acceptedOffer?.lenderLabel ?? "the lender"}
                role="applicant"
                busy={busy}
                onDraw={() =>
                  setConfirm({
                    title: "Draw the credit line",
                    detail: "Moves the loan row to `active` on the server.",
                    confirmLabel: "Draw",
                    amount: loan.principal,
                    successDetail: "The loan is active.",
                    run: async () => {
                      await drawLoan(loan.id, session.sessionId);
                      refresh();
                    },
                  })
                }
                onRepay={() =>
                  setConfirm({
                    title: "Repay the loan",
                    detail: "Moves the loan row to `repaid` on the server.",
                    confirmLabel: "Repay",
                    amount: Math.round(
                      getTotalRepayment(loan.principal, loan.apr, loan.termDays, loan.fee),
                    ),
                    successDetail: "The loan is repaid.",
                    run: async () => {
                      await repayLoan(loan.id, session.sessionId);
                      refresh();
                    },
                  })
                }
              />
            </Card>
          ) : null}
        </main>
      </div>

      {confirm ? (
        <WalletActionDialog
          action={confirm}
          onClose={() => {
            setConfirm(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * `ProverProvider` is mounted HERE, at the top of the applicant workspace and
 * outside anything that re-renders on protocol state, so exactly one Groth16
 * prover worker exists and it starts fetching its 4.6 MB of artifacts the
 * moment this chunk loads — long before a policy challenge arrives. A worker
 * created lazily at proving time would add 650-750 ms of startup to the first
 * proof, on top of the proof itself.
 *
 * It sits inside the lazy-loaded borrower chunk, so the prover, like the
 * witness, is absent from the lender bundle by construction.
 */
export function BorrowerView({ onOpenLender }: { onOpenLender: () => void }) {
  return (
    <ProverProvider>
      <WitnessProvider>
        {/*
          The ENS identity store holds the X25519 viewing scalar - the second
          private value in this app, and the one that recovers every one-time
          payout address. Like the witness it is mounted inside the lazy
          borrower chunk, so it is absent from the lender bundle by
          construction rather than by convention.
        */}
        <EnsIdentityProvider>
          <BorrowerWorkspace onOpenLender={onOpenLender} />
        </EnsIdentityProvider>
      </WitnessProvider>
    </ProverProvider>
  );
}

export default BorrowerView;
