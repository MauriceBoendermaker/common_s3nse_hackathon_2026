// zk/protocol.mjs - the JS mirror of backend/src/protocol/{hashing,policy}.ts.
//
// Deliberately a mirror rather than an import: the backend files are
// TypeScript run under Node's native type stripping and carry `.ts` relative
// imports, which an .mjs script in another workspace cannot consume without a
// build step. The values MUST be identical, so `verify-test.mjs` asserts that
// the circuit's in-circuit Poseidon results equal what these functions
// produce for the same inputs. If someone edits one side only, that test
// fails loudly instead of proofs failing silently.
//
// poseidon-lite is imported BY SUBPATH. The barrel import pulls all sixteen
// permutations (33 KB -> 433 KB gzipped in the browser build).

import { createHash, randomBytes } from "node:crypto";

import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";
import { poseidon5 } from "poseidon-lite/poseidon5";

/** BN254 scalar field modulus r. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function toField(value) {
  const raw = typeof value === "bigint" ? value : BigInt(value);
  if (raw < 0n) throw new Error(`toField: negative values are rejected (${raw})`);
  return raw % FIELD_MODULUS;
}

export function hexToField(hex) {
  const text = String(hex).trim();
  const body = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;
  if (body.length === 0) throw new Error(`hexToField: no hex digits in "${hex}"`);
  if (!/^[0-9a-fA-F]+$/.test(body)) throw new Error(`hexToField: not hex ("${hex}")`);
  return BigInt("0x" + body) % FIELD_MODULUS;
}

/**
 * The project's ONE definition of "Poseidon over a string": SHA-256 of the
 * UTF-8 bytes, read big-endian, reduced mod r. SHA-256 because it exists in
 * node:crypto, WebCrypto and solana_program::hash - three implementations, no
 * dependency, same digest. The reduction is mandatory: a 256-bit digest
 * exceeds r about 78% of the time.
 */
export function utf8ToField(text) {
  const digest = createHash("sha256").update(String(text), "utf8").digest("hex");
  return BigInt("0x" + digest) % FIELD_MODULUS;
}

/** Canonical 0x-prefixed 32-byte hex. Throws rather than truncating. */
export function fieldToHex(value) {
  const v = toField(value);
  const hex = v.toString(16);
  if (hex.length > 64) throw new Error(`fieldToHex: ${hex.length} hex chars exceeds 32 bytes`);
  return "0x" + hex.padStart(64, "0");
}

export const randomFieldElement = () =>
  BigInt("0x" + randomBytes(32).toString("hex")) % FIELD_MODULUS;

/* ------------------------------------------------ the protocol's hashes */

export const policyHash = (policy) =>
  poseidon4([
    toField(policy.minimumAssets),
    toField(policy.minimumCollateralQuality),
    toField(policy.minimumHistoryMonths),
    toField(policy.screenRestrictedExposure ? 1 : 0),
  ]);

export const passportCommitment = (witness, salt) =>
  poseidon5([
    toField(witness.assets),
    toField(witness.collateralQuality),
    toField(witness.historyMonths === null ? 0 : witness.historyMonths),
    toField(witness.restrictedExposure ? 1 : 0),
    toField(salt),
  ]);

export const nullifier = (salt, policyHashField, verifierCommitmentField) =>
  poseidon3([toField(salt), toField(policyHashField), toField(verifierCommitmentField)]);

export const subjectCommitment = (subjectId, blindingFactor) =>
  poseidon2([utf8ToField(subjectId), toField(blindingFactor)]);

export const verifierCommitment = (lenderLabel, lenderSessionId) =>
  poseidon2([utf8ToField(lenderLabel), utf8ToField(lenderSessionId)]);

/** The four underwriting comparisons, in the fixed order. */
export function evaluatePolicy(witness, policy) {
  return [
    { key: "assets", passed: witness.assets >= policy.minimumAssets },
    { key: "quality", passed: witness.collateralQuality >= policy.minimumCollateralQuality },
    {
      // Fails CLOSED on null: a bounded scan that could not reach the first
      // transaction proves nothing about the account's age.
      key: "history",
      passed:
        witness.historyMonths !== null && witness.historyMonths >= policy.minimumHistoryMonths,
    },
    {
      key: "exposure",
      passed: !policy.screenRestrictedExposure || !witness.restrictedExposure,
    },
  ];
}

export const isEligible = (results) => results.length > 0 && results.every((r) => r.passed);

/* ------------------------------------------------- circuit input builder */

/**
 * Build the circom input object for one (witness, policy, subject, verifier,
 * expiry) tuple, together with the public signals the proof is expected to
 * emit - in the documented wire order.
 *
 * Every value is a decimal string: snarkjs accepts bigints, but decimal
 * strings survive JSON round-trips, which matters because the same input is
 * written to disk for reproduction.
 */
export function buildCircuitInput({
  witness,
  policy,
  salt,
  subjectId,
  blindingFactor,
  lenderLabel,
  lenderSessionId,
  expiry,
}) {
  const ph = policyHash(policy);
  const vc = verifierCommitment(lenderLabel, lenderSessionId);
  const nf = nullifier(salt, ph, vc);
  const sc = subjectCommitment(subjectId, blindingFactor);
  const pc = passportCommitment(witness, salt);
  const eligible = isEligible(evaluatePolicy(witness, policy)) ? 1n : 0n;

  const d = (v) => toField(v).toString();

  const input = {
    assets: d(witness.assets),
    collateralQuality: d(witness.collateralQuality),
    historyMonths: d(witness.historyMonths === null ? 0 : witness.historyMonths),
    restrictedExposure: d(witness.restrictedExposure ? 1 : 0),
    passportSalt: d(salt),
    minAssets: d(policy.minimumAssets),
    minCollateralQuality: d(policy.minimumCollateralQuality),
    minHistoryMonths: d(policy.minimumHistoryMonths),
    screenExposure: d(policy.screenRestrictedExposure ? 1 : 0),
    subjectId: utf8ToField(subjectId).toString(),
    blindingFactor: d(blindingFactor),
    policyHash: d(ph),
    subjectCommitment: d(sc),
    expiry: d(expiry),
    nullifier: d(nf),
    verifierCommitment: d(vc),
  };

  // The documented wire order. build.mjs asserts the compiled circuit agrees.
  const expectedPublicSignals = [pc, eligible, ph, sc, BigInt(expiry), nf, vc].map((v) =>
    toField(v).toString(),
  );

  return { input, expectedPublicSignals, derived: { pc, eligible, ph, sc, nf, vc } };
}

/* ------------------------------------------------------- demo parameters */

/** A comfortably-qualifying profile. Used by prove.mjs and the build check. */
export const DEMO = {
  witness: {
    assets: 42_500,
    collateralQuality: 71,
    historyMonths: 19,
    restrictedExposure: false,
  },
  policy: {
    minimumAssets: 10_000,
    minimumCollateralQuality: 50,
    minimumHistoryMonths: 6,
    screenRestrictedExposure: true,
  },
  salt: "0x" + "ab".repeat(32),
  subjectId: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  blindingFactor: "0x" + "17".repeat(32),
  lenderLabel: "provider-9f3a",
  lenderSessionId: "9f3a1c22-0000-4000-8000-000000000000",
  expiry: 1_800_000_000,
};
