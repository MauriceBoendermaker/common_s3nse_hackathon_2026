import type { Dispatch, SetStateAction } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  FileKey2,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { formatCurrency, PRODUCT_CONFIG } from "../config/product";
import type { DemoState } from "../state/demo";
import { FlowSteps } from "./FlowSteps";
import { PrivacyBoundary } from "./PrivacyBoundary";
import { ProofCheck } from "./ProofCheck";
import { Button, Card, Spinner, StatusPill } from "./ui";

type BorrowerViewProps = {
  demo: DemoState;
  setDemo: Dispatch<SetStateAction<DemoState>>;
  onConnect: () => void;
  onOpenLender: () => void;
};

const borrowerSteps = [
  { label: "Connect identity", description: "Anchor the passport to ENS" },
  { label: "Set loan terms", description: "Choose amount and duration" },
  { label: "Create ZK proof", description: "Prove the lender’s policy" },
  { label: "Compare offers", description: "Select a privately priced loan" },
] as const;

const amountOptions = [25_000, 50_000, 100_000];
const termOptions = [30, 60, 90];

function getBorrowerStep(demo: DemoState) {
  if (!demo.walletConnected) return 0;
  if (!demo.termsConfirmed) return 1;
  if (!demo.requestPublished) return 2;
  return 3;
}

export function BorrowerView({
  demo,
  setDemo,
  onConnect,
  onOpenLender,
}: BorrowerViewProps) {
  const currentStep = getBorrowerStep(demo);

  return (
    <div className="product-page" id="top">
      <header className="product-page__header">
        <div>
          <span className="eyebrow">Borrower journey</span>
          <h1>Get credit without exposing your portfolio.</h1>
        </div>
        <StatusPill tone={demo.requestPublished ? "success" : "neutral"}>
          {demo.requestPublished ? <Check size={14} /> : <span className="network-dot" />}
          {demo.requestPublished ? "Request live" : "Private draft"}
        </StatusPill>
      </header>

      <div className="workflow-shell">
        <aside className="workflow-sidebar">
          <div className="workflow-sidebar__intro">
            <span className="avatar avatar--ens" aria-hidden="true">A</span>
            <div>
              <strong>{PRODUCT_CONFIG.borrower.ensName}</strong>
              <span>{demo.walletConnected ? "ENS identity connected" : "Not connected"}</span>
            </div>
          </div>
          <FlowSteps steps={borrowerSteps} currentStep={currentStep} />
          <div className="sidebar-proof-note">
            <span className="zk-mark">ZK</span>
            <p><strong>Nothing raw is published.</strong> Only a pass/fail proof reaches lenders.</p>
          </div>
        </aside>

        <main className="workflow-main">
          {currentStep === 0 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><Fingerprint size={22} /></span>
                <div>
                  <span className="section-label">Step 1 of 4</span>
                  <h2>Connect your ENS identity</h2>
                  <p>Your ENS name anchors a private reputation that survives wallet rotation.</p>
                </div>
              </div>

              <div className="identity-preview">
                <div>
                  <span className="avatar avatar--large" aria-hidden="true">A</span>
                  <span>
                    <strong>{PRODUCT_CONFIG.borrower.ensName}</strong>
                    <small>Controller will be checked after connection</small>
                  </span>
                </div>
                <StatusPill tone="warning">Awaiting wallet</StatusPill>
              </div>

              <div className="task-card__action">
                <span className="action-note"><KeyRound size={15} /> No transaction or asset approval</span>
                <Button onClick={onConnect} icon={<WalletCards size={16} />}>
                  Connect MetaMask
                </Button>
              </div>
            </Card>
          ) : null}

          {currentStep === 1 ? (
            <Card className="task-card">
              <div className="task-card__heading">
                <span className="task-icon"><CircleDollarSign size={22} /></span>
                <div>
                  <span className="section-label">Step 2 of 4</span>
                  <h2>Define the credit request</h2>
                  <p>These terms are public. Your balances and positions remain private.</p>
                </div>
              </div>

              <div className="terms-layout">
                <div className="form-stack">
                  <label className="form-field">
                    <span>Credit amount</span>
                    <select
                      value={demo.amount}
                      onChange={(event) =>
                        setDemo((current) => ({ ...current, amount: Number(event.target.value) }))
                      }
                    >
                      {amountOptions.map((amount) => (
                        <option value={amount} key={amount}>{formatCurrency(amount)} USDC</option>
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
                          className={demo.termDays === days ? "is-selected" : undefined}
                          aria-pressed={demo.termDays === days}
                          onClick={() => setDemo((current) => ({ ...current, termDays: days }))}
                        >
                          {days} days
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <div className="terms-summary">
                  <span className="section-label">Public request</span>
                  <strong>{formatCurrency(demo.amount)}</strong>
                  <dl>
                    <div><dt>Asset</dt><dd>USDC</dd></div>
                    <div><dt>Term</dt><dd>{demo.termDays} days</dd></div>
                    <div><dt>First-loss deposit</dt><dd>{formatCurrency(demo.collateral)}</dd></div>
                  </dl>
                </div>
              </div>

              <div className="task-card__action">
                <Button
                  variant="quiet"
                  onClick={() => setDemo((current) => ({ ...current, walletConnected: false }))}
                  icon={<ArrowLeft size={15} />}
                >
                  Back
                </Button>
                <Button
                  onClick={() => setDemo((current) => ({ ...current, termsConfirmed: true }))}
                  icon={<ArrowRight size={16} />}
                >
                  Continue to ZK proof
                </Button>
              </div>
            </Card>
          ) : null}

          {currentStep === 2 ? (
            <Card className="task-card proof-task-card">
              <div className="task-card__heading">
                <span className="task-icon task-icon--zk">ZK</span>
                <div>
                  <span className="section-label">Step 3 of 4</span>
                  <h2>{demo.proofStatus === "ready" ? "Your ZK proof is ready" : "Generate a policy-bound proof"}</h2>
                  <p>
                    {demo.proofStatus === "ready"
                      ? "The proof contains the result—not your underlying financial data."
                      : "The proof checks four underwriting claims locally and reveals only pass or fail."}
                  </p>
                </div>
              </div>

              {demo.proofStatus === "generating" ? (
                <div className="generating-state" role="status" aria-live="polite">
                  <Spinner />
                  <div>
                    <strong>Generating zero-knowledge proof</strong>
                    <span>Building witness → evaluating claims → sealing proof</span>
                  </div>
                </div>
              ) : demo.proofStatus === "ready" ? (
                <div className="proof-receipt">
                  <div className="proof-receipt__header">
                    <span><ShieldCheck size={18} /> ZK proof generated</span>
                    <span className="mono-value">{PRODUCT_CONFIG.borrower.proofId}</span>
                  </div>
                  <div className="claim-grid">
                    {PRODUCT_CONFIG.proofClaims.map((claim) => (
                      <ProofCheck
                        key={claim.label}
                        label={claim.label}
                        result="Satisfied"
                        privacy="Witness hidden"
                        compact
                      />
                    ))}
                  </div>
                  <div className="proof-receipt__footer">
                    <span><Clock3 size={14} /> Valid until {PRODUCT_CONFIG.borrower.proofValidUntil}</span>
                    <span><LockKeyhole size={14} /> Wallet graph excluded</span>
                  </div>
                </div>
              ) : (
                <PrivacyBoundary compact />
              )}

              <div className="task-card__action">
                <Button
                  variant="quiet"
                  disabled={demo.proofStatus === "generating"}
                  onClick={() =>
                    setDemo((current) => ({ ...current, termsConfirmed: false, proofStatus: "idle" }))
                  }
                  icon={<ArrowLeft size={15} />}
                >
                  Edit terms
                </Button>
                {demo.proofStatus === "ready" ? (
                  <Button
                    onClick={() => setDemo((current) => ({ ...current, requestPublished: true }))}
                    icon={<ArrowRight size={16} />}
                  >
                    Publish sealed request
                  </Button>
                ) : (
                  <Button
                    disabled={demo.proofStatus === "generating"}
                    onClick={() => setDemo((current) => ({ ...current, proofStatus: "generating" }))}
                    icon={demo.proofStatus === "generating" ? <Spinner /> : <FileKey2 size={16} />}
                  >
                    {demo.proofStatus === "generating" ? "Generating proof" : "Generate ZK proof"}
                  </Button>
                )}
              </div>
            </Card>
          ) : null}

          {currentStep === 3 ? (
            <Card className="task-card market-card">
              <div className="task-card__heading">
                <span className="task-icon"><CircleDollarSign size={22} /></span>
                <div>
                  <span className="section-label">Step 4 of 4</span>
                  <h2>{demo.offerStatus === "none" ? "Your private request is live" : "A lender has made an offer"}</h2>
                  <p>Only the public terms and your sealed ZK proof are visible to lenders.</p>
                </div>
              </div>

              <div className="request-ticket">
                <div>
                  <span className="section-label">Credit request</span>
                  <strong>{formatCurrency(demo.amount)} USDC</strong>
                  <small>{demo.termDays} days · {PRODUCT_CONFIG.borrower.ensName}</small>
                </div>
                <StatusPill tone="success"><ShieldCheck size={14} /> ZK proof attached</StatusPill>
              </div>

              {demo.offerStatus === "none" ? (
                <div className="waiting-state">
                  <span className="waiting-pulse" aria-hidden="true" />
                  <div><strong>Waiting for lender verification</strong><span>Continue the demo from the lender workspace.</span></div>
                  <Button variant="secondary" onClick={onOpenLender} icon={<ArrowRight size={16} />}>
                    Open lender view
                  </Button>
                </div>
              ) : (
                <div className="offer-card">
                  <div className="offer-card__lender">
                    <span className="avatar" aria-hidden="true">V</span>
                    <span><strong>{PRODUCT_CONFIG.lender.ensName}</strong><small>Verified lending pool</small></span>
                    <StatusPill tone="success"><Check size={14} /> Proof accepted</StatusPill>
                  </div>
                  <div className="offer-metrics">
                    <div><span>Credit line</span><strong>{formatCurrency(demo.amount)}</strong></div>
                    <div><span>APR</span><strong>{demo.offerApr}%</strong></div>
                    <div><span>Term</span><strong>{demo.termDays} days</strong></div>
                  </div>
                  <div className="task-card__action task-card__action--flush">
                    <span className="action-note"><LockKeyhole size={15} /> No portfolio data was shared</span>
                    <Button
                      variant={demo.offerStatus === "accepted" ? "secondary" : "primary"}
                      disabled={demo.offerStatus === "accepted"}
                      onClick={() => setDemo((current) => ({ ...current, offerStatus: "accepted" }))}
                      icon={<Check size={16} />}
                    >
                      {demo.offerStatus === "accepted" ? "Offer accepted" : "Accept offer"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  );
}
