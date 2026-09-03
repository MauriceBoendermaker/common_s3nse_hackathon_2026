import { Check, LockKeyhole, X } from "lucide-react";

type ProofCheckProps = {
  label: string;
  result: string;
  privacy?: string;
  compact?: boolean;
  status?: "pass" | "fail" | "sealed";
};

export function ProofCheck({
  label,
  result,
  privacy,
  compact = false,
  status = "pass",
}: ProofCheckProps) {
  return (
    <div className={`proof-check proof-check--${status}${compact ? " proof-check--compact" : ""}`}>
      <span className="proof-check__icon" aria-hidden="true">
        {status === "pass" ? <Check size={15} /> : status === "fail" ? <X size={15} /> : <LockKeyhole size={14} />}
      </span>
      <span className="proof-check__content">
        <span className="proof-check__label">{label}</span>
        <strong>{result}</strong>
      </span>
      {privacy ? <span className="proof-check__privacy">{privacy}</span> : null}
    </div>
  );
}
