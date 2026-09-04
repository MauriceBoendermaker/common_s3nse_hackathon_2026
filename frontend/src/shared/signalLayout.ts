// GENERATED FILE - do not edit.
// Emitted by zk/build.mjs from the COMPILED circuit (.r1cs header + .sym),
// not from anybody's assumption about how snarkjs orders public signals.
// Regenerate with `node zk/build.mjs`.
//
// Circuit: credit_policy (circom compiler 2.2.3)
// Generated: 2026-09-03T22:04:00.087Z
// Constraints: 1390 non-linear + 1590 linear
//
// Public signal order:
//   [0] passportCommitment
//   [1] eligible
//   [2] policyHash
//   [3] subjectCommitment
//   [4] expiry
//   [5] nullifier
//   [6] verifierCommitment
//
// The zkey these indices belong to is 9ded0bf090f72f74...
// Regenerating the zkey regenerates this file; the two always move together.

import type { PublicSignals } from "./protocol-types";

export const PUBLIC_SIGNAL_ORDER = ["passportCommitment", "eligible", "policyHash", "subjectCommitment", "expiry", "nullifier", "verifierCommitment"] as const;

export type PublicSignalName = (typeof PUBLIC_SIGNAL_ORDER)[number];

export const N_PUBLIC_SIGNALS = 7;

export const CIRCUIT_NAME = "credit_policy";

/**
 * Constraint counts of the compiled circuit, so the UI can state the size of
 * the statement being proven without a human retyping a number that moves
 * every time the circuit does.
 */
export const CIRCUIT_CONSTRAINTS = {
  nonLinear: 1390,
  linear: 1590,
  total: 2980,
} as const;

/** circom compiler that produced the artifacts. */
export const CIRCOM_VERSION = "circom compiler 2.2.3";

/** sha256 of the artifacts these indices were derived from. */
export const ARTIFACT_HASHES = {
  wasm: "7e0633a4ab336629bf3d8a4b395bd6490161d2d45a6d135be04f35b396f29239",
  zkey: "9ded0bf090f72f748f50382fc96a248279acb0977e596464bdf23a718150c488",
  verificationKey: "251cf26a7971932a09d69657cab4013b57a92e978d61d5e73727c20049c6a1c5",
} as const;

/** Canonical 0x-prefixed 32-byte hex. Throws rather than truncating. */
function toHex(decimal: string): string {
  const hex = BigInt(decimal).toString(16);
  if (hex.length > 64) {
    throw new Error("signalLayout: field element exceeds 32 bytes (" + hex.length + " hex chars)");
  }
  return "0x" + hex.padStart(64, "0");
}

/**
 * snarkjs public signals (decimal strings, wire order) -> the protocol's
 * PublicSignals object. The index literals below are generated, so they cannot
 * drift from the circuit.
 */
export function decodePublicSignals(raw: readonly string[]): PublicSignals {
  if (raw.length !== N_PUBLIC_SIGNALS) {
    throw new Error(
      "expected " + N_PUBLIC_SIGNALS + " public signals, got " + raw.length,
    );
  }
  const eligible = raw[1];
  if (eligible !== "0" && eligible !== "1") {
    throw new Error("eligible must be a bit, got " + eligible);
  }
  return {
    passportCommitment: toHex(raw[0]),
    eligible: eligible === "1",
    policyHash: toHex(raw[2]),
    subjectCommitment: toHex(raw[3]),
    expiry: Number(raw[4]),
    nullifier: toHex(raw[5]),
    verifierCommitment: toHex(raw[6]),
  };
}

/** The inverse: PublicSignals -> decimal strings in wire order, for verify(). */
export function encodePublicSignals(signals: PublicSignals): string[] {
  const out: string[] = new Array(N_PUBLIC_SIGNALS);
  out[0] = BigInt(signals.passportCommitment).toString();
  out[1] = signals.eligible ? "1" : "0";
  out[2] = BigInt(signals.policyHash).toString();
  out[3] = BigInt(signals.subjectCommitment).toString();
  out[4] = String(signals.expiry);
  out[5] = BigInt(signals.nullifier).toString();
  out[6] = BigInt(signals.verifierCommitment).toString();
  return out;
}
