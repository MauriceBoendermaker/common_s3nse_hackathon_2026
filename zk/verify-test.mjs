// zk/verify-test.mjs — the negative tests.
//
// A verifier that returns `true` for a good proof has proved nothing; the
// interesting question is what it returns for a bad one. Every case below is
// an attack someone could actually try against this credential:
//
//   * swap a public signal      — "I am eligible after all"
//   * reuse a proof elsewhere   — answer lender A's policy, submit to lender B
//   * flip one proof byte       — corruption, or a hand-edited receipt
//   * prove ineligibility       — must SUCCEED; a valid "no" is the product
//
// Plus the cross-language equality checks: the circuit's in-circuit Poseidon
// results must equal what poseidon-lite produces for the same inputs. If those
// ever drift, proofs fail verification with no useful error, and finding out
// why costs an hour.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as snarkjs from "snarkjs";

import { CIRCUIT, b } from "./paths.mjs";
import {
  DEMO,
  buildCircuitInput,
  evaluatePolicy,
  isEligible,
  nullifier,
  passportCommitment,
  policyHash,
  subjectCommitment,
  verifierCommitment,
} from "./protocol.mjs";

const WASM = b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY = b(`${CIRCUIT}_final.zkey`);
const VKEY = b("verification_key.json");

for (const artifact of [WASM, ZKEY, VKEY]) {
  if (!existsSync(artifact)) {
    console.error(`missing ${path.relative(process.cwd(), artifact)} — run \`node zk/build.mjs\` first`);
    process.exit(1);
  }
}

const vk = JSON.parse(readFileSync(VKEY, "utf8"));
const layout = JSON.parse(readFileSync(b("signal_layout.json"), "utf8"));
const idx = (name) => {
  const i = layout.order.indexOf(name);
  if (i < 0) throw new Error(`signal_layout.json has no "${name}"`);
  return i;
};

/* ------------------------------------------------------------ test harness */

const rows = [];
let failures = 0;

function record(name, expectation, actual, detail) {
  const passed = actual === expectation;
  if (!passed) failures++;
  rows.push({ name, expectation, actual, passed, detail: detail ?? "" });
  process.stdout.write(passed ? "." : "X");
}

const verify = (signals, proof) => snarkjs.groth16.verify(vk, signals, proof);

const prove = async (overrides) => {
  const built = buildCircuitInput({ ...DEMO, ...overrides });
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, WASM, ZKEY);
  return { ...built, proof, publicSignals };
};

const deepCopy = (v) => JSON.parse(JSON.stringify(v));

console.log(`verify-test: ${CIRCUIT}, ${layout.constraints.total} constraints, ${layout.nPublic} public signals`);
process.stdout.write("running ");

/* ---------------------------------------------------- 1. the honest proof */

const t0 = Date.now();
const eligibleCase = await prove({});
const proveMs = Date.now() - t0;

const tv = Date.now();
record("honest proof verifies", true, await verify(eligibleCase.publicSignals, eligibleCase.proof));
const verifyMs = Date.now() - tv;

record(
  "honest proof reports eligible = 1",
  "1",
  String(eligibleCase.publicSignals[idx("eligible")]),
  "the demo profile satisfies the demo policy",
);

/* ------------------------- 2. cross-language Poseidon equality (the drift) */

const expectEqual = (name, fromCircuit, fromLib, detail) =>
  record(name, true, BigInt(fromCircuit) === BigInt(fromLib), detail);

expectEqual(
  "circuit passportCommitment === poseidon-lite poseidon5",
  eligibleCase.publicSignals[idx("passportCommitment")],
  passportCommitment(DEMO.witness, DEMO.salt),
  "Poseidon5(assets, quality, history, exposure, salt)",
);
expectEqual(
  "circuit policyHash === poseidon-lite poseidon4",
  eligibleCase.publicSignals[idx("policyHash")],
  policyHash(DEMO.policy),
  "Poseidon4(minAssets, minQuality, minHistory, screenExposure)",
);
expectEqual(
  "circuit nullifier === poseidon-lite poseidon3",
  eligibleCase.publicSignals[idx("nullifier")],
  nullifier(
    DEMO.salt,
    policyHash(DEMO.policy),
    verifierCommitment(DEMO.lenderLabel, DEMO.lenderSessionId),
  ),
  "Poseidon3(salt, policyHash, verifierCommitment)",
);
expectEqual(
  "circuit subjectCommitment === poseidon-lite poseidon2",
  eligibleCase.publicSignals[idx("subjectCommitment")],
  subjectCommitment(DEMO.subjectId, DEMO.blindingFactor),
  "Poseidon2(utf8ToField(subjectId), blindingFactor)",
);
expectEqual(
  "circuit verifierCommitment === poseidon-lite poseidon2",
  eligibleCase.publicSignals[idx("verifierCommitment")],
  verifierCommitment(DEMO.lenderLabel, DEMO.lenderSessionId),
  "public signal [6], bound through the nullifier",
);

/* ---------------------------------- 3. an ineligible proof must still verify */

const ineligibleWitness = {
  assets: 4_000,
  collateralQuality: 12,
  historyMonths: 1,
  restrictedExposure: true,
};
const ineligibleCase = await prove({ witness: ineligibleWitness });

record(
  "ineligible proof VERIFIES (a valid proof of ineligibility)",
  true,
  await verify(ineligibleCase.publicSignals, ineligibleCase.proof),
  "the lender must be able to receive a checkable NO",
);
record(
  "ineligible proof reports eligible = 0",
  "0",
  String(ineligibleCase.publicSignals[idx("eligible")]),
  `local evaluation agrees: ${isEligible(evaluatePolicy(ineligibleWitness, DEMO.policy))}`,
);
record(
  "ineligible proof still commits to the same policy",
  true,
  String(ineligibleCase.publicSignals[idx("policyHash")]) ===
    String(eligibleCase.publicSignals[idx("policyHash")]),
  "same policy, different witness",
);
const relabelled = [...ineligibleCase.publicSignals];
relabelled[idx("eligible")] = "1";
record(
  "an ineligible proof cannot be relabelled eligible",
  false,
  await verify(relabelled, ineligibleCase.proof),
  "flip signal [1] from 0 to 1 and resubmit the same proof",
);

/* ------------------------------------------- 4. tampered public signals */

for (const name of layout.order) {
  const tampered = [...eligibleCase.publicSignals];
  const i = idx(name);
  tampered[i] =
    name === "eligible"
      ? String(1 - Number(tampered[i]))
      : (BigInt(tampered[i]) + 1n).toString();
  record(
    `tampered public signal [${i}] ${name} is REJECTED`,
    false,
    await verify(tampered, eligibleCase.proof),
    name === "eligible" ? "bit flipped" : "value + 1",
  );
}

/* -------------------------------- 5. policy A's proof against policy B */

const policyB = {
  minimumAssets: 250_000,
  minimumCollateralQuality: 90,
  minimumHistoryMonths: 18,
  screenRestrictedExposure: true,
};
const caseB = await prove({ policy: policyB });

record(
  "policy B's own proof verifies",
  true,
  await verify(caseB.publicSignals, caseB.proof),
);
record(
  "policy A's proof against policy B's public signals is REJECTED",
  false,
  await verify(caseB.publicSignals, eligibleCase.proof),
  "same witness, different policy — the whole point of policyHash",
);
record(
  "policy B's proof against policy A's public signals is REJECTED",
  false,
  await verify(eligibleCase.publicSignals, caseB.proof),
);
record(
  "the demo witness is NOT eligible under the strict policy B",
  "0",
  String(caseB.publicSignals[idx("eligible")]),
  "$42.5k < $250k, 71% < 90%, 19mo >= 18mo",
);
record(
  "a different policy yields a different nullifier",
  true,
  String(caseB.publicSignals[idx("nullifier")]) !==
    String(eligibleCase.publicSignals[idx("nullifier")]),
  "replay across policies is a different statement",
);

/* --------------------------------- 6. a proof bound to a different lender */

const caseOtherLender = await prove({
  lenderLabel: "provider-dead",
  lenderSessionId: "beefbeef-0000-4000-8000-000000000000",
});
record(
  "a proof issued to lender A is REJECTED against lender B's signals",
  false,
  await verify(caseOtherLender.publicSignals, eligibleCase.proof),
  "verifierCommitment is public signal [6] precisely so this fails",
);
record(
  "a different lender yields a different nullifier",
  true,
  String(caseOtherLender.publicSignals[idx("nullifier")]) !==
    String(eligibleCase.publicSignals[idx("nullifier")]),
);

/* --------------------------------------------- 7. flip one byte of the proof */

const flipField = async (field, index) => {
  const broken = deepCopy(eligibleCase.proof);
  const before = BigInt(field === "pi_b" ? broken[field][0][index] : broken[field][index]);
  const after = (before ^ 1n).toString();
  if (field === "pi_b") broken[field][0][index] = after;
  else broken[field][index] = after;
  return verify(eligibleCase.publicSignals, broken);
};

record("flipping the low bit of proof.pi_a[0] is REJECTED", false, await flipField("pi_a", 0));
record("flipping the low bit of proof.pi_a[1] is REJECTED", false, await flipField("pi_a", 1));
record("flipping the low bit of proof.pi_b[0][0] is REJECTED", false, await flipField("pi_b", 0));
record("flipping the low bit of proof.pi_c[0] is REJECTED", false, await flipField("pi_c", 0));

// Swapping A and C is the shape of a "reassemble the proof" attack.
const swapped = deepCopy(eligibleCase.proof);
[swapped.pi_a, swapped.pi_c] = [swapped.pi_c, swapped.pi_a];
record(
  "swapping proof.pi_a with proof.pi_c is REJECTED",
  false,
  await verify(eligibleCase.publicSignals, swapped),
);

// A proof from a different statement, byte-identical structure.
record(
  "grafting the ineligible proof onto the eligible signals is REJECTED",
  false,
  await verify(eligibleCase.publicSignals, ineligibleCase.proof),
);

/* ---------------------------------------------- 8. the boundary is inclusive */

const boundary = await prove({
  witness: {
    assets: DEMO.policy.minimumAssets,
    collateralQuality: DEMO.policy.minimumCollateralQuality,
    historyMonths: DEMO.policy.minimumHistoryMonths,
    restrictedExposure: false,
  },
});
record(
  "exactly-at-threshold is eligible (>= not >)",
  "1",
  String(boundary.publicSignals[idx("eligible")]),
);

const justUnder = await prove({
  witness: {
    assets: DEMO.policy.minimumAssets - 1,
    collateralQuality: DEMO.policy.minimumCollateralQuality,
    historyMonths: DEMO.policy.minimumHistoryMonths,
    restrictedExposure: false,
  },
});
record(
  "one dollar under the threshold is ineligible",
  "0",
  String(justUnder.publicSignals[idx("eligible")]),
);

/* ------------------------------------------- 9. the range checks are wired */

// A percentage above 100 must be UNPROVABLE, not merely ineligible: the
// circuit asserts collateralQuality <= 100. If this ever starts producing a
// proof, the Num2Bits guards have been removed and the circuit is forgeable
// by field overflow.
let overflowRejected = false;
let overflowDetail = "";
try {
  await prove({
    witness: { ...DEMO.witness, collateralQuality: 250 },
  });
} catch (cause) {
  overflowRejected = true;
  overflowDetail = String(cause.message).split("\n")[0].slice(0, 70);
}
record(
  "collateralQuality = 250 is UNPROVABLE (range check holds)",
  true,
  overflowRejected,
  overflowDetail,
);

let negativeRejected = false;
let negativeDetail = "";
try {
  // p - 1, the field's "-1". Without Num2Bits this flips a comparison and the
  // circuit happily proves a false statement.
  const built = buildCircuitInput(DEMO);
  const forged = {
    ...built.input,
    minAssets: (
      21888242871839275222246405745257275088548364400416034343698204186575808495617n - 1n
    ).toString(),
  };
  await snarkjs.groth16.fullProve(forged, WASM, ZKEY);
} catch (cause) {
  negativeRejected = true;
  negativeDetail = String(cause.message).split("\n")[0].slice(0, 70);
}
record(
  'minAssets = p-1 (the field "-1") is UNPROVABLE',
  true,
  negativeRejected,
  negativeDetail,
);

/* --------------------------------------------------------------- report */

process.stdout.write("\n\n");

const w1 = Math.max(...rows.map((r) => r.name.length));
const line = "  " + "-".repeat(w1 + 44);
console.log("  " + "RESULT".padEnd(8) + "CASE".padEnd(w1 + 2) + "EXPECTED / ACTUAL");
console.log(line);
for (const r of rows) {
  const verdict = r.passed ? "PASS" : "FAIL";
  console.log(
    `  ${verdict.padEnd(8)}${r.name.padEnd(w1 + 2)}${String(r.expectation)} / ${String(r.actual)}` +
      (r.detail ? `\n  ${" ".repeat(8)}${" ".repeat(0)}  ↳ ${r.detail}` : ""),
  );
}
console.log(line);
console.log(`  ${rows.length - failures}/${rows.length} passed, ${failures} failed`);
console.log(`\n  prove: ${proveMs} ms   verify: ${verifyMs} ms`);

if (failures > 0) {
  console.error("\nVERIFY-TEST FAILED");
  process.exitCode = 1;
} else {
  console.log("\nVERIFY-TEST OK");
}

process.stdout.write("", () => process.exit(process.exitCode ?? 0));
