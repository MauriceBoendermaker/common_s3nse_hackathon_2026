/**
 * The loan, driven by the server's `Loan` row.
 *
 * Two things were removed and are not coming back until something implements
 * them: the "Preview default-risk state" button (a button that made the UI lie
 * about a loan it had not defaulted on), and the sentence "The repayment event
 * can now update the ENS-anchored reputation commitment" — no code anywhere
 * does that. `default_risk` still renders, because the server may legitimately
 * set it; there is simply no client-side button that fakes it.
 *
 * Every action here is an HTTP call the parent passes in.
 */

import { AlertTriangle, ArrowRight, Check, CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";

import { formatPercent, formatUsd } from "../shared/format";
import type { Loan, LoanStatus } from "../shared/protocol-types";
import { getTotalRepayment } from "../state/types";
import { Button, StatusPill } from "./ui";

type LoanLifecycleProps = {
  loan: Loan;
  lenderLabel: string;
  role: "applicant" | "provider";
  onDraw?: () => void;
  onMarkDue?: () => void;
  onRepay?: () => void;
  busy?: boolean;
};

const lifecycleSteps: Array<{ status: LoanStatus; label: string }> = [
  { status: "funded", label: "Funded" },
  { status: "active", label: "Drawn" },
  { status: "repayment_due", label: "Repayment due" },
  { status: "repaid", label: "Repaid" },
];

const statusOrder: Record<LoanStatus, number> = {
  funded: 0,
  active: 1,
  repayment_due: 2,
  default_risk: 2,
  repaid: 3,
};

function stamp(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

export function LoanLifecycle({
  loan,
  lenderLabel,
  role,
  onDraw,
  onMarkDue,
  onRepay,
  busy = false,
}: LoanLifecycleProps) {
  const activeIndex = statusOrder[loan.status];
  const totalRepayment = getTotalRepayment(loan.principal, loan.apr, loan.termDays, loan.fee);

  return (
    <div className="loan-lifecycle">
      <div className="loan-summary-grid">
        <div>
          <span>Principal</span>
          <strong>{formatUsd(loan.principal)}</strong>
        </div>
        <div>
          <span>APR</span>
          <strong>{formatPercent(loan.apr, 1)}</strong>
        </div>
        <div>
          <span>Due at maturity</span>
          <strong>{formatUsd(Math.round(totalRepayment))}</strong>
        </div>
        <div>
          <span>Provider</span>
          <strong>{lenderLabel}</strong>
        </div>
      </div>

      <ol className="loan-timeline" aria-label="Loan lifecycle">
        {lifecycleSteps.map((step, index) => {
          const complete = activeIndex > index || loan.status === "repaid";
          const current = activeIndex === index && !complete;
          return (
            <li
              className={complete ? "is-complete" : current ? "is-current" : undefined}
              key={step.status}
            >
              <span aria-hidden="true">{complete ? <Check size={13} /> : index + 1}</span>
              <strong>{step.label}</strong>
            </li>
          );
        })}
      </ol>

      {loan.status === "funded" ? (
        <div className="lifecycle-callout">
          <ShieldCheck size={20} />
          <div>
            <strong>Capital is funded</strong>
            <span>
              {role === "applicant"
                ? "The credit line is available to draw."
                : "Waiting for the applicant to draw the credit line."}
            </span>
          </div>
          {role === "applicant" && onDraw ? (
            <Button onClick={onDraw} disabled={busy} icon={<ArrowRight size={16} />}>
              Draw USDC
            </Button>
          ) : null}
        </div>
      ) : null}

      {loan.status === "active" ? (
        <div className="lifecycle-callout">
          <CircleDollarSign size={20} />
          <div>
            <strong>Loan active</strong>
            <span>
              {loan.termDays}-day maturity · interest accrues at {formatPercent(loan.apr, 1)} APR · drawn{" "}
              {stamp(loan.drawnAt)}
              {role === "applicant" ? " · the provider calls the loan due at maturity" : ""}
            </span>
          </div>
          {/*
            Calling a loan due is the LENDER's move, and the backend enforces
            it: `POST /api/loans/:id/due` answers a borrower session with 403.
            The button therefore only exists on the provider side — the UI does
            not offer an action the server would refuse.
          */}
          {role === "provider" && onMarkDue ? (
            <Button variant="secondary" onClick={onMarkDue} disabled={busy}>
              Call the loan due
            </Button>
          ) : null}
        </div>
      ) : null}

      {loan.status === "repayment_due" ? (
        <div className="lifecycle-callout lifecycle-callout--warning">
          <Clock3 size={20} />
          <div>
            <strong>Repayment is due</strong>
            <span>
              {formatUsd(Math.round(totalRepayment))} USDC due · marked due {stamp(loan.dueAt)}
            </span>
          </div>
          {role === "applicant" && onRepay ? (
            <Button onClick={onRepay} disabled={busy}>
              Repay loan
            </Button>
          ) : null}
        </div>
      ) : null}

      {loan.status === "default_risk" ? (
        <div className="lifecycle-callout lifecycle-callout--danger">
          <AlertTriangle size={20} />
          <div>
            <strong>Default risk</strong>
            <span>The maturity passed without repayment. The first-loss deposit is at risk.</span>
          </div>
          {role === "applicant" && onRepay ? (
            <Button onClick={onRepay} disabled={busy}>
              Repay now
            </Button>
          ) : null}
        </div>
      ) : null}

      {loan.status === "repaid" ? (
        <div className="lifecycle-callout lifecycle-callout--success">
          <Check size={20} />
          <div>
            <strong>Loan repaid</strong>
            <span>
              Repaid {stamp(loan.repaidAt)}. This is a state change on the shared row; no value
              moved. Settlement would land with the Solana program, which is not implemented.
            </span>
          </div>
          <StatusPill tone="success">Lifecycle complete</StatusPill>
        </div>
      ) : null}
    </div>
  );
}
