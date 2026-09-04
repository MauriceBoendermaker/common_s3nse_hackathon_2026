/**
 * The borrower's workspace — one of the two independent clients.
 *
 * Holds NO protocol state of its own: `useProtocolState("borrower")` long-polls
 * the shared store and everything about requests, challenges, proofs, offers
 * and loans comes back over HTTP from the server's borrower projection.
 *
 * The only file outside `frontend/src/borrower/` allowed to import
 * `witnessStore`, and only to mount the provider. `App.tsx` lazy-loads this
 * module, so the witness and the viewing key live in the borrower chunk and
 * are absent from the lender chunk.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleDollarSign,
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
import { shortHash } from "../shared/policy";
import type { Offer } from "../shared/protocol-types";
import { useProtocolState } from "../shared/useProtocolState";
import { usePublishPartyStatus } from "../state/connectionStatus";
import { getTotalRepayment } from "../state/types";
import { FlowSteps } from "./FlowSteps";
import { LoanLifecycle } from "./LoanLifecycle";
import { SettlementPanel } from "./SettlementPanel";
import { OfferComparison } from "./OfferComparison";
import { PrivacyBoundary } from "./PrivacyBoundary";
import { Button, Card, Spinner, StatusPill } from "./ui";
import { WalletActionDialog, type ConfirmAction } from "./WalletActionDialog";

const applicantSteps = [
  { label: "Connect", description: "ENS identity and Solana portfolio" },
  { label: "Passport", description: "Four private values, one hash" },
  { label: "List request", description: "Amount, term, first-loss" },
  { label: "Prove eligibility", description: "Answer a lender's policy" },
  { label: "Offers", description: "Pick the best rate" },
  { label: "Loan", description: "Draw and repay" },
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
    label: session?.label ?? "borrower",
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
    const settlement =
      state && request
        ? (state.settlements.find((row) => row.requestId === request.id) ?? null)
        : null;
    return { request, challenge, proof, offers, loan, payouts, settlement };
  }, [state, sessionId]);

  const { request, challenge, proof, offers, loan, payouts, settlement } = view;

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
          <span className="section-label">Request credit</span>
          <h2>{connection === "error" ? "Cannot reach the backend" : "Opening your session"}</h2>
          <p>{error ?? "Claiming a borrower session on the marketplace backend."}</p>
          <small>Connection: {connection}</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Request credit · session {shortHash(session.sessionId)}</span>
          <h1>Borrow against what you can prove.</h1>
        </div>
        <StatusPill tone={request ? "success" : "neutral"}>
          {request ? <Radio size={14} /> : <span className="network-dot" />}
          {request ? `Listed · ${request.status}` : "Not listed yet"}
        </StatusPill>
      </header>

      <div className="workflow-shell">
        <aside className="workflow-sidebar">
          <div className="workflow-sidebar__intro">
            <span className="avatar avatar--ens" aria-hidden="true">
              {(ens.name || session.label).charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{ens.name || session.label}</strong>
              <span>
                {witness.status === "ready"
                  ? `Passport ${shortHash(witness.commitment ?? "0x")}`
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
              <strong>Your balances never leave this tab.</strong> Lenders receive a proof, not
              your portfolio.
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
              Withdraw this listing
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

          {step <= 1 && !ens.ready ? <EnsIdentityPanel /> : null}

          {step === 0 ? <ConnectAccount onLoaded={() => setReviewed(false)} /> : null}

          {step === 1 ? (
            <PassportReview onBack={() => witness.clear()} onContinue={() => setReviewed(true)} />
          ) : null}

          {step === 2 && witness.passport && witness.commitment ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon">
                  <CircleDollarSign size={22} />
                </span>
                <div>
                  <span className="section-label">Step 3 · List on the marketplace</span>
                  <h2>Set your terms</h2>
                  <p>Every lender on the market sees these terms, your ENS domain and one hash.</p>
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
                  <span className="section-label">Your listing</span>
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
                      <dt>Identity</dt>
                      <dd>{ens.name || "not set"}</dd>
                    </div>
                    <div>
                      <dt>Passport commitment</dt>
                      <dd>{shortHash(witness.commitment)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="disclosure-split">
                <div>
                  <span className="disclosure-split__label">Public</span>
                  <ul>
                    <li>Amount, term, first-loss deposit</li>
                    <li>Your ENS domain</li>
                    <li>One Poseidon hash of the passport</li>
                  </ul>
                </div>
                <div>
                  <span className="disclosure-split__label">Private, stays here</span>
                  <ul>
                    <li>Every balance and USD figure</li>
                    <li>The passport values and salt</li>
                    <li>Your viewing key</li>
                  </ul>
                </div>
              </div>

              {ens.ready ? null : (
                <div className="inline-state inline-state--danger" role="alert">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Finish your identity first</strong>
                    <span>
                      Lenders pay to a key published under your ENS domain. Without it, nobody can
                      pay you.
                    </span>
                  </div>
                  <Button variant="secondary" onClick={() => setReviewed(false)}>
                    Back to identity
                  </Button>
                </div>
              )}

              <div className="task-card__action">
                <Button variant="quiet" onClick={() => setReviewed(false)} icon={<ArrowLeft size={15} />}>
                  Back
                </Button>
                <Button
                  disabled={busy || !ens.ready}
                  icon={<ArrowRight size={16} />}
                  onClick={() =>
                    setConfirm({
                      title: "List this credit request",
                      detail:
                        "Publishes your terms, ENS name and passport commitment to the marketplace. No balance is included.",
                      confirmLabel: "List request",
                      amount,
                      successDetail: "Your request is live. Lenders can now send you a policy.",
                      run: async () => {
                        await publishRequest({
                          sessionId: session.sessionId,
                          amount,
                          collateral,
                          termDays,
                          passportCommitment: witness.commitment!,
                          provenance: witness.passport!.provenance,
                          ensName: ens.name,
                        });
                        refresh();
                      },
                    })
                  }
                >
                  List on the marketplace
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
                  <span className="section-label">Step 5 · Offers</span>
                  <h2>
                    {offers.length === 1 ? "One offer on your listing" : `${offers.length} offers on your listing`}
                  </h2>
                  <p>Each lender verified your proof before funding. Accept one to create the loan.</p>
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
                      "Creates the loan. The lender then settles it on Solana and the transaction signatures show up here.",
                    confirmLabel: "Accept offer",
                    amount: request.amount,
                    successDetail: "Offer accepted. The loan exists.",
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
                  <span className="section-label">Step 6 · Loan</span>
                  <h2>Your loan</h2>
                  <p>Draw, repay, and check the on-chain settlement without asking the lender.</p>
                </div>
              </div>

              <PayoutRecovery requestId={loan.requestId} payouts={payouts} />

              <SettlementPanel
                role="borrower"
                sessionId={session.sessionId}
                requestId={loan.requestId}
                offerId={loan.offerId}
                proofId={null}
                payoutId={null}
                settlement={settlement}
                onChanged={refresh}
              />

              <LoanLifecycle
                loan={loan}
                lenderLabel={acceptedOffer?.lenderLabel ?? "the lender"}
                role="applicant"
                busy={busy}
                onDraw={() =>
                  setConfirm({
                    title: "Draw the credit line",
                    detail: "Marks the loan active on the marketplace.",
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
                    detail: "Marks the loan repaid on the marketplace.",
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
 * `ProverProvider` sits at the top of the borrower workspace so exactly one
 * Groth16 prover worker exists and starts fetching its artifacts the moment
 * this chunk loads, long before a policy challenge arrives.
 */
export function BorrowerView({ onOpenLender }: { onOpenLender: () => void }) {
  return (
    <ProverProvider>
      <WitnessProvider>
        <EnsIdentityProvider>
          <BorrowerWorkspace onOpenLender={onOpenLender} />
        </EnsIdentityProvider>
      </WitnessProvider>
    </ProverProvider>
  );
}

export default BorrowerView;
