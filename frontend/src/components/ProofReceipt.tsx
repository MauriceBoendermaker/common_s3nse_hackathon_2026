/**
 * The receipt, rendered from the submission and nothing else.
 *
 * The old version called `evaluatePolicy(policy)`, which read the frozen demo
 * witness constant that used to live in `config/product.ts`.
 * That meant the LENDER's own component recomputed the verdict from the
 * borrower's secret — the privacy boundary was decorative in the most literal
 * possible way. This component now has no access to a witness and no way to
 * acquire one: its props are a `ProofSubmission` and the `PolicyChallenge` it
 * answers, neither of which has a portfolio field.
 *
 * What it shows is what actually exists: the seven public signals, the four
 * pass/fail results the borrower published, and — when the lender has run
 * verification — the server's own re-checks with the server's own detail
 * strings.
 *
 * Honesty, in both directions. A `groth16-bn254` receipt carries a real BN254
 * Groth16 proof, produced in the applicant's browser and checked server-side
 * against a committed verifying key — and the trusted setup behind that key is
 * a development ceremony, which the disclaimer at the foot of this component
 * states plainly rather than burying. A `policy-eval-v0` receipt is a local
 * policy evaluation over a real Solana-derived snapshot and is NOT a
 * zero-knowledge proof; `POST /api/proofs` refuses that system now, so one can
 * only appear here if it predates the circuit.
 */

import { AlertTriangle, Check, Clock3, EyeOff, FileKey2, ShieldCheck, X } from "lucide-react";

import { formatCountdown } from "../shared/format";
import {
  ARTIFACT_HASHES,
  CIRCOM_VERSION,
  CIRCUIT_CONSTRAINTS,
  CIRCUIT_NAME,
  N_PUBLIC_SIGNALS,
  PUBLIC_SIGNAL_ORDER,
} from "../shared/signalLayout";
import { shortHash } from "../shared/policy";
import type { PolicyChallenge, ProofSubmission } from "../shared/protocol-types";
import { ProofCheck } from "./ProofCheck";
import { Disclosure, StatusPill } from "./ui";

type ProofReceiptProps = {
  proof: ProofSubmission;
  challenge: PolicyChallenge;
  /** Lender side: render the server's verification checklist below the signals. */
  showVerification?: boolean;
  /** Ticking clock for the expiry countdown. Pass `useNow()`. */
  now?: number;
};

export function ProofReceipt({
  proof,
  challenge,
  showVerification = false,
  now = Date.now(),
}: ProofReceiptProps) {
  const expiryMs = proof.publicSignals.expiry * 1000;
  const expired = expiryMs <= now;
  const eligible = proof.publicSignals.eligible;
  const rejected = proof.verification.status === "rejected";

  return (
    <section className={expired || rejected ? "proof-receipt proof-receipt--expired" : "proof-receipt"}>
      <div className="proof-receipt__header">
        <span>
          {expired || rejected ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
          {rejected
            ? "Receipt rejected by the verifier"
            : expired
              ? "Receipt expired"
              : eligible
                ? "Policy satisfied"
                : "Policy not satisfied"}
        </span>
        <StatusPill tone={proof.proofSystem === "groth16-bn254" ? "success" : "warning"}>
          {proof.proofSystem}
        </StatusPill>
      </div>

      {/*
        THE ORDER HERE IS THE POINT.

        This block used to open with ten rows of field elements, then six rows
        of circuit metadata, then two paragraphs, and only then the four
        outcomes anyone actually reads. Every one of those values is load-
        bearing evidence and none of it can be deleted — but a reader who has
        to scroll past a Poseidon hash to find out whether the applicant
        qualified is a reader who stops reading. Outcomes first; the machinery
        that produced them one click away, unabridged.
      */}
      <div className="proof-section-heading">
        <span>
          <FileKey2 size={15} /> What the proof says
        </span>
        <small>Pass or fail only — never the values behind them</small>
      </div>
      <div className="claim-grid">
        {proof.results.map((result) => (
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

      <Disclosure
        summary="The public signals this receipt carries"
        count={`${N_PUBLIC_SIGNALS} signals`}
      >
        <dl className="proof-metadata">
          <div>
            <dt>Receipt id</dt>
            <dd>{proof.id}</dd>
          </div>
          <div>
            <dt>Passport commitment [0]</dt>
            <dd>{shortHash(proof.publicSignals.passportCommitment)}</dd>
          </div>
          <div>
            <dt>Eligible [1]</dt>
            <dd>{eligible ? "1" : "0"}</dd>
          </div>
          <div>
            <dt>Policy hash [2]</dt>
            <dd>{shortHash(proof.publicSignals.policyHash)}</dd>
          </div>
          <div>
            <dt>Subject commitment [3]</dt>
            <dd>{shortHash(proof.publicSignals.subjectCommitment)}</dd>
          </div>
          <div>
            <dt>Expiry [4]</dt>
            <dd>{formatCountdown(expiryMs, now)}</dd>
          </div>
          <div>
            <dt>Nullifier [5]</dt>
            <dd>{shortHash(proof.publicSignals.nullifier)}</dd>
          </div>
          <div>
            <dt>Verifier commitment [6]</dt>
            <dd>{shortHash(proof.publicSignals.verifierCommitment)}</dd>
          </div>
          <div>
            <dt>Bound verifier</dt>
            <dd>
              {challenge.lenderLabel} · {shortHash(challenge.verifierCommitment)}
            </dd>
          </div>
          <div>
            <dt>Proof bytes</dt>
            <dd>{proof.proof ? `${proof.proof.length} chars of JSON` : "none (policy-eval-v0)"}</dd>
          </div>
        </dl>
      </Disclosure>

      {proof.proofSystem === "groth16-bn254" ? (
        <Disclosure
          summary="The statement that was proven, and where"
          count={`${CIRCUIT_CONSTRAINTS.total.toLocaleString("en-US")} constraints`}
        >
          <dl className="proof-metadata">
            <div>
              <dt>Circuit</dt>
              <dd>
                {CIRCUIT_NAME}.circom · {CIRCOM_VERSION}
              </dd>
            </div>
            <div>
              <dt>Constraints</dt>
              <dd>
                {CIRCUIT_CONSTRAINTS.nonLinear} non-linear + {CIRCUIT_CONSTRAINTS.linear} linear
              </dd>
            </div>
            <div>
              <dt>Public signals</dt>
              <dd>
                {N_PUBLIC_SIGNALS} · {PUBLIC_SIGNAL_ORDER.join(", ")}
              </dd>
            </div>
            <div>
              <dt>Curve</dt>
              <dd>BN254 · Groth16</dd>
            </div>
            <div>
              <dt>Verifying key sha256</dt>
              <dd title={ARTIFACT_HASHES.verificationKey}>
                {ARTIFACT_HASHES.verificationKey.slice(0, 16)}…
              </dd>
            </div>
            <div>
              <dt>Where it was proven</dt>
              <dd>the applicant&apos;s browser</dd>
            </div>
          </dl>
          <p className="provenance-note">
            <strong>The witness never left the applicant&apos;s tab</strong> — not as policy, as
            plumbing. Proving runs in a Web Worker in that browser: the portfolio values are
            arguments to <code>groth16.fullProve</code> in the same process, and no request body in
            the protocol has a field that could carry them. What crossed the wire is the{" "}
            {N_PUBLIC_SIGNALS} field elements above and a ~1.2 KB proof. The verifying key hash is
            the browser&apos;s copy; the server states its own hash in the checks below, and refuses
            to verify at all if the two differ.
          </p>
        </Disclosure>
      ) : null}

      {showVerification ? (
        <>
          <div className="proof-section-heading">
            <span>
              <ShieldCheck size={15} /> Verifier re-checks
            </span>
            <small>
              {proof.verification.checkedAt === null
                ? "Not yet run"
                : `Run server-side · status ${proof.verification.status}`}
            </small>
          </div>
          {proof.verification.checks.length > 0 ? (
            <ul className="verifier-checks">
              {proof.verification.checks.map((check) => (
                <li className={check.passed ? "is-pass" : "is-fail"} key={check.name}>
                  <span className="verifier-checks__mark" aria-hidden="true">
                    {check.passed ? <Check size={13} /> : <X size={13} />}
                  </span>
                  <span>
                    <strong>{check.name}</strong>
                    <small>{check.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="provenance-note">
              The verifier has not been run on this receipt yet. Nothing here is trusted until it has.
            </p>
          )}
          {proof.verification.reason ? (
            <p className="provenance-note provenance-note--flag">{proof.verification.reason}</p>
          ) : null}
        </>
      ) : null}

      <div className="proof-private-row">
        <span>
          <EyeOff size={15} /> Exact balances, per-mint holdings and the salt never left the applicant&apos;s
          browser
        </span>
        <span>
          <Clock3 size={15} /> {formatCountdown(expiryMs, now)}
        </span>
      </div>

      {proof.proofSystem === "groth16-bn254" ? (
        <Disclosure summary="The honest caveat: this trusted setup is not trustworthy">
        <p className="proof-receipt__disclaimer">
          <strong>The trusted setup is a development ceremony, not a real one.</strong> The proving
          and verifying keys were generated on one machine by one person. Whoever ran it
          could forge proofs that verify. The transcript records both phase-2 contributions, the
          beacon and every hash — read it:{" "}
          <a
            href="https://github.com/MauriceBoendermaker/common_s3nse_hackathon_2026/blob/development/zk/build/ceremony-transcript.md"
            target="_blank"
            rel="noreferrer"
          >
            <code>zk/build/ceremony-transcript.md</code>
          </a>
          . Everything else here is enforced for real: the proof is a genuine BN254 Groth16 proof
          over the {CIRCUIT_CONSTRAINTS.total.toLocaleString("en-US")}-constraint{" "}
          <code>credit_policy</code> circuit, produced in the applicant&apos;s browser, and the
          server re-checks the pairing equation against the same verifying key rather than trusting
          this receipt.
        </p>
        </Disclosure>
      ) : null}

      {proof.proofSystem === "policy-eval-v0" ? (
        <p className="proof-receipt__disclaimer">
          <strong>This is not a zero-knowledge proof.</strong> The policy was evaluated locally, in the
          applicant&apos;s browser, over a real witness read from Solana mainnet. This receipt predates the
          circuit; the endpoint no longer accepts this proof system. Everything around it is enforced: the passport
          commitment was published before this challenge existed, the server recomputes the policy hash from
          its own copy of the policy, the receipt expires, and the nullifier makes a second presentation of
          it fail.
        </p>
      ) : null}
    </section>
  );
}
