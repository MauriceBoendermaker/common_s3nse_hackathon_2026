import type { Dispatch, SetStateAction } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDollarSign,
  EyeOff,
  FileCheck2,
  Inbox,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { formatCurrency, POLICY_OPTIONS, PRODUCT_CONFIG } from "../config/product";
import {
  evaluatePolicy,
  type DemoState,
  type LendingPolicy,
} from "../state/demo";
import { FlowSteps } from "./FlowSteps";
import { ProofCheck } from "./ProofCheck";
import { Button, Card, Spinner, StatusPill } from "./ui";

type LenderViewProps = {
  demo: DemoState;
  setDemo: Dispatch<SetStateAction<DemoState>>;
  onLoadSample: () => void;
  onOpenBorrower: () => void;
};

const lenderSteps = [
  { label: "Review request", description: "Inspect public loan terms" },
  { label: "Verify ZK proof", description: "Apply an underwriting policy" },
  { label: "Price the loan", description: "Create a private offer" },
  { label: "Borrower decision", description: "Return the offer to the borrower" },
] as const;

function getLenderStep(demo: DemoState) {
  if (demo.offerStatus !== "none") return 3;
  if (demo.verificationStatus === "eligible") return 2;
  return 1;
}

export function LenderView({
  demo,
  setDemo,
  onLoadSample,
  onOpenBorrower,
}: LenderViewProps) {
  const policyResults = evaluatePolicy(demo.policy);
  const eligible = policyResults.every((result) => result.passed);
  const currentStep = getLenderStep(demo);

  const updatePolicy = <Key extends keyof LendingPolicy>(
    key: Key,
    value: LendingPolicy[Key],
  ) => {
    setDemo((current) => ({
      ...current,
      policy: { ...current.policy, [key]: value },
      verificationStatus: "idle",
      offerStatus: "none",
    }));
  };

  if (!demo.requestPublished) {
    return (
      <div className="product-page" id="top">
        <header className="product-page__header">
          <div>
            <span className="eyebrow">Lender journey</span>
            <h1>Verify borrowers without collecting their data.</h1>
          </div>
        </header>

        <Card className="empty-workspace">
          <span className="task-icon"><Inbox size={22} /></span>
          <span className="section-label">Request inbox</span>
          <h2>No private credit request yet</h2>
          <p>Complete the borrower flow first, or load the prepared hackathon scenario.</p>
          <div className="empty-workspace__actions">
            <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowLeft size={16} />}>
              Open borrower flow
            </Button>
            <Button onClick={onLoadSample} icon={<ArrowRight size={16} />}>
              Load sample request
            </Button>
          </div>
          <small>Sample data is clearly marked and does not represent a real onchain loan.</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Lender journey</span>
          <h1>Price the proof—not the portfolio.</h1>
        </div>
        <StatusPill tone="success"><ShieldCheck size={14} /> ZK proof attached</StatusPill>
      </header>

      <div className="workflow-shell lender-shell">
        <aside className="workflow-sidebar lender-sidebar">
          <div className="request-sidebar__header">
            <span className="avatar" aria-hidden="true">A</span>
            <div><strong>{PRODUCT_CONFIG.borrower.ensName}</strong><span>ENS borrower identity</span></div>
          </div>
          <div className="request-sidebar__amount">
            <span>Requested</span>
            <strong>{formatCurrency(demo.amount)}</strong>
            <small>USDC · {demo.termDays} days</small>
          </div>
          <dl className="request-sidebar__terms">
            <div><dt>First-loss deposit</dt><dd>{formatCurrency(demo.collateral)}</dd></div>
            <div><dt>Raw data received</dt><dd>None</dd></div>
            <div><dt>Proof status</dt><dd>Sealed</dd></div>
          </dl>
          <div className="sealed-note">
            <LockKeyhole size={16} />
            <span><strong>Claims remain sealed</strong> until you verify them against a policy.</span>
          </div>
          <FlowSteps steps={lenderSteps} currentStep={currentStep} />
        </aside>

        <main className="workflow-main">
          {demo.offerStatus === "sent" || demo.offerStatus === "accepted" ? (
            <Card className="task-card offer-sent-card">
              <span className="success-seal"><Check size={25} /></span>
              <span className="section-label">Offer delivered</span>
              <h2>{formatCurrency(demo.amount)} at {demo.offerApr}% APR</h2>
              <p>
                The offer was sent to {PRODUCT_CONFIG.borrower.ensName}. No portfolio data
                was requested, stored, or disclosed.
              </p>
              <div className="receipt-lines">
                <span><strong>Borrower</strong>{PRODUCT_CONFIG.borrower.ensName}</span>
                <span><strong>Lender</strong>{PRODUCT_CONFIG.lender.ensName}</span>
                <span><strong>ZK receipt</strong>{PRODUCT_CONFIG.borrower.proofId}</span>
              </div>
              <div className="task-card__action task-card__action--center">
                <Button onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>
                  View borrower decision
                </Button>
              </div>
            </Card>
          ) : demo.verificationStatus === "eligible" || demo.verificationStatus === "ineligible" ? (
            <Card className="task-card verification-card">
              <div className="task-card__heading">
                <span className={eligible ? "task-icon task-icon--success" : "task-icon task-icon--danger"}>
                  {eligible ? <ShieldCheck size={22} /> : <FileCheck2 size={22} />}
                </span>
                <div>
                  <span className="section-label">Zero-knowledge verification</span>
                  <h2>{eligible ? "Borrower satisfies this policy" : "Policy not satisfied"}</h2>
                  <p>
                    {eligible
                      ? "Every claim passed. The witness and exact values remain hidden."
                      : "One or more thresholds failed. Exact borrower values remain hidden."}
                  </p>
                </div>
              </div>

              <div className="claim-grid verification-claims">
                {policyResults.map((result) => (
                  <ProofCheck
                    key={result.key}
                    label={result.label}
                    result={result.passed ? "Satisfied" : "Not satisfied"}
                    privacy={result.requirement}
                    status={result.passed ? "pass" : "fail"}
                    compact
                  />
                ))}
              </div>

              <div className="zero-knowledge-callout">
                <span className="zk-mark">ZK</span>
                <div><strong>Verified without disclosure</strong><span>No balances, positions, wallet addresses, or counterparties were transmitted.</span></div>
                <EyeOff size={18} />
              </div>

              {eligible ? (
                <div className="offer-builder">
                  <div>
                    <span className="section-label">Price the verified request</span>
                    <h3>Create an offer</h3>
                  </div>
                  <label className="apr-field">
                    <span>APR</span>
                    <span className="apr-input">
                      <input
                        type="number"
                        min="1"
                        max="40"
                        step="0.1"
                        value={demo.offerApr}
                        onChange={(event) =>
                          setDemo((current) => ({ ...current, offerApr: Number(event.target.value) }))
                        }
                      />
                      <span>%</span>
                    </span>
                  </label>
                </div>
              ) : null}

              <div className="task-card__action">
                <Button
                  variant="quiet"
                  onClick={() => setDemo((current) => ({ ...current, verificationStatus: "idle" }))}
                  icon={<ArrowLeft size={15} />}
                >
                  Revise policy
                </Button>
                {eligible ? (
                  <Button
                    onClick={() => setDemo((current) => ({ ...current, offerStatus: "sent" }))}
                    icon={<Landmark size={16} />}
                  >
                    Send offer
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card className="task-card policy-task-card">
              <div className="task-card__heading">
                <span className="task-icon"><SlidersHorizontal size={22} /></span>
                <div>
                  <span className="section-label">Zero-knowledge underwriting</span>
                  <h2>Set the policy this proof must satisfy</h2>
                  <p>You receive one result per claim. The borrower’s exact values stay hidden.</p>
                </div>
              </div>

              <div className="policy-grid">
                <label className="form-field">
                  <span>Minimum portfolio assets</span>
                  <select
                    value={demo.policy.minimumAssets}
                    onChange={(event) => updatePolicy("minimumAssets", Number(event.target.value))}
                  >
                    {POLICY_OPTIONS.minimumAssets.map((value) => (
                      <option value={value} key={value}>{formatCurrency(value)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Maximum debt ratio</span>
                  <select
                    value={demo.policy.maximumDebtRatio}
                    onChange={(event) => updatePolicy("maximumDebtRatio", Number(event.target.value))}
                  >
                    {POLICY_OPTIONS.maximumDebtRatio.map((value) => (
                      <option value={value} key={value}>{value}%</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Minimum account history</span>
                  <select
                    value={demo.policy.minimumHistoryMonths}
                    onChange={(event) => updatePolicy("minimumHistoryMonths", Number(event.target.value))}
                  >
                    {POLICY_OPTIONS.minimumHistoryMonths.map((value) => (
                      <option value={value} key={value}>{value} months</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="policy-toggle"
                  role="switch"
                  aria-checked={demo.policy.screenRestrictedExposure}
                  onClick={() =>
                    updatePolicy("screenRestrictedExposure", !demo.policy.screenRestrictedExposure)
                  }
                >
                  <span><strong>Restricted exposure screen</strong><small>Require a clean proof</small></span>
                  <span className={demo.policy.screenRestrictedExposure ? "toggle is-on" : "toggle"} aria-hidden="true"><span /></span>
                </button>
              </div>

              <div className="sealed-claims">
                <div className="sealed-claims__header">
                  <span><LockKeyhole size={16} /> Attached proof</span>
                  <span className="mono-value">{PRODUCT_CONFIG.borrower.proofId}</span>
                </div>
                {PRODUCT_CONFIG.proofClaims.map((claim) => (
                  <ProofCheck
                    key={claim.label}
                    label={claim.label}
                    result="Sealed until verification"
                    status="sealed"
                    compact
                  />
                ))}
              </div>

              <div className="task-card__action">
                <span className="action-note"><EyeOff size={15} /> Verification returns no raw data</span>
                <Button
                  disabled={demo.verificationStatus === "verifying"}
                  onClick={() => setDemo((current) => ({ ...current, verificationStatus: "verifying" }))}
                  icon={demo.verificationStatus === "verifying" ? <Spinner /> : <ShieldCheck size={16} />}
                >
                  {demo.verificationStatus === "verifying" ? "Verifying ZK proof" : "Verify ZK proof"}
                </Button>
              </div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
