import { Check, EyeOff, ShieldCheck } from "lucide-react";
import { PRODUCT_CONFIG } from "../config/product";

type PrivacyBoundaryProps = {
  compact?: boolean;
};

export function PrivacyBoundary({ compact = false }: PrivacyBoundaryProps) {
  return (
    <section className={compact ? "privacy-boundary is-compact" : "privacy-boundary"}>
      <div className="privacy-boundary__header">
        <span className="zk-mark" aria-hidden="true">ZK</span>
        <div>
          <strong>Zero-knowledge proof</strong>
          <span>Verify the policy without revealing the portfolio</span>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </div>

      <div className="privacy-columns">
        <div>
          <span className="privacy-column__label">The capital provider receives</span>
          {PRODUCT_CONFIG.proofClaims.slice(0, compact ? 3 : 4).map((claim) => (
            <span className="privacy-item" key={claim.label}>
              <Check size={14} /> {claim.label}: pass or fail
            </span>
          ))}
        </div>
        <div className="privacy-columns__hidden">
          <span className="privacy-column__label">The capital provider never receives</span>
          {PRODUCT_CONFIG.hiddenData.slice(0, compact ? 3 : 4).map((item) => (
            <span className="privacy-item" key={item}>
              <EyeOff size={14} /> {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
