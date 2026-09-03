import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  EyeOff,
  FileCheck2,
  Inbox,
  Landmark,
  LockKeyhole,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { formatCurrency, POLICY_OPTIONS, PRODUCT_CONFIG } from "../config/product";
import {
  getCapitalOffers,
  getPolicyFingerprint,
  type DemoState,
  type LendingPolicy,
  type WalletActionKind,
} from "../state/demo";
import { FlowSteps } from "./FlowSteps";
import { LoanLifecycle } from "./LoanLifecycle";
import { ProofReceipt } from "./ProofReceipt";
import { Button, Card, Spinner, StatusPill } from "./ui";

type LenderViewProps = {
  demo: DemoState;
  setDemo: Dispatch<SetStateAction<DemoState>>;
  onLoadSample: () => void;
  onOpenBorrower: () => void;
  onWalletAction: (kind: WalletActionKind) => void;
};

const providerSteps = [
  { label: "Review request", description: "Inspect public terms" },
  { label: "Send policy", description: "Define proof requirements" },
  { label: "Verify proof", description: "Check bound public outputs" },
  { label: "Fund offer", description: "Price and deposit USDC" },
  { label: "Track loan", description: "Monitor draw and repayment" },
] as const;

function getProviderStep(demo: DemoState) {
  if (demo.offerStatus !== "none" || demo.loanStatus !== "none") return 4;
  if (demo.verificationStatus === "eligible") return 3;
  if (demo.challengePolicy) return 2;
  return 1;
}

export function LenderView({ demo, setDemo, onLoadSample, onOpenBorrower, onWalletAction }: LenderViewProps) {
  const currentStep = getProviderStep(demo);
  const offers = getCapitalOffers(demo);
  const selectedOffer = offers.find((offer) => offer.id === demo.selectedOfferId) ?? offers[0];

  const updatePolicy = <Key extends keyof LendingPolicy>(key: Key, value: LendingPolicy[Key]) => {
    setDemo((current) => ({
      ...current,
      policy: { ...current.policy, [key]: value },
      challengePolicy: null,
      proofStatus: "idle",
      verificationStatus: "idle",
      offerStatus: "none",
      offersAvailable: false,
      noQualifyingOffers: false,
    }));
  };

  const sendChallenge = () => {
    setDemo((current) => ({
      ...current,
      challengePolicy: { ...current.policy },
      proofStatus: "idle",
      verificationStatus: "idle",
      offersAvailable: false,
      noQualifyingOffers: false,
    }));
  };

  if (!demo.requestPublished) {
    return (
      <div className="product-page" id="top">
        <header className="product-page__header">
          <div><span className="eyebrow">Capital provider</span><h1>Review private credit requests.</h1></div>
        </header>
        <Card className="empty-workspace">
          <span className="task-icon"><Inbox size={22} /></span>
          <span className="section-label">Request inbox</span>
          <h2>No credit request yet</h2>
          <p>Complete the applicant flow first, or load the prepared frontend scenario.</p>
          <div className="empty-workspace__actions">
            <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowLeft size={16} />}>Open applicant workspace</Button>
            <Button onClick={onLoadSample} icon={<ArrowRight size={16} />}>Load sample request</Button>
          </div>
          <small>Sample data is clearly marked and does not represent a real onchain loan.</small>
        </Card>
      </div>
    );
  }

  const proofLabel = demo.proofStatus === "ready" ? "Proof received" : demo.proofStatus === "expired" ? "Proof expired" : demo.challengePolicy ? "Challenge sent" : "Awaiting policy";

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div><span className="eyebrow">Capital provider</span><h1>Underwrite without collecting raw portfolios.</h1></div>
        <StatusPill tone={demo.proofStatus === "ready" ? "success" : demo.proofStatus === "expired" ? "danger" : "neutral"}>
          {demo.proofStatus === "ready" ? <ShieldCheck size={14} /> : demo.proofStatus === "expired" ? <AlertTriangle size={14} /> : <span className="network-dot" />}
          {proofLabel}
        </StatusPill>
      </header>

      <div className="workflow-shell lender-shell">
        <aside className="workflow-sidebar lender-sidebar">
          <div className="request-sidebar__header">
            <span className="avatar avatar--ens" aria-hidden="true">A</span>
            <div><strong>{PRODUCT_CONFIG.borrower.ensName}</strong><span>ENS applicant identity</span></div>
          </div>
          <div className="request-sidebar__amount">
            <span>Requested</span><strong>{formatCurrency(demo.amount)}</strong><small>USDC · {demo.termDays} days</small>
          </div>
          <dl className="request-sidebar__terms">
            <div><dt>First-loss deposit</dt><dd>{formatCurrency(demo.collateral)}</dd></div>
            <div><dt>Raw data received</dt><dd>None</dd></div>
            <div><dt>Proof status</dt><dd>{demo.proofStatus === "ready" ? "Ready" : demo.proofStatus === "expired" ? "Expired" : "Not issued"}</dd></div>
          </dl>
          <div className="sealed-note">
            <LockKeyhole size={16} />
            <span><strong>Claims remain sealed</strong> until a policy-bound proof is verified.</span>
          </div>
          <FlowSteps steps={providerSteps} currentStep={currentStep} />
        </aside>

        <main className="workflow-main">
          {demo.offerStatus !== "none" || demo.loanStatus !== "none" ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon task-icon--success"><Landmark size={22} /></span>
                <div>
                  <span className="section-label">Loan lifecycle</span>
                  <h2>{demo.offerStatus === "funded" ? "Offer funded and delivered" : "Track the selected credit line"}</h2>
                  <p>{demo.offerStatus === "funded" ? `The funded offer is waiting for ${PRODUCT_CONFIG.borrower.ensName}.` : `The applicant selected ${selectedOffer.lender}. Lifecycle events remain visible to both sides.`}</p>
                </div>
              </div>

              {demo.offerStatus === "funded" && demo.loanStatus === "none" ? (
                <div className="funding-receipt">
                  <div><span>Funded amount</span><strong>{formatCurrency(demo.amount)} USDC</strong></div>
                  <div><span>APR</span><strong>{demo.offerApr}%</strong></div>
                  <div><span>Applicant</span><strong>{PRODUCT_CONFIG.borrower.ensName}</strong></div>
                  <div><span>Policy receipt</span><strong className="mono-value">{getPolicyFingerprint(demo.challengePolicy)}</strong></div>
                  <StatusPill tone="warning">Awaiting applicant decision</StatusPill>
                </div>
              ) : (
                <LoanLifecycle amount={demo.amount} termDays={demo.termDays} offer={selectedOffer} status={demo.loanStatus} role="provider" />
              )}

              <div className="task-card__action">
                <span className="action-note"><EyeOff size={15} /> No underlying portfolio was received</span>
                <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>Open applicant workspace</Button>
              </div>
            </Card>
          ) : demo.verificationStatus === "eligible" || demo.verificationStatus === "ineligible" || demo.verificationStatus === "expired" ? (
            <Card className="task-card verification-card">
              <div className="task-card__heading">
                <span className={demo.verificationStatus === "eligible" ? "task-icon task-icon--success" : "task-icon task-icon--danger"}>
                  {demo.verificationStatus === "eligible" ? <ShieldCheck size={22} /> : <FileCheck2 size={22} />}
                </span>
                <div>
                  <span className="section-label">Zero-knowledge verification</span>
                  <h2>{demo.verificationStatus === "eligible" ? "Policy requirements satisfied" : demo.verificationStatus === "expired" ? "Proof is no longer valid" : "Policy requirements not satisfied"}</h2>
                  <p>{demo.verificationStatus === "eligible" ? "Every public output passed for this provider and policy hash." : demo.verificationStatus === "expired" ? "No underwriting decision was made from the expired receipt." : "One or more public outputs failed. Exact applicant values remain hidden."}</p>
                </div>
              </div>

              {demo.challengePolicy && (demo.proofStatus === "ready" || demo.proofStatus === "expired") ? <ProofReceipt policy={demo.challengePolicy} status={demo.proofStatus} /> : null}
              {demo.verificationStatus === "eligible" ? (
                <div className="offer-builder">
                  <div><span className="section-label">Fund a provider offer</span><h3>Price the verified request</h3><small>Funding creates the first live marketplace offer; two competitors are simulated for comparison.</small></div>
                  <label className="apr-field">
                    <span>APR</span>
                    <span className="apr-input"><input type="number" min="1" max="40" step="0.1" value={demo.offerApr} onChange={(event) => setDemo((current) => ({ ...current, offerApr: Number(event.target.value) }))} /><span>%</span></span>
                  </label>
                </div>
              ) : null}

              <div className="task-card__action">
                {demo.verificationStatus === "eligible" ? <span className="action-note"><WalletCards size={15} /> Funding requires a simulated wallet transaction</span> : <Button variant="quiet" onClick={() => setDemo((current) => ({ ...current, challengePolicy: null, proofStatus: "idle", verificationStatus: "idle", noQualifyingOffers: false }))} icon={<ArrowLeft size={15} />}>Revise policy</Button>}
                {demo.verificationStatus === "eligible" ? (
                  <Button onClick={() => onWalletAction("fund-offer")} icon={<Landmark size={16} />}>Fund and send offer</Button>
                ) : demo.verificationStatus === "expired" ? (
                  <Button onClick={() => { setDemo((current) => ({ ...current, proofStatus: "idle", verificationStatus: "idle" })); onOpenBorrower(); }} icon={<ArrowRight size={16} />}>Request fresh proof</Button>
                ) : <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>Notify applicant</Button>}
              </div>
            </Card>
          ) : demo.challengePolicy ? (
            <Card className="task-card proof-task-card">
              <div className="task-card__heading">
                <span className="task-icon task-icon--zk" aria-hidden="true">ZK</span>
                <div>
                  <span className="section-label">Step 3 of 5</span>
                  <h2>{demo.proofStatus === "ready" || demo.proofStatus === "expired" ? "Verify the policy-bound proof" : "Waiting for the applicant’s proof"}</h2>
                  <p>The requested proof is restricted to {PRODUCT_CONFIG.lender.ensName} and policy {getPolicyFingerprint(demo.challengePolicy)}.</p>
                </div>
              </div>

              {demo.proofStatus === "ready" || demo.proofStatus === "expired" ? (
                <ProofReceipt policy={demo.challengePolicy} status={demo.proofStatus} />
              ) : demo.proofStatus === "failed" ? (
                <div className="inline-state inline-state--danger"><AlertTriangle size={19} /><div><strong>Applicant reported a proving failure</strong><span>No receipt was produced. The challenge remains active.</span></div></div>
              ) : (
                <div className="waiting-state">
                  <span className="waiting-pulse" aria-hidden="true" />
                  <div><strong>{demo.proofStatus === "generating" ? "Applicant is generating a proof" : "Challenge delivered to alice.eth"}</strong><span>Raw passport inputs never enter this provider workspace.</span></div>
                  <Button variant="secondary" onClick={onOpenBorrower} icon={<ArrowRight size={16} />}>Open applicant workspace</Button>
                </div>
              )}

              <div className="task-card__action">
                <Button variant="quiet" onClick={() => setDemo((current) => ({ ...current, challengePolicy: null, proofStatus: "idle" }))} icon={<ArrowLeft size={15} />}>Withdraw challenge</Button>
                {demo.proofStatus === "ready" || demo.proofStatus === "expired" ? (
                  <Button disabled={demo.verificationStatus === "verifying"} onClick={() => setDemo((current) => ({ ...current, verificationStatus: "verifying" }))} icon={demo.verificationStatus === "verifying" ? <Spinner /> : <ShieldCheck size={16} />}>
                    {demo.verificationStatus === "verifying" ? "Verifying proof" : "Verify ZK proof"}
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card className="task-card policy-task-card">
              <div className="task-card__heading">
                <span className="task-icon"><SlidersHorizontal size={22} /></span>
                <div><span className="section-label">Step 2 of 5</span><h2>Define a verification policy</h2><p>Send precise requirements to the applicant. The resulting proof will be bound to this policy.</p></div>
              </div>

              <div className="request-ticket request-ticket--compact">
                <div><span className="section-label">Reviewed request</span><strong>{formatCurrency(demo.amount)} USDC</strong><small>{demo.termDays} days · {PRODUCT_CONFIG.borrower.ensName} · {formatCurrency(demo.collateral)} first-loss</small></div>
                <StatusPill tone="success"><Check size={14} /> Public terms reviewed</StatusPill>
              </div>

              <div className="policy-grid">
                <label className="form-field"><span>Minimum portfolio assets</span><select value={demo.policy.minimumAssets} onChange={(event) => updatePolicy("minimumAssets", Number(event.target.value))}>{POLICY_OPTIONS.minimumAssets.map((value) => <option value={value} key={value}>{formatCurrency(value)}</option>)}</select></label>
                <label className="form-field"><span>Maximum debt ratio</span><select value={demo.policy.maximumDebtRatio} onChange={(event) => updatePolicy("maximumDebtRatio", Number(event.target.value))}>{POLICY_OPTIONS.maximumDebtRatio.map((value) => <option value={value} key={value}>{value}%</option>)}</select></label>
                <label className="form-field"><span>Minimum account history</span><select value={demo.policy.minimumHistoryMonths} onChange={(event) => updatePolicy("minimumHistoryMonths", Number(event.target.value))}>{POLICY_OPTIONS.minimumHistoryMonths.map((value) => <option value={value} key={value}>{value} months</option>)}</select></label>
                <button type="button" className="policy-toggle" role="switch" aria-checked={demo.policy.screenRestrictedExposure} onClick={() => updatePolicy("screenRestrictedExposure", !demo.policy.screenRestrictedExposure)}>
                  <span><strong>Restricted exposure screen</strong><small>Require a clean proof</small></span><span className={demo.policy.screenRestrictedExposure ? "toggle is-on" : "toggle"} aria-hidden="true"><span /></span>
                </button>
              </div>

              <div className="policy-preview">
                <div><span>Policy fingerprint</span><strong className="mono-value">{getPolicyFingerprint(demo.policy)}</strong></div>
                <div><span>Intended prover</span><strong>{PRODUCT_CONFIG.borrower.ensName}</strong></div>
                <div><span>Intended verifier</span><strong>{PRODUCT_CONFIG.lender.ensName}</strong></div>
                <StatusPill tone="warning">Simulated policy request</StatusPill>
              </div>

              <button type="button" className="text-button text-button--danger policy-demo-action" onClick={() => updatePolicy("minimumAssets", 500_000)}>
                Load a policy that fails this demo profile
              </button>

              <div className="task-card__action">
                <span className="action-note"><EyeOff size={15} /> This requests proof outputs, not source data</span>
                {!demo.providerWalletConnected ? (
                  <Button onClick={() => onWalletAction("connect-provider")} icon={<WalletCards size={16} />}>Connect provider wallet</Button>
                ) : <Button onClick={sendChallenge} icon={<Send size={16} />}>Send policy challenge</Button>}
              </div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
