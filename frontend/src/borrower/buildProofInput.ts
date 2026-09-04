/**
 * BORROWER-ONLY. Turns the private snapshot plus the lender's challenge into
 * the exact input object `zk/circuits/credit_policy.circom` expects.
 *
 * This is the only file in the app that reads every private value at once, and
 * everything it returns is either a field element the circuit consumes
 * privately or a public signal the receipt was always going to carry. Nothing
 * here is serialised into an HTTP body: `useProver` hands the object to the
 * worker over `postMessage`, the worker returns a proof, and the object is
 * dropped.
 *
 * THREE THINGS THIS FILE HAS TO GET EXACTLY RIGHT, because getting any of them
 * subtly wrong produces proofs that fail verification with no useful error:
 *
 *  1. THE SAME REDUCTION AS THE BACKEND. Every value is pushed through
 *     `toField` / `hexToField` from `shared/policy.ts`, which mirrors
 *     `backend/src/protocol/hashing.ts` byte for byte. A salt or a subject id
 *     routinely exceeds the BN254 scalar field, and reducing it differently in
 *     two places is the classic "fails about one time in four and looks
 *     random" bug.
 *
 *  2. THE SAME POSEIDON ARITIES AND ARGUMENT ORDER. `policyHash`,
 *     `passportCommitment`, `nullifier` and `subjectCommitment` come from
 *     `shared/policy.ts` rather than being recomputed here, so there is one
 *     definition per hash in the browser, and the circuit re-derives all four
 *     internally and constrains them against the public signals.
 *
 *  3. THE PUBLIC SIGNAL ORDER. The expected signals are assembled through
 *     `encodePublicSignals` from the GENERATED `shared/signalLayout.ts`, which
 *     `zk/build.mjs` writes from the compiled `.r1cs` and `.sym`. If the
 *     circuit's wire order ever changes, the generated file changes with it and
 *     this code follows; nothing here hard-codes an index.
 */

import {
  hexToField,
  nullifier as deriveNullifier,
  passportCommitment as derivePassportCommitment,
  policyHash as derivePolicyHash,
  subjectCommitment as deriveSubjectCommitment,
  toField,
  utf8ToField,
} from "../shared/policy";
import type {
  LendingPolicy,
  PolicyChallenge,
  PublicSignals,
  Witness,
} from "../shared/protocol-types";
import { encodePublicSignals, PUBLIC_SIGNAL_ORDER } from "../shared/signalLayout";
import type { CircuitInput } from "./proverWorker";

export type BuildProofInputArgs = {
  witness: Witness;
  policy: LendingPolicy;
  challenge: PolicyChallenge;
  /** Fresh per passport, never published. Hides the commitment. */
  salt: string;
  /** The Solana address this passport was read for. */
  subjectId: string;
  /** Fresh per passport, never published. Hides the subject commitment. */
  blindingFactor: string;
};

export type BuiltProofInput = {
  input: CircuitInput;
  /** What the circuit must emit, in wire order. Checked against the proof. */
  expectedPublicSignals: string[];
  /** The same values as the protocol object the receipt carries. */
  publicSignals: PublicSignals;
};

/** Decimal string in the BN254 scalar field. */
const dec = (value: bigint | number | string): string => toField(value).toString();

/** Decimal string from an arbitrary-width hex value, reduced the same way. */
const hexDec = (value: string): string => hexToField(value).toString();

export async function buildProofInput({
  witness,
  policy,
  challenge,
  salt,
  subjectId,
  blindingFactor,
}: BuildProofInputArgs): Promise<BuiltProofInput> {
  /**
   * The policy the circuit will enforce must be the policy the lender
   * published. Recomputing it here and refusing a mismatch means a corrupted
   * or tampered challenge fails immediately, with a sentence, rather than 600
   * ms later as an unexplained pairing failure — the circuit constrains
   * `Poseidon4(thresholds) === policyHash`, so a mismatch cannot produce a
   * proof at all.
   */
  const localPolicyHash = derivePolicyHash(policy);
  if (localPolicyHash.toLowerCase() !== challenge.policyHash.toLowerCase()) {
    throw new Error(
      "policy hash mismatch: the thresholds on this challenge hash to " +
        localPolicyHash +
        " but the challenge claims " +
        challenge.policyHash +
        ". Refusing to prove a policy that is not the one on screen.",
    );
  }

  /**
   * `historyMonths === null` is the indeterminate case: the bounded signature
   * scan could not reach the account's first transaction. It commits as 0,
   * which is the honest encoding rather than a convenient one — 0 cannot
   * satisfy any positive `minimumHistoryMonths`, so an indeterminate scan
   * FAILS the history check inside the circuit exactly as it does in
   * `evaluatePolicy`. "Cannot establish" never silently becomes "old enough".
   * The same 0 goes into the passport commitment, so the commitment published
   * with the request and the value proven here are the same number.
   */
  const historyMonths = witness.historyMonths === null ? 0 : witness.historyMonths;

  const expiry = Math.floor(challenge.expiresAt / 1000);

  const subjectCommitment = await deriveSubjectCommitment(subjectId, blindingFactor);
  const passportCommitment = derivePassportCommitment(witness, salt);
  const nullifier = deriveNullifier(salt, challenge.policyHash, challenge.verifierCommitment);

  const input: CircuitInput = {
    /* private — the snapshot */
    assets: dec(witness.assets),
    collateralQuality: dec(witness.collateralQuality),
    historyMonths: dec(historyMonths),
    restrictedExposure: dec(witness.restrictedExposure ? 1 : 0),
    passportSalt: hexDec(salt),

    /* private — the thresholds. Only their Poseidon hash is public, which is
       why the circuit range-checks these too: the prover controls them. */
    minAssets: dec(policy.minimumAssets),
    minCollateralQuality: dec(policy.minimumCollateralQuality),
    minHistoryMonths: dec(policy.minimumHistoryMonths),
    screenExposure: dec(policy.screenRestrictedExposure ? 1 : 0),

    /* private — the identity */
    subjectId: (await utf8ToField(subjectId)).toString(),
    blindingFactor: hexDec(blindingFactor),

    /* public inputs. Each is constrained inside the circuit against a value
       re-derived from the private inputs, so none of them is a free label. */
    policyHash: hexDec(challenge.policyHash),
    subjectCommitment: hexDec(subjectCommitment),
    expiry: dec(expiry),
    nullifier: hexDec(nullifier),
    verifierCommitment: hexDec(challenge.verifierCommitment),
  };

  const publicSignals: PublicSignals = {
    passportCommitment,
    // The circuit computes this bit itself from the four comparisons; it is an
    // OUTPUT, not something this file asserts. The value below is only the
    // expectation the emitted signals are checked against.
    eligible:
      witness.assets >= policy.minimumAssets &&
      witness.collateralQuality >= policy.minimumCollateralQuality &&
      witness.historyMonths !== null &&
      witness.historyMonths >= policy.minimumHistoryMonths &&
      (!policy.screenRestrictedExposure || !witness.restrictedExposure),
    policyHash: challenge.policyHash,
    subjectCommitment,
    expiry,
    nullifier,
    verifierCommitment: challenge.verifierCommitment,
  };

  return { input, expectedPublicSignals: encodePublicSignals(publicSignals), publicSignals };
}

/**
 * A synthetic input for the warmup proof.
 *
 * NOT a demonstration and never rendered: its only job is to make the browser
 * instantiate the witness-calculator wasm and build ffjavascript's BN254
 * thread pool before the applicant presses the button, so the first real proof
 * costs ~550 ms instead of ~1300 ms. The numbers below are arbitrary constants
 * chosen to satisfy the circuit's range checks; they describe nobody, are
 * never published, and the proof is discarded the moment it exists.
 *
 * It is built through the same `buildProofInput` path as a real proof so the
 * warmup exercises the code the real proof will use.
 */
export function buildWarmupInput(): Promise<BuiltProofInput> {
  const policy: LendingPolicy = {
    minimumAssets: 1,
    minimumCollateralQuality: 1,
    minimumHistoryMonths: 1,
    screenRestrictedExposure: false,
  };
  const salt = "0x" + "11".repeat(32);
  const challenge: PolicyChallenge = {
    id: "warmup",
    requestId: "warmup",
    lenderSessionId: "warmup",
    lenderLabel: "warmup",
    policy,
    policyHash: derivePolicyHash(policy),
    // Any field element works: the circuit only requires the nullifier to be
    // Poseidon3(salt, policyHash, verifierCommitment) over whatever is here.
    verifierCommitment: "0x" + "22".repeat(32),
    nonce: "warmup",
    expiresAt: 1_800_000_000_000,
    status: "pending",
    createdAt: 0,
  };

  return buildProofInput({
    witness: {
      assets: 2,
      collateralQuality: 2,
      historyMonths: 2,
      restrictedExposure: false,
    },
    policy,
    challenge,
    salt,
    subjectId: "warmup",
    blindingFactor: "0x" + "33".repeat(32),
  });
}

/**
 * Do the signals the circuit actually emitted match what the inputs implied?
 *
 * A disagreement here means the browser's Poseidon and the circuit's Poseidon
 * have diverged, which would show up server-side as an unexplained pairing
 * failure. Catching it in the tab that produced it turns a mystery into a
 * named signal.
 */
export function checkEmittedSignals(emitted: readonly string[], expected: readonly string[]): void {
  if (emitted.length !== expected.length) {
    throw new Error(
      "the circuit emitted " +
        emitted.length +
        " public signals, expected " +
        expected.length +
        " (" +
        PUBLIC_SIGNAL_ORDER.join(", ") +
        ")",
    );
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (emitted[i] !== expected[i]) {
      throw new Error(
        "public signal [" +
          i +
          "] " +
          PUBLIC_SIGNAL_ORDER[i] +
          " is " +
          emitted[i] +
          ", but this browser derived " +
          expected[i] +
          ". The circuit and shared/policy.ts have diverged — the server would reject this proof.",
      );
    }
  }
}
