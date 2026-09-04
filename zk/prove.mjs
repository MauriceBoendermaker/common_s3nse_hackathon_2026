// zk/prove.mjs — build an input from a witness + policy, prove it, verify it,
// and print the timings.
//
// This is the CLI mirror of what the borrower's browser worker will do in
// workstream C part 2. Keeping a Node copy is deliberate: when a proof fails
// in the browser, the first question is "does it fail here too?", and the
// answer has to be one command away.
//
// Usage:
//   node zk/prove.mjs                     # the demo profile
//   node zk/prove.mjs --ineligible        # a profile that fails the policy
//   node zk/prove.mjs --input path.json   # a circom input written earlier
//   node zk/prove.mjs --assets 8000 --quality 40 --history 2 --exposed
//
// Every run writes zk/build/proof.json + zk/build/public.json, so
// `node zk/to_solana.mjs` can convert whatever was just proved.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import * as snarkjs from "snarkjs";

import { BUILD_DIR, CIRCUIT, b } from "./paths.mjs";
import { DEMO, buildCircuitInput } from "./protocol.mjs";

const WASM = b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY = b(`${CIRCUIT}_final.zkey`);
const VKEY = b("verification_key.json");

for (const artifact of [WASM, ZKEY, VKEY]) {
  if (!existsSync(artifact)) {
    console.error(`missing ${path.relative(process.cwd(), artifact)} — run \`node zk/build.mjs\` first`);
    process.exit(1);
  }
}

/* --------------------------------------------------------------- options */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const layout = JSON.parse(readFileSync(b("signal_layout.json"), "utf8"));

let input;
let expectedPublicSignals = null;
let describe;

if (opt("--input", null)) {
  const file = path.resolve(opt("--input"));
  input = JSON.parse(readFileSync(file, "utf8"));
  describe = `input file ${path.relative(process.cwd(), file)}`;
} else {
  const witness = {
    assets: Number(opt("--assets", flag("--ineligible") ? 4_000 : DEMO.witness.assets)),
    collateralQuality: Number(
      opt("--quality", flag("--ineligible") ? 12 : DEMO.witness.collateralQuality),
    ),
    historyMonths: Number(opt("--history", flag("--ineligible") ? 1 : DEMO.witness.historyMonths)),
    restrictedExposure: flag("--exposed") || flag("--ineligible"),
  };
  const built = buildCircuitInput({ ...DEMO, witness });
  input = built.input;
  expectedPublicSignals = built.expectedPublicSignals;
  describe =
    `assets=$${witness.assets.toLocaleString("en-US")}, quality=${witness.collateralQuality}%, ` +
    `history=${witness.historyMonths}mo, restricted=${witness.restrictedExposure}`;
}

const policy = DEMO.policy;

console.log("circuit:  " + CIRCUIT + "  (" + layout.constraints.total + " constraints)");
console.log("witness:  " + describe);
console.log(
  "policy:   >= $" +
    policy.minimumAssets.toLocaleString("en-US") +
    ", >= " +
    policy.minimumCollateralQuality +
    "% quality, >= " +
    policy.minimumHistoryMonths +
    " months, screen restricted = " +
    policy.screenRestrictedExposure,
);
console.log("");

/* ----------------------------------------------------------------- prove */

const tProve = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const proveMs = Date.now() - tProve;

const vk = JSON.parse(readFileSync(VKEY, "utf8"));

const tVerify = Date.now();
const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
const verifyMs = Date.now() - tVerify;

writeFileSync(b("proof.json"), JSON.stringify(proof, null, 2));
writeFileSync(b("public.json"), JSON.stringify(publicSignals, null, 2));
writeFileSync(b("input.json"), JSON.stringify(input, null, 2));

/* ---------------------------------------------------------------- report */

const hex = (decimal) => "0x" + BigInt(decimal).toString(16).padStart(64, "0");

console.log("public signals (order derived from the compiled circuit):");
layout.order.forEach((name, i) => {
  const raw = String(publicSignals[i]);
  const rendered = name === "eligible" || name === "expiry" ? raw : hex(raw);
  console.log(`  [${i}] ${name.padEnd(19)} ${rendered}`);
});

if (expectedPublicSignals) {
  const mismatches = expectedPublicSignals
    .map((want, i) => (String(publicSignals[i]) === want ? null : i))
    .filter((i) => i !== null);
  if (mismatches.length > 0) {
    console.error(
      "\nMISMATCH against poseidon-lite at " + mismatches.map((i) => layout.order[i]).join(", "),
    );
    process.exitCode = 1;
  } else {
    console.log("\n  all signals match poseidon-lite for the same inputs");
  }
}

console.log("");
console.log(`prove:    ${proveMs} ms`);
console.log(`verify:   ${verifyMs} ms`);
console.log(`verified: ${verified}`);
console.log(`eligible: ${publicSignals[layout.order.indexOf("eligible")]}`);
console.log(`\nwrote ${path.relative(process.cwd(), BUILD_DIR)}/{proof,public,input}.json`);

if (!verified) process.exitCode = 1;

// ffjavascript keeps its worker pool alive; without this the process hangs.
process.stdout.write("", () => process.exit(process.exitCode ?? 0));
