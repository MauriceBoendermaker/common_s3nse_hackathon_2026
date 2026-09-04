/**
 * The disclosed / withheld split.
 *
 * Previously this rendered two hard-coded lists, which meant it stated a
 * privacy property rather than showing one. It now derives the disclosed
 * column PROGRAMMATICALLY from the actual `PublicSignals` of a real
 * `ProofSubmission` when one exists — the seven values, with the value itself
 * shown for the ones that are genuinely public — and falls back to the seven
 * signal names when no proof has been produced yet.
 *
 * The withheld column is the complement by construction: those fields have no
 * home in any type that crosses the boundary.
 */

import { Check, EyeOff, ShieldCheck } from "lucide-react";

import { PRODUCT_CONFIG } from "../config/product";
import type { ProofSubmission } from "../shared/protocol-types";
import { shortId } from "../state/shortId";

type PrivacyBoundaryProps = {
  compact?: boolean;
  /** When present, the disclosed column is read off this proof's signals. */
  proof?: ProofSubmission | null;
};

/** The layout is fixed by `protocol-types.ts` — index order matters. */
const SIGNAL_LABELS: Array<{ key: keyof ProofSubmission["publicSignals"]; label: string }> = [
  { key: "passportCommitment", label: "[0] passportCommitment" },
  { key: "eligible", label: "[1] eligible" },
  { key: "policyHash", label: "[2] policyHash" },
  { key: "subjectCommitment", label: "[3] subjectCommitment" },
  { key: "expiry", label: "[4] expiry" },
  { key: "nullifier", label: "[5] nullifier" },
  { key: "verifierCommitment", label: "[6] verifierCommitment" },
];

function renderSignal(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return new Date(value * 1000).toISOString().slice(0, 16).replace("T", " ");
  return shortId(value);
}

export function PrivacyBoundary({ compact = false, proof = null }: PrivacyBoundaryProps) {
  const limit = compact ? 3 : SIGNAL_LABELS.length;
  const signals = proof?.publicSignals ?? null;

  return (
    <section className={compact ? "privacy-boundary is-compact" : "privacy-boundary"}>
      <div className="privacy-boundary__header">
        <span className="zk-mark" aria-hidden="true">
          {proof ? proof.publicSignals.eligible ? "OK" : "NO" : "ZK"}
        </span>
        <div>
          <strong>{signals ? "Public signals of this receipt" : "The disclosure boundary"}</strong>
          <span>
            {signals
              ? "Everything below is what the lender received — the whole of it"
              : "Seven public signals and a ~1.2 KB proof leave the applicant's browser; nothing else does"}
          </span>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </div>

      <div className="privacy-columns">
        <div>
          <span className="privacy-column__label">
            {signals ? "The capital provider received" : "The capital provider will receive"}
          </span>
          {SIGNAL_LABELS.slice(0, limit).map((signal) => (
            <span className="privacy-item" key={signal.key}>
              <Check size={14} /> {signal.label}
              {signals ? <em>{renderSignal(signals[signal.key])}</em> : null}
            </span>
          ))}
          {signals && !compact
            ? proof?.results.map((result) => (
                <span className="privacy-item" key={result.key}>
                  <Check size={14} /> {result.label}
                  <em>{result.passed ? "pass" : "fail"}</em>
                </span>
              ))
            : null}
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
