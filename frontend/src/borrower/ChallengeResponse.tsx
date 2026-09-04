/**
 * Step 4 — answer the lender's policy challenge with a real Groth16 proof.
 *
 * BORROWER-ONLY. This is the second and last component that touches the
 * private snapshot, and since workstream C part 2 it touches it for one
 * purpose: building the circuit input that goes into the prover worker. The
 * snapshot goes into `postMessage` to a worker in this same tab and stops
 * there. What leaves the browser is a ~1.2 KB BN254 Groth16 proof, seven public
 * field elements, and four booleans describing which comparisons passed.
 *
 * WHAT CHANGED, AND WHY IT MATTERS. The previous version ran
 * `evaluatePolicy(witness, policy)` in JavaScript and posted the four
 * resulting booleans under the label `policy-eval-v0`. Every binding around it
 * was real — the commitment was published before the challenge, the server
 * recomputed the policy hash, the nullifier was spent once — but the lender
 * still had to take the applicant's word for the comparisons themselves. Now
 * the circuit computes them, `eligible` is an output bit of a proof, and the
 * server checks a pairing equation instead of reading a boolean. The four
 * `PolicyResult` rows are still sent, because the UI renders human-readable
 * labels from them, and the server no longer needs to believe them: the same
 * verdict is inside the proof.
 *
 * The old flow's three lies are still gone: no `setTimeout` standing in for
 * proving (the half-second is now real work), no "Preview proving failure"
 * button, no "Preview expired proof" button.
 */

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, FileKey2, LockKeyhole, X } from "lucide-react";

import { PrivacyBoundary } from "../components/PrivacyBoundary";
import { ProofReceipt } from "../components/ProofReceipt";
import { Button, Card, Spinner, StatusPill } from "../components/ui";
import { ApiError, submitProof } from "../shared/apiClient";
import { formatCountdown, formatPercent, formatUsd } from "../shared/format";
import { evaluatePolicy, policyHash as derivePolicyHash, shortHash } from "../shared/policy";
import type { CreditRequest, PolicyChallenge, ProofSubmission } from "../shared/protocol-types";
import { decodePublicSignals } from "../shared/signalLayout";
import { useNow } from "../state/useNow";
import { buildProofInput, checkEmittedSignals } from "./buildProofInput";
import { useEnsIdentity } from "./ensIdentity";
import { useProver } from "./useProver";
import { useWitness } from "./witnessStore";

type ChallengeResponseProps = {
  request: CreditRequest;
  challenge: PolicyChallenge | null;
  proof: ProofSubmission | null;
  sessionId: string;
  onSubmitted: () => void;
  onOpenLender: () => void;
};

/** `3300000 -> "3.3 MB"`. */
function mb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(2) + " MB";
}

export function ChallengeResponse({
  request,
  challenge,
  proof,
  sessionId,
  onSubmitted,
  onOpenLender,
}: ChallengeResponseProps) {
  const witness = useWitness();
  const ens = useEnsIdentity();
  const prover = useProver();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"building" | "proving" | "submitting">("building");
  const [proveMs, setProveMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"prover" | "server">("server");

  const passport = witness.passport;
  const salt = witness.salt;
  const blindingFactor = witness.blindingFactor;

  const generate = async () => {
    if (!challenge || !passport || !salt || !blindingFactor || !witness.commitment) return;
    if (!ens.name) {
      setErrorSource("prover");
      setError(
        "no ENS identity on this session. The subject commitment at signal [3] is " +
          "Poseidon2(utf8ToField(ensName), blindingFactor) — with no name there is nothing to commit to.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setProveMs(null);
    setErrorSource("prover");

    try {
      // The four comparisons, still evaluated here — but only to render the
      // labelled rows. The circuit computes the same verdict, and it is the
      // circuit's `eligible` bit at signal [1] that the lender relies on.
      const results = evaluatePolicy(passport.witness, challenge.policy);

      setPhase("building");
      const built = await buildProofInput({
        witness: passport.witness,
        policy: challenge.policy,
        challenge,
        salt,
        // The IDENTITY, not the portfolio address. Committing to the Solana
        // address here would bind the receipt to where the money was read
        // rather than to who is borrowing, and would make the subject
        // commitment collide with a value already published in plaintext in
        // the provenance strip.
        subjectId: ens.name,
        blindingFactor,
      });

      setPhase("proving");
      const { proof: groth16Proof, publicSignals, ms } = await prover.prove(built.input);
      setProveMs(ms);

      // Did the circuit emit what this tab derived? A disagreement means the
      // browser's Poseidon and the circuit's have diverged, and the server
      // would reject the proof with an unexplained pairing failure. Catch it
      // here, where the sentence can name the signal.
      checkEmittedSignals(publicSignals, built.expectedPublicSignals);

      // The receipt is decoded from what the CIRCUIT actually emitted, in the
      // order derived from the compiled circuit, not from what this component
      // hoped it would emit.
      const decoded = decodePublicSignals(publicSignals);

      if (decoded.passportCommitment.toLowerCase() !== witness.commitment.toLowerCase()) {
        throw new Error(
          "the proof commits to " +
            decoded.passportCommitment +
            " but this request published " +
            witness.commitment +
            ". Refusing to submit a proof about a different snapshot.",
        );
      }

      setPhase("submitting");
      setErrorSource("server");
      await submitProof({
        sessionId,
        requestId: request.id,
        challengeId: challenge.id,
        proofSystem: "groth16-bn254",
        publicSignals: decoded,
        results,
        // The proof travels with its ORDERED public-signal array. That array
        // is what `snarkjs.groth16.verify` checks, so shipping it next to the
        // named object lets the server require the two to agree slot for slot.
        proof: JSON.stringify({ proof: groth16Proof, publicSignals }),
      });
      onSubmitted();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.detail
            ? `${cause.message} — ${cause.detail}`
            : cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!challenge) {
    return (
      <Card className="task-card proof-task-card">
        <div className="task-card__heading">
          <span className="task-icon task-icon--zk" aria-hidden="true">
            ZK
          </span>
          <div>
            <span className="section-label">Step 4 of 6</span>
            <h2>Waiting for a policy challenge</h2>
            <p>
              The request is live in the shared store. A lender has to choose thresholds before there is
              anything to answer.
            </p>
          </div>
        </div>

        <div className="waiting-state">
          <span className="waiting-pulse" aria-hidden="true" />
          <div>
            <strong>Request published · {formatUsd(request.amount)}</strong>
            <span>
              This panel is not polling on a timer. It is holding a long-poll open against{" "}
              <code>GET /api/state</code> and will re-render the moment the version moves.
            </span>
          </div>
          <Button variant="secondary" onClick={onOpenLender} icon={<ArrowRight size={16} />}>
            Open the lender workspace
          </Button>
        </div>

        <ProverStatusRow prover={prover} />
        <PrivacyBoundary compact />
      </Card>
    );
  }

  const localHash = derivePolicyHash(challenge.policy);
  const hashMatches = localHash === challenge.policyHash;
  const expired = challenge.expiresAt <= now;
  const proverReady = prover.status === "ready" || prover.status === "proving";

  return (
    <Card className="task-card proof-task-card">
      <div className="task-card__heading">
        <span className="task-icon task-icon--zk" aria-hidden="true">
          ZK
        </span>
        <div>
          <span className="section-label">Step 4 of 6</span>
          <h2>Answer the policy challenge</h2>
          <p>
            The proof is bound to this policy hash and this verifier commitment, so it cannot be replayed
            for different terms or handed to a different lender.
          </p>
        </div>
      </div>

      <div className="policy-summary">
        <div>
          <span>Issued by</span>
          <strong>{challenge.lenderLabel}</strong>
        </div>
        <div>
          <span>Policy hash</span>
          <strong className="mono-value">{shortHash(challenge.policyHash)}</strong>
        </div>
        <div>
          <span>Expires</span>
          <strong>{formatCountdown(challenge.expiresAt, now)}</strong>
        </div>
        <div>
          <span>Minimum collateral</span>
          <strong>{formatUsd(challenge.policy.minimumAssets)}</strong>
        </div>
        <div>
          <span>Minimum quality</span>
          <strong>{formatPercent(challenge.policy.minimumCollateralQuality)}</strong>
        </div>
        <div>
          <span>Minimum history</span>
          <strong>{challenge.policy.minimumHistoryMonths} months</strong>
        </div>
      </div>

      <div className={hashMatches ? "hash-check" : "hash-check hash-check--fail"}>
        <span className="hash-check__mark" aria-hidden="true">
          {hashMatches ? <Check size={13} /> : <X size={13} />}
        </span>
        <span>
          <strong>
            {hashMatches
              ? "Policy hash recomputed locally and matches"
              : "Policy hash does NOT match the thresholds shown"}
          </strong>
          <small>
            Poseidon over the four thresholds, computed in this tab: <code>{shortHash(localHash)}</code>. The
            circuit recomputes it a third time and constrains the proof to it, and the backend recomputes it
            a fourth time from the stored policy — so neither client is trusted for it.
          </small>
        </span>
      </div>

      <ProverStatusRow prover={prover} />

      {proof ? (
        <ProofReceipt proof={proof} challenge={challenge} now={now} />
      ) : busy ? (
        <div className="generating-state" role="status" aria-live="polite">
          <Spinner />
          <div>
            <strong>
              {phase === "building"
                ? "Building the circuit input"
                : phase === "proving"
                  ? "Proving in a Web Worker in this tab"
                  : "Submitting the proof"}
            </strong>
            <span>
              {phase === "proving"
                ? "groth16.fullProve over credit_policy — 2 980 constraints. The portfolio snapshot is an argument to a worker in this browser; it is not in any request body."
                : "buildProofInput → Poseidon commitments → groth16.fullProve → POST /api/proofs"}
            </span>
          </div>
        </div>
      ) : expired ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>This challenge expired</strong>
            <span>
              The server set <code>expiresAt</code> when the lender issued it. A proof produced now would
              carry an expiry in the past and be rejected. The lender has to reissue.
            </span>
          </div>
        </div>
      ) : (
        <PrivacyBoundary compact />
      )}

      {error ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>
              {errorSource === "prover"
                ? "The proof could not be produced in this browser"
                : "The server rejected the proof"}
            </strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="task-card__action">
        {proof ? (
          <>
            <span className="action-note">
              <LockKeyhole size={15} /> A proof, seven public signals and four booleans left this tab.
              {proveMs === null ? null : ` Proved in ${proveMs} ms.`}
            </span>
            <Button variant="secondary" onClick={onOpenLender} icon={<ArrowRight size={16} />}>
              Open the lender workspace
            </Button>
          </>
        ) : (
          <>
            <span className="action-note">
              <LockKeyhole size={15} />{" "}
              {proverReady
                ? "Proved in this tab. The snapshot is never sent anywhere."
                : "Loading the proving key — the button unlocks when it is in memory."}
            </span>
            <Button
              onClick={() => void generate()}
              disabled={busy || expired || !passport || !proverReady}
              icon={busy ? <Spinner /> : <FileKey2 size={16} />}
            >
              {busy ? "Proving" : "Generate the proof"}
            </Button>
          </>
        )}
      </div>

      {!proof ? (
        <StatusPill tone={proverReady ? "success" : "warning"}>
          groth16-bn254 · credit_policy · development trusted setup
        </StatusPill>
      ) : null}
    </Card>
  );
}

/**
 * The warmup, on screen.
 *
 * The worker is created when the applicant workspace mounts and immediately
 * fetches 4.6 MB of proving artifacts and runs one throwaway proof, so that the
 * real one costs only the proving. That is worth showing rather than hiding:
 * it is the visible evidence that proving happens in this browser, and it
 * explains the wait to somebody who would otherwise think the button is stuck.
 */
function ProverStatusRow({ prover }: { prover: ReturnType<typeof useProver> }) {
  if (prover.status === "error" && !prover.warmup) {
    return (
      <div className="inline-state inline-state--danger" role="alert">
        <AlertTriangle size={19} />
        <div>
          <strong>The prover could not start</strong>
          <span>{prover.error}</span>
        </div>
      </div>
    );
  }

  if (!prover.warmup) {
    return (
      <div className="generating-state" role="status" aria-live="polite">
        <Spinner />
        <div>
          <strong>Warming the prover</strong>
          <span>
            Fetching <code>/zk/credit_policy.wasm</code> and <code>/zk/credit_policy.zkey</code> into a Web
            Worker, then running one throwaway proof so the real one is fast.
          </span>
        </div>
      </div>
    );
  }

  const { ms, fetchMs, proveMs, wasmBytes, zkeyBytes } = prover.warmup;

  return (
    <p className="provenance-note">
      Prover ready in {ms} ms — {mb(wasmBytes)} witness calculator + {mb(zkeyBytes)} proving key fetched in{" "}
      {fetchMs} ms
      {proveMs === null ? "" : `, warmup proof in ${proveMs} ms`}. One worker, created when this workspace
      mounted and reused for every proof. The proving key comes from a{" "}
      <strong>development trusted setup</strong>: whoever ran the ceremony could forge proofs. That is a real
      caveat, not a formality — see <code>zk/build/ceremony-transcript.md</code>.
    </p>
  );
}
