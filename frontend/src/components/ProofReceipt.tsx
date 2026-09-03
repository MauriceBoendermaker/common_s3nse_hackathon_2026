import { AlertTriangle, Clock3, EyeOff, FileKey2, ShieldCheck } from "lucide-react";
import { PRODUCT_CONFIG } from "../config/product";
import {
  evaluatePolicy,
  getPolicyFingerprint,
  type LendingPolicy,
  type ProofStatus,
} from "../state/demo";
import { ProofCheck } from "./ProofCheck";
import { StatusPill } from "./ui";

type ProofReceiptProps = {
  policy: LendingPolicy;
  status: Extract<ProofStatus, "ready" | "expired">;
};

export function ProofReceipt({ policy, status }: ProofReceiptProps) {
  const results = evaluatePolicy(policy);
  const expired = status === "expired";

  return (
    <section className={expired ? "proof-receipt proof-receipt--expired" : "proof-receipt"}>
      <div className="proof-receipt__header">
        <span>
          {expired ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
          {expired ? "ZK proof expired" : "Policy-bound ZK proof"}
        </span>
        <StatusPill tone={expired ? "danger" : "neutral"}>Simulated proof</StatusPill>
      </div>

      <dl className="proof-metadata">
        <div><dt>Proof ID</dt><dd>{PRODUCT_CONFIG.borrower.proofId}</dd></div>
        <div><dt>Policy hash</dt><dd>{getPolicyFingerprint(policy)}</dd></div>
        <div><dt>Intended verifier</dt><dd>{PRODUCT_CONFIG.lender.ensName}</dd></div>
        <div><dt>Circuit</dt><dd>{PRODUCT_CONFIG.proof.circuit}</dd></div>
        <div><dt>Verifier contract</dt><dd>{PRODUCT_CONFIG.proof.verifierContract} · Sepolia</dd></div>
        <div><dt>Created</dt><dd>{PRODUCT_CONFIG.proof.createdAt}</dd></div>
      </dl>

      <div className="proof-section-heading">
        <span><FileKey2 size={15} /> Public outputs</span>
        <small>Only pass or fail is disclosed</small>
      </div>
      <div className="claim-grid">
        {results.map((result) => (
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

      <div className="proof-private-row">
        <span><EyeOff size={15} /> Exact balances, positions, addresses and counterparties remain private</span>
        <span><Clock3 size={15} /> {expired ? "No longer valid" : `Valid until ${PRODUCT_CONFIG.borrower.proofValidUntil}`}</span>
      </div>
    </section>
  );
}
