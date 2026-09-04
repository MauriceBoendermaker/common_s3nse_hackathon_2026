/**
 * Bridge between the curl end-to-end script and the ZK workspace.
 *
 * The borrower's browser does this in `frontend/src/borrower/buildProofInput.ts`.
 * This is the CLI mirror, built on the SAME `zk/protocol.mjs` the circuit's own
 * tests use, so a divergence between the two shows up as a failed proof here
 * rather than only in a browser tab.
 *
 * Reads a real passport witness and a real server-issued challenge; writes the
 * circom input `zk/prove.mjs --input` consumes, plus the exact
 * `publicSignals` / `results` objects `POST /api/proofs` expects.
 *
 * Usage:
 *   node scripts/e2e-build-input.mjs --witness w.json --challenge c.json \
 *     --salt 0x.. --blinding 0x.. --subject alice.eth \
 *     --out-input in.json --out-body body-part.json
 */

import { readFileSync, writeFileSync } from "node:fs";

import { buildCircuitInput, evaluatePolicy, fieldToHex } from "../zk/protocol.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) {
    if (fallback === null) throw new Error(`missing ${name}`);
    return fallback;
  }
  return argv[i + 1];
};

const passport = JSON.parse(readFileSync(opt("--witness"), "utf8"));
const witness = passport.witness ?? passport;
const challenge = JSON.parse(readFileSync(opt("--challenge"), "utf8"));

const salt = opt("--salt");
const blindingFactor = opt("--blinding");
const subjectId = opt("--subject");

// Exactly what the browser does: the receipt's expiry is the challenge's own
// deadline in whole seconds, so a lender cannot be handed a receipt that
// outlives the policy it answers.
const expiry = Math.floor(challenge.expiresAt / 1000);

const built = buildCircuitInput({
  witness: {
    assets: witness.assets,
    collateralQuality: witness.collateralQuality,
    historyMonths: witness.historyMonths,
    restrictedExposure: witness.restrictedExposure,
  },
  policy: challenge.policy,
  salt,
  subjectId,
  blindingFactor,
  // buildCircuitInput derives the verifier commitment from label+sessionId;
  // here the SERVER already derived it, so feed the stored value straight
  // through and assert the two agree below.
  lenderLabel: challenge.lenderLabel,
  lenderSessionId: challenge.lenderSessionId,
  expiry,
});

// The server computed policyHash and verifierCommitment from its own stored
// policy and session. If our mirror disagrees the proof would fail with a bare
// pairing error, so fail here instead, naming the field.
const mismatches = [];
if (fieldToHex(built.derived.ph).toLowerCase() !== challenge.policyHash.toLowerCase()) {
  mismatches.push(`policyHash: local ${fieldToHex(built.derived.ph)} vs server ${challenge.policyHash}`);
}
if (fieldToHex(built.derived.vc).toLowerCase() !== challenge.verifierCommitment.toLowerCase()) {
  mismatches.push(
    `verifierCommitment: local ${fieldToHex(built.derived.vc)} vs server ${challenge.verifierCommitment}`,
  );
}
if (mismatches.length > 0) {
  console.error("MIRROR MISMATCH against the server-issued challenge:\n  " + mismatches.join("\n  "));
  process.exit(1);
}

const results = evaluatePolicy(witness, challenge.policy).map((r) => {
  const p = challenge.policy;
  const label = {
    assets: "Assets",
    quality: "Collateral quality",
    history: "On-chain history",
    exposure: "Restricted exposure",
  }[r.key];
  const requirement = {
    assets: `>= $${p.minimumAssets.toLocaleString("en-US")}`,
    quality: `>= ${p.minimumCollateralQuality}%`,
    history: `>= ${p.minimumHistoryMonths} months`,
    exposure: p.screenRestrictedExposure ? "no denylisted mints held" : "not screened",
  }[r.key];
  return { key: r.key, label, passed: r.passed, requirement };
});

const publicSignals = {
  passportCommitment: fieldToHex(built.derived.pc),
  eligible: built.derived.eligible === 1n,
  policyHash: challenge.policyHash,
  subjectCommitment: fieldToHex(built.derived.sc),
  expiry,
  nullifier: fieldToHex(built.derived.nf),
  verifierCommitment: challenge.verifierCommitment,
};

writeFileSync(opt("--out-input"), JSON.stringify(built.input, null, 2));
writeFileSync(
  opt("--out-body"),
  JSON.stringify({ publicSignals, results, expectedPublicSignals: built.expectedPublicSignals }, null, 2),
);

console.log(`passportCommitment ${publicSignals.passportCommitment}`);
console.log(`eligible           ${publicSignals.eligible}`);
console.log(`nullifier          ${publicSignals.nullifier}`);
