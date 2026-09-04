/**
 * Mirror of backend/src/protocol/policy.ts (and the field helpers it imports
 * from backend/src/protocol/hashing.ts). These two MUST agree — a divergence
 * produces proofs that fail verification with no useful error.
 *
 * Concretely: the borrower's browser computes `passportCommitment`,
 * `policyHash`, `subjectCommitment` and `nullifier` here; the backend
 * recomputes them from its own copy and rejects a mismatch; and in workstream E
 * the Solana program recomputes `policyHash` a third time from the stored
 * Policy account. Same Poseidon arities, same argument order, same reduction
 * mod r, or the on-chain recompute silently never matches and the bug looks
 * random.
 *
 * The ONLY permitted differences from the backend copy, all forced by the
 * runtime rather than chosen:
 *
 *   1. `utf8ToField` uses Web Crypto (`crypto.subtle.digest("SHA-256", ...)`)
 *      instead of `node:crypto`. Web Crypto's digest is async, so this function
 *      and its two callers — `subjectCommitment` and `verifierCommitment` — are
 *      async here and synchronous on the backend. The bytes hashed and the
 *      reduction are identical; only the call shape differs.
 *   2. `randomFieldElement` uses `crypto.getRandomValues` instead of
 *      `randomBytes`.
 *
 * `policyHash`, `passportCommitment` and `nullifier` take only numbers and hex,
 * never a string identity, so they stay synchronous in both copies.
 *
 * poseidon-lite MUST be imported by subpath. The barrel import pulls all
 * sixteen permutations and takes the bundle from 33 KB to 433 KB gzipped.
 */

import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";
import { poseidon5 } from "poseidon-lite/poseidon5";

import type { LendingPolicy, PolicyResult, Witness } from "./protocol-types";

/* ============================================================ field helpers
 * Mirror of backend/src/protocol/hashing.ts.
 * ========================================================================= */

/** The BN254 (alt_bn128) scalar field modulus `r`. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Canonical hex width of a field element: 32 bytes = 64 hex characters. */
const FIELD_HEX_CHARS = 64;

/**
 * Reduce an integer into the BN254 scalar field.
 *
 * Negative inputs are rejected rather than wrapped. A negative value here is
 * always a bug upstream, and silently mapping it to `r - n` would produce a
 * commitment that nothing else can reproduce.
 *
 * Strings are accepted in two forms only: `0x`-prefixed hex, or plain decimal.
 */
export function toField(value: bigint | number | string): bigint {
  let raw: bigint;

  if (typeof value === "bigint") {
    raw = value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("toField: value is not finite (" + String(value) + ")");
    }
    if (!Number.isInteger(value)) {
      throw new Error("toField: value is not an integer (" + String(value) + ")");
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        "toField: value exceeds Number.MAX_SAFE_INTEGER (" + String(value) + ")",
      );
    }
    raw = BigInt(value);
  } else {
    const text = value.trim();
    if (text.length === 0) {
      throw new Error("toField: empty string");
    }
    try {
      // BigInt() understands both "0x..." and plain decimal, and rejects junk.
      raw = BigInt(text);
    } catch {
      throw new Error('toField: not a decimal or 0x-hex integer ("' + text + '")');
    }
  }

  if (raw < 0n) {
    throw new Error("toField: negative values are rejected (" + raw.toString() + ")");
  }

  return raw % FIELD_MODULUS;
}

/**
 * Interpret an arbitrary-length `0x`-prefixed hex string as a big-endian
 * integer and reduce it into the field.
 *
 * Deliberately accepts ANY length: an ENS namehash and a 32-byte salt are both
 * 256-bit values that routinely exceed `r`. The reduction is the whole point,
 * and it must be identical in circom and in Rust.
 */
export function hexToField(hex: string): bigint {
  if (typeof hex !== "string") {
    throw new Error("hexToField: expected a string");
  }

  const text = hex.trim();
  const body = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;

  if (body.length === 0) {
    throw new Error('hexToField: no hex digits in "' + hex + '"');
  }
  if (!/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error('hexToField: not hex ("' + hex + '")');
  }

  return BigInt("0x" + body) % FIELD_MODULUS;
}

/**
 * The project's ONE definition of "Poseidon over a string".
 *
 * SHA-256 the UTF-8 bytes, read the 32-byte digest big-endian, reduce mod r.
 *
 * SHA-256 rather than keccak256 for one boring, decisive reason: it exists in
 * `node:crypto`, in the browser's WebCrypto and in `solana_program::hash` —
 * three implementations, no dependency, same digest.
 *
 * ASYNC HERE, SYNC ON THE BACKEND. `crypto.subtle.digest` returns a Promise and
 * has no synchronous form in the browser. The bytes and the reduction match
 * `backend/src/protocol/hashing.ts` exactly; only the call shape differs.
 *
 * `crypto.subtle` is only defined in a secure context — https, or localhost in
 * dev. Both hold for this app.
 */
export async function utf8ToField(text: string): Promise<bigint> {
  if (typeof text !== "string") {
    throw new Error("utf8ToField: expected a string");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex) % FIELD_MODULUS;
}

/**
 * Canonical wire form of a field element: `0x` + exactly 64 lowercase hex.
 *
 * Throws rather than truncating. `padStart` is a no-op when the string is
 * already too long, so a naive `padStart(64, "0")` on an oversized value
 * silently emits a wrong-but-plausible 65+ character hash.
 */
export function fieldToHex(value: bigint): string {
  if (typeof value !== "bigint") {
    throw new Error("fieldToHex: expected a bigint");
  }
  if (value < 0n) {
    throw new Error("fieldToHex: negative value (" + value.toString() + ")");
  }

  const body = value.toString(16);
  if (body.length > FIELD_HEX_CHARS) {
    throw new Error(
      "fieldToHex: value needs " +
        body.length +
        " hex chars, max is " +
        FIELD_HEX_CHARS +
        " -- reduce with toField() before encoding",
    );
  }

  return "0x" + body.padStart(FIELD_HEX_CHARS, "0");
}

/**
 * Display form: `0x` + first 6 + U+2026 + last 4 of the hex body.
 * Short values are returned unchanged rather than mangled.
 */
export function shortHash(hex: string): string {
  if (typeof hex !== "string") {
    throw new Error("shortHash: expected a string");
  }

  const text = hex.trim();
  const hasPrefix = text.startsWith("0x") || text.startsWith("0X");
  const body = hasPrefix ? text.slice(2) : text;

  if (body.length <= 10) {
    return hasPrefix ? "0x" + body : body;
  }

  return (hasPrefix ? "0x" : "") + body.slice(0, 6) + "…" + body.slice(-4);
}

/**
 * 32 cryptographically random bytes reduced into the field, in canonical hex.
 * Backs commitment salts and blinding factors.
 *
 * Uses `crypto.getRandomValues` (the backend uses `randomBytes`); both are
 * CSPRNGs and neither value ever has to match the other — a salt is fresh per
 * passport by definition.
 *
 * The modular reduction biases towards small values by about 2^-127, far below
 * anything that matters here.
 */
export function randomFieldElement(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return fieldToHex(BigInt("0x" + hex) % FIELD_MODULUS);
}

/* ================================================================== policy
 * Mirror of backend/src/protocol/policy.ts.
 * ========================================================================= */

/**
 * Poseidon over the four policy thresholds, in the fixed order
 * (assets, quality, history, exposure).
 *
 * Public signal [2]. The Solana program recomputes this from the stored Policy
 * account rather than trusting the instruction data, so the order below is a
 * cross-language contract — changing it silently breaks on-chain verification.
 */
export function policyHash(policy: LendingPolicy): string {
  return fieldToHex(
    poseidon4([
      toField(policy.minimumAssets),
      toField(policy.minimumCollateralQuality),
      toField(policy.minimumHistoryMonths),
      toField(policy.screenRestrictedExposure ? 1 : 0),
    ]),
  );
}

/**
 * Poseidon over the private snapshot plus a salt. Public signal [0].
 *
 * The hinge of the whole mechanism: the commitment is published with the credit
 * request, BEFORE any lender issues a policy challenge. Without that ordering
 * the borrower would simply pick whichever numbers satisfy the policy they were
 * just handed, and the proof would prove nothing.
 *
 * `historyMonths === null` (the bounded signature scan came back indeterminate)
 * is committed as 0 — the honest encoding, since `evaluatePolicy` also fails
 * the history check closed for a null, and 0 can never satisfy a positive
 * threshold either.
 */
export function passportCommitment(witness: Witness, salt: string): string {
  return fieldToHex(
    poseidon5([
      toField(witness.assets),
      toField(witness.collateralQuality),
      toField(witness.historyMonths === null ? 0 : witness.historyMonths),
      toField(witness.restrictedExposure ? 1 : 0),
      hexToField(salt),
    ]),
  );
}

/**
 * Poseidon(salt, policyHash, verifierCommitment). Public signal [5].
 *
 * Seeds the replay guard: the same borrower answering the same policy for the
 * same verifier produces the same nullifier, so a receipt can be spent once.
 */
export function nullifier(
  salt: string,
  policyHashHex: string,
  verifierCommitmentHex: string,
): string {
  return fieldToHex(
    poseidon3([
      hexToField(salt),
      hexToField(policyHashHex),
      hexToField(verifierCommitmentHex),
    ]),
  );
}

/**
 * Poseidon(utf8ToField(subjectId), blindingFactor). Public signal [3].
 *
 * NEVER publish a raw namehash or a raw Solana address here. namehash is an
 * unsalted, publicly computable function of the name: a rainbow table over any
 * ENS name list inverts it instantly, and this value is submitted as Solana
 * instruction data, in the clear, forever. The blinding factor is what makes
 * the commitment hiding.
 *
 * Async because `utf8ToField` is async in the browser.
 */
export async function subjectCommitment(
  subjectId: string,
  blindingFactor: string,
): Promise<string> {
  return fieldToHex(
    poseidon2([await utf8ToField(subjectId), hexToField(blindingFactor)]),
  );
}

/**
 * Poseidon over the lender's label and session id.
 *
 * Binds a proof to one verifier so a receipt handed to lender A cannot be
 * replayed at lender B. Async because `utf8ToField` is async in the browser.
 */
export async function verifierCommitment(
  lenderLabel: string,
  lenderSessionId: string,
): Promise<string> {
  return fieldToHex(
    poseidon2([await utf8ToField(lenderLabel), await utf8ToField(lenderSessionId)]),
  );
}

/** `1000 -> "1"`, `250000 -> "250"`, `1500 -> "1.5"`. */
function thousands(amount: number): string {
  const k = amount / 1000;
  return Number.isInteger(k) ? String(k) : String(Number(k.toFixed(1)));
}

/**
 * A threshold as a lender would write it. Sub-$1k renders in whole dollars.
 *
 * `thousands()` alone turned the $100 tier into "$0.1k", which reads as a
 * rounding error rather than a credit standard.
 */
function usdThreshold(amount: number): string {
  return amount < 1_000 ? `$${amount.toLocaleString("en-US")}` : `$${thousands(amount)}k`;
}

/**
 * The four underwriting comparisons, always all four, always in this order.
 *
 * Runs in the BORROWER's browser over the borrower's own witness. Only the
 * booleans leave it: `witness.assets` is never serialised into a
 * `PolicyResult`, and `requirement` describes the *threshold*, which the lender
 * already knows because the lender chose it.
 *
 * NO LONGER THE PROOF SYSTEM. Since workstream C part 2 the same four
 * comparisons are computed INSIDE the circuit and `eligible` is an output bit
 * of a Groth16 proof (`borrower/buildProofInput.ts` ->
 * `borrower/proverWorker.ts`). This function survives because the UI renders
 * labelled, human-readable rows from its output, and the backend no longer has
 * to believe those rows: the same verdict is inside the proof it verifies. Keep
 * the two in step — a divergence would show a lender a row that reads "pass"
 * next to a proof that says `eligible = 0`.
 */
export function evaluatePolicy(witness: Witness, policy: LendingPolicy): PolicyResult[] {
  return [
    {
      key: "assets",
      label: "Collateral value",
      passed: witness.assets >= policy.minimumAssets,
      requirement: `At least ${usdThreshold(policy.minimumAssets)} in allowlisted collateral`,
    },
    {
      key: "quality",
      label: "Collateral quality",
      passed: witness.collateralQuality >= policy.minimumCollateralQuality,
      requirement:
        policy.minimumCollateralQuality === 0
          ? "No stables or liquid staking tokens required"
          : `At least ${policy.minimumCollateralQuality}% in stables and liquid staking tokens`,
    },
    {
      // Fails CLOSED on null. A bounded signature scan that could not reach the
      // account's first transaction proves nothing about its age, and "cannot
      // establish" must never be silently read as "old enough".
      key: "history",
      label: "Account history",
      passed:
        witness.historyMonths !== null &&
        witness.historyMonths >= policy.minimumHistoryMonths,
      requirement: `${policy.minimumHistoryMonths}+ months of on-chain history`,
    },
    {
      key: "exposure",
      label: "Restricted exposure",
      passed: !policy.screenRestrictedExposure || !witness.restrictedExposure,
      requirement: policy.screenRestrictedExposure
        ? "No denylisted mints held"
        : "Not required",
    },
  ];
}

/** Eligible means every one of the four passed. Public signal [1]. */
export function isEligible(results: PolicyResult[]): boolean {
  return results.length > 0 && results.every((result) => result.passed);
}

/**
 * The thresholds the lender's policy builder offers.
 *
 * The low tiers are load-bearing, not padding: a judge who pastes their own
 * wallet address will not be holding $100k, and a policy builder whose cheapest
 * option nobody in the room can satisfy demos as a dead end.
 *
 * The `$100` and `0`% floors exist because a real wallet failed the ones above
 * them: an account holding a fraction of a SOL scores 0% quality (SOL is
 * allowlisted collateral but is neither a stablecoin nor a liquid staking
 * token), so every positive quality floor was unreachable for it. Nothing here
 * weakens a check — this is the menu of thresholds a lender may pick from, and
 * the strict end of each list is unchanged. See the backend copy for the full
 * note; edit that one, this is the mirror.
 */
export const POLICY_OPTIONS: {
  minimumAssets: number[];
  minimumCollateralQuality: number[];
  minimumHistoryMonths: number[];
} = {
  minimumAssets: [100, 1_000, 10_000, 50_000, 100_000, 250_000],
  minimumCollateralQuality: [0, 25, 50, 75, 90],
  minimumHistoryMonths: [3, 6, 12, 18],
};
