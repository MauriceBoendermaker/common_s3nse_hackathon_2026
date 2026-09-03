import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { formatCurrency } from "../config/product";
import {
  getTotalRepayment,
  type CapitalOffer,
  type LoanStatus,
} from "../state/demo";
import { Button, StatusPill } from "./ui";

type LoanLifecycleProps = {
  amount: number;
  termDays: number;
  offer: CapitalOffer;
  status: LoanStatus;
  role: "applicant" | "provider";
  onDraw?: () => void;
  onRepay?: () => void;
  onAdvanceDue?: () => void;
  onShowDefaultRisk?: () => void;
};

const lifecycleSteps: Array<{ status: LoanStatus; label: string }> = [
  { status: "funded", label: "Funded" },
  { status: "active", label: "Drawn" },
  { status: "repayment_due", label: "Repayment due" },
  { status: "repaid", label: "Repaid" },
];

const statusOrder: Record<LoanStatus, number> = {
  none: -1,
  funded: 0,
  active: 1,
  repayment_due: 2,
  default_risk: 2,
  repaid: 3,
};

export function LoanLifecycle({
  amount,
  termDays,
  offer,
  status,
  role,
  onDraw,
  onRepay,
  onAdvanceDue,
  onShowDefaultRisk,
}: LoanLifecycleProps) {
  const activeIndex = statusOrder[status];
  const totalRepayment = getTotalRepayment(amount, offer.apr, termDays, offer.fee);

  return (
    <div className="loan-lifecycle">
      <div className="loan-summary-grid">
        <div><span>Principal</span><strong>{formatCurrency(amount)}</strong></div>
        <div><span>APR</span><strong>{offer.apr}%</strong></div>
        <div><span>Due at maturity</span><strong>{formatCurrency(Math.round(totalRepayment))}</strong></div>
        <div><span>Provider</span><strong>{offer.lender}</strong></div>
      </div>

      <ol className="loan-timeline" aria-label="Loan lifecycle">
        {lifecycleSteps.map((step, index) => {
          const complete = activeIndex > index || status === "repaid";
          const current = activeIndex === index && !complete;
          return (
            <li className={complete ? "is-complete" : current ? "is-current" : undefined} key={step.status}>
              <span aria-hidden="true">{complete ? <Check size={13} /> : index + 1}</span>
              <strong>{step.label}</strong>
            </li>
          );
        })}
      </ol>

      {status === "funded" ? (
        <div className="lifecycle-callout">
          <ShieldCheck size={20} />
          <div><strong>Capital is funded</strong><span>{role === "applicant" ? "The credit line is available to draw." : "Waiting for the applicant to draw the credit line."}</span></div>
          {role === "applicant" && onDraw ? <Button onClick={onDraw} icon={<ArrowRight size={16} />}>Draw USDC</Button> : null}
        </div>
      ) : null}

      {status === "active" ? (
        <div className="lifecycle-callout">
          <CircleDollarSign size={20} />
          <div><strong>Loan active</strong><span>{termDays}-day maturity · interest accrues at {offer.apr}% APR.</span></div>
          {role === "applicant" && onAdvanceDue ? <Button variant="secondary" onClick={onAdvanceDue}>Advance to due date</Button> : null}
        </div>
      ) : null}

      {status === "repayment_due" ? (
        <div className="lifecycle-callout lifecycle-callout--warning">
          <Clock3 size={20} />
          <div><strong>Repayment is due</strong><span>{formatCurrency(Math.round(totalRepayment))} USDC is due today.</span></div>
          {role === "applicant" && onRepay ? <Button onClick={onRepay}>Repay loan</Button> : null}
        </div>
      ) : null}

      {status === "default_risk" ? (
        <div className="lifecycle-callout lifecycle-callout--danger">
          <AlertTriangle size={20} />
          <div><strong>Default risk</strong><span>The maturity passed without repayment. The first-loss deposit is now at risk.</span></div>
          {role === "applicant" && onRepay ? <Button onClick={onRepay}>Repay now</Button> : null}
        </div>
      ) : null}

      {status === "repaid" ? (
        <div className="lifecycle-callout lifecycle-callout--success">
          <Check size={20} />
          <div><strong>Loan repaid</strong><span>The repayment event can now update the ENS-anchored reputation commitment.</span></div>
          <StatusPill tone="success">Lifecycle complete</StatusPill>
        </div>
      ) : null}

      {role === "applicant" && status === "repayment_due" && onShowDefaultRisk ? (
        <button type="button" className="text-button text-button--danger lifecycle-demo-action" onClick={onShowDefaultRisk}>
          Preview default-risk state
        </button>
      ) : null}
    </div>
  );
}
