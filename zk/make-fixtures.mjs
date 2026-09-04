// zk/make-fixtures.mjs — produce the proof fixtures the BACKEND verifier's
// self-test runs against.
//
//   node zk/make-fixtures.mjs      (or: npm run zk:fixtures)
//   node backend/src/protocol/verifier.ts
//
// Why a separate file rather than reusing zk/build/proof.json: the backend
// self-test needs TWO proofs that differ in the POLICY, so that "a proof from
// a different policy is rejected" is a real cross-check between two honestly
// produced proofs rather than a mutation of one. prove.mjs always proves
// against DEMO.policy and overwrites the same output path, so it cannot leave
// two policies on disk at once.
//
// Both fixtures are HONEST proofs — each verifies against its own signals.
// The rejection cases in the self-test come from crossing them, not from
// forging anything. Nothing here is hard-coded into the app; these files exist
// only so `verifier.ts` can be driven from a terminal.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as snarkjs from "snarkjs";

import { BUILD_DIR, CIRCUIT, b } from "./paths.mjs";
import { DEMO, buildCircuitInput } from "./protocol.mjs";

const WASM = b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY = b(`${CIRCUIT}_final.zkey`);
const VKEY = b("verification_key.json");
const OUT = path.join(BUILD_DIR, "fixtures");

for (const artifact of [WASM, ZKEY, VKEY]) {
  if (!existsSync(artifact)) {
    console.error(`missing ${artifact} — run \`npm run zk:build\` first`);
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });

/**
 * Two DIFFERENT policies, both satisfied by the same demo profile.
 *
 * Policy B is deliberately satisfiable rather than strict: if B's proof were
 * ineligible, "B's proof does not verify against A's signals" could be read as
 * an artifact of eligible=0 rather than of a different policyHash. Both proofs
 * report eligible=1 and differ only in the statement they answer.
 */
const CASES = [
  { name: "policy_a", policy: DEMO.policy },
  {
    name: "policy_b",
    policy: {
      minimumAssets: 1_000,
      minimumCollateralQuality: 25,
      minimumHistoryMonths: 3,
      screenRestrictedExposure: false,
    },
  },
];

const seen = new Map();

for (const { name, policy } of CASES) {
  const { input, expectedPublicSignals } = buildCircuitInput({ ...DEMO, policy });

  const started = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ms = Date.now() - started;

  const mismatch = expectedPublicSignals.findIndex((want, i) => String(publicSignals[i]) !== want);
  if (mismatch >= 0) {
    console.error(`${name}: circuit signal [${mismatch}] disagrees with poseidon-lite`);
    process.exit(1);
  }

  writeFileSync(path.join(OUT, `${name}_proof.json`), JSON.stringify(proof, null, 2));
  writeFileSync(path.join(OUT, `${name}_public.json`), JSON.stringify(publicSignals, null, 2));
  writeFileSync(path.join(OUT, `${name}_input.json`), JSON.stringify(input, null, 2));

  const policyHashSignal = publicSignals[2];
  seen.set(name, policyHashSignal);

  console.log(
    `${name}: proved in ${ms}ms · eligible=${publicSignals[1]} · policyHash=${policyHashSignal.slice(0, 20)}…`,
  );
}

if (seen.get("policy_a") === seen.get("policy_b")) {
  console.error("the two fixtures share a policyHash — they would not test anything");
  process.exit(1);
}

console.log(`\nwrote ${OUT}`);
console.log("now run: node backend/src/protocol/verifier.ts");

// ffjavascript keeps its worker pool alive; without this the process hangs.
process.stdout.write("", () => process.exit(0));
