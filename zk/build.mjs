// zk/build.mjs - ONE BUILD STEP, TWO OUTPUTS.
//
// Compiles the circuit, runs a development trusted setup, derives and asserts
// the public-signal layout, and emits BOTH the browser artifacts
// (frontend/public/zk/) AND the Solana program's verifying-key constants
// (zk/build/vk_data.rs) in the same run.
//
// >>> Regenerating the zkey changes the verifying key, so the browser
// >>> artifacts and the program's VK_* constants MUST always be regenerated
// >>> together - otherwise every proof fails on-chain with no useful error.
// That sentence is why these two outputs live in one script instead of two.
//
// -------------------------------------------------------------- ptau note
// The powers-of-tau file is generated LOCALLY (~20 s at power 12). Do not add
// a `curl ...ptau` step: every Hermez/zkevm mirror is 403/404 today and
// circomkit 0.3.4 hardcodes the dead bucket, so the failure looks like a
// network problem and costs an hour to diagnose.
//
// ------------------------------------------------------------- spawn note
// Never spawn `npx.cmd`: Node >= 18.20 throws EINVAL on `.cmd` via execFile.
// Call the snarkjs CLI script with the current node binary instead.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  BUILD_DIR,
  CIRCOM_BIN,
  CIRCUIT,
  CIRCUITS_DIR,
  CIRCOMLIB_CIRCUITS,
  FRONTEND_PUBLIC_ZK,
  FRONTEND_SHARED,
  SNARKJS_CLI,
  b,
} from "./paths.mjs";
import { toSolana } from "./to_solana.mjs";
import { DEMO, buildCircuitInput } from "./protocol.mjs";

const POWER = 12; // 2^12 = 4096 constraints of headroom over the ~1.4k we use

/**
 * THE CONTRACT. This list is duplicated, on purpose, in
 * `backend/src/protocol/types.ts` (PublicSignals) and in the header comment
 * of `zk/circuits/credit_policy.circom`. The build FAILS if the compiled
 * circuit disagrees with it - which is the single check that eliminates the
 * entire class of "proof invalid, no useful error" bugs.
 */
const DOCUMENTED_LAYOUT = [
  "passportCommitment",
  "eligible",
  "policyHash",
  "subjectCommitment",
  "expiry",
  "nullifier",
  "verifierCommitment",
];

/* ------------------------------------------------------------- utilities */

const t0 = Date.now();
const timings = [];
const transcript = [];

const secs = (ms) => (ms / 1000).toFixed(1) + "s";

function step(label, fn) {
  const t = Date.now();
  const result = fn();
  const ms = Date.now() - t;
  timings.push({ label, ms });
  console.log(`  ${label.padEnd(26)} ${secs(ms).padStart(7)}`);
  return result;
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

const snark = (...args) => run(process.execPath, [SNARKJS_CLI(), ...args]);

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const size = (file) => statSync(file).size;
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const mb = (n) => (n / (1024 * 1024)).toFixed(2) + " MB";

/** Fresh 32 bytes of entropy per contribution, never reused, never stored. */
const entropy = () => "-e=" + randomBytes(32).toString("hex");

function fail(message) {
  console.error("\nBUILD FAILED: " + message);
  process.exit(1);
}

/* ----------------------------------------------------------- 0. preflight */

if (!existsSync(CIRCOM_BIN)) fail("circom missing - run `node zk/getcircom.mjs` first");

const circomVersion = run(CIRCOM_BIN, ["--version"]).trim();
console.log(`circom: ${circomVersion}`);
console.log(`snarkjs CLI: ${path.relative(process.cwd(), SNARKJS_CLI())}`);

// A stale build directory is a liability: half-regenerated artifacts are
// exactly the drift this script exists to prevent.
if (existsSync(BUILD_DIR)) rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });

console.log("\n[1/7] compile");

/* ------------------------------------------------------------ 1. compile */

const compileOut = step("circom", () =>
  run(CIRCOM_BIN, [
    path.join(CIRCUITS_DIR, `${CIRCUIT}.circom`),
    "--r1cs",
    "--wasm",
    "--sym",
    "-o",
    BUILD_DIR,
    "-l",
    CIRCOMLIB_CIRCUITS(),
  ]),
);

// eslint-disable-next-line no-control-regex
const plain = compileOut.replace(/\[[0-9;]*m/g, "");
// Anchor at line start: "linear constraints" is a substring of
// "non-linear constraints", so an unanchored match silently reports the
// non-linear count twice. The ANSI strip above removes the ESC byte as well,
// which is what lets the ^ anchor fire at all.
const grab = (label) => {
  const m = plain.match(new RegExp("^" + label + ":\\s*(\\d+)", "m"));
  if (m === null) fail(`could not parse "${label}" from the circom output:\n${plain}`);
  return Number(m[1]);
};
const counts = {
  templateInstances: grab("template instances"),
  nonLinear: grab("non-linear constraints"),
  linear: grab("linear constraints"),
  publicInputs: grab("public inputs"),
  privateInputs: grab("private inputs"),
  publicOutputs: grab("public outputs"),
  wires: grab("wires"),
  labels: grab("labels"),
};
console.log(
  `  template instances: ${counts.templateInstances}\n` +
    `  constraints: ${counts.nonLinear} non-linear + ${counts.linear} linear = ${
      counts.nonLinear + counts.linear
    }\n` +
    `  wires: ${counts.wires}   labels: ${counts.labels}\n` +
    `  signals: ${counts.publicOutputs} public outputs, ${counts.publicInputs} public inputs, ${counts.privateInputs} private inputs`,
);

/* ---------------------------------------- 2. derive the r1cs signal layout */

console.log("\n[2/7] derive public signal layout");

/**
 * Read nPubOut / nPubIn / nPrvIn / nConstraints straight out of the .r1cs
 * header rather than trusting the compiler's stdout, so the layout assertion
 * rests on the same bytes snarkjs will read.
 */
function readR1csHeader(file) {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "r1cs") throw new Error("not an r1cs file: " + file);
  const nSections = buf.readUInt32LE(8);
  let off = 12;
  for (let i = 0; i < nSections; i++) {
    const type = buf.readUInt32LE(off);
    const len = Number(buf.readBigUInt64LE(off + 4));
    const body = off + 12;
    if (type === 1) {
      const fieldSize = buf.readUInt32LE(body);
      let p = body + 4 + fieldSize;
      const nWires = buf.readUInt32LE(p);
      const nPubOut = buf.readUInt32LE(p + 4);
      const nPubIn = buf.readUInt32LE(p + 8);
      const nPrvIn = buf.readUInt32LE(p + 12);
      const nLabels = Number(buf.readBigUInt64LE(p + 16));
      const nConstraints = buf.readUInt32LE(p + 24);
      return { nWires, nPubOut, nPubIn, nPrvIn, nLabels, nConstraints };
    }
    off = body + len;
  }
  throw new Error("no header section in " + file);
}

/**
 * The witness vector is [1, <public outputs>, <public inputs>, <private
 * inputs>, <intermediates>]. The `.sym` file maps every signal to its witness
 * index, so indices 1..nPublic ARE the public signal order, straight from the
 * compiled artifact. Nothing here assumes snarkjs's documented behaviour.
 */
function deriveLayoutFromSym(symFile, nPublic) {
  const byIndex = new Map();
  for (const line of readFileSync(symFile, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 4) continue;
    const witnessIndex = Number(parts[1]);
    const name = parts.slice(3).join(",");
    if (witnessIndex >= 1 && witnessIndex <= nPublic && !byIndex.has(witnessIndex)) {
      byIndex.set(witnessIndex, name);
    }
  }
  const layout = [];
  for (let i = 1; i <= nPublic; i++) {
    const name = byIndex.get(i);
    if (!name) throw new Error(`.sym has no signal at witness index ${i}`);
    if (!name.startsWith("main.")) {
      throw new Error(`witness index ${i} is "${name}", not a signal of main`);
    }
    layout.push(name.slice("main.".length));
  }
  return layout;
}

const header = readR1csHeader(b(`${CIRCUIT}.r1cs`));
const nPublic = header.nPubOut + header.nPubIn;
const derivedLayout = deriveLayoutFromSym(b(`${CIRCUIT}.sym`), nPublic);

console.log(`  r1cs header: ${header.nConstraints} constraints, ${header.nWires} wires`);
console.log(`  nPublic = ${header.nPubOut} outputs + ${header.nPubIn} public inputs = ${nPublic}`);
derivedLayout.forEach((name, i) => {
  const kind = i < header.nPubOut ? "output" : "input ";
  console.log(`    [${i}] ${kind}  ${name}`);
});

// ---- THE ASSERTION. Fail the build, do not paper over it. ----
if (derivedLayout.length !== DOCUMENTED_LAYOUT.length) {
  fail(
    `public signal count is ${derivedLayout.length}, the documented contract has ` +
      `${DOCUMENTED_LAYOUT.length}. Fix the circuit or backend/src/protocol/types.ts.`,
  );
}
for (let i = 0; i < DOCUMENTED_LAYOUT.length; i++) {
  if (derivedLayout[i] !== DOCUMENTED_LAYOUT[i]) {
    fail(
      `public signal [${i}] is "${derivedLayout[i]}" in the compiled circuit but ` +
        `"${DOCUMENTED_LAYOUT[i]}" in the documented contract.\n` +
        `  derived:    ${derivedLayout.join(", ")}\n` +
        `  documented: ${DOCUMENTED_LAYOUT.join(", ")}\n` +
        "  Reorder the signal declarations in zk/circuits/credit_policy.circom " +
        "(outputs first, then public inputs, both in declaration order), or change the contract.",
    );
  }
}
console.log("  LAYOUT ASSERTION PASSED - compiled circuit matches the documented contract");

/* ---------------------------------------------------- 3. phase 1 (ptau) */

console.log(`\n[3/7] powers of tau (local, 2^${POWER}) - the public mirrors are all dead, we generate it`);

const PTAU_0000 = b(`pot${POWER}_0000.ptau`);
const PTAU_0001 = b(`pot${POWER}_0001.ptau`);
const PTAU_0002 = b(`pot${POWER}_0002.ptau`);
const PTAU_BEACON = b(`pot${POWER}_beacon.ptau`);
const PTAU_FINAL = b(`pot${POWER}_final.ptau`);

const BEACON_HASH = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const BEACON_ITERS = "10";

const record = (phase, label, file, extra) => {
  transcript.push({
    phase,
    label,
    file: path.basename(file),
    sha256: sha256(file),
    bytes: size(file),
    at: new Date().toISOString(),
    ...extra,
  });
};

step("ptau new", () => snark("powersoftau", "new", "bn128", String(POWER), PTAU_0000, "-v"));
record("phase 1", "initialise", PTAU_0000);

step("ptau contribute #1", () =>
  snark("powersoftau", "contribute", PTAU_0000, PTAU_0001, "--name=phase1-dev-1", entropy()),
);
record("phase 1", "contribution #1 (phase1-dev-1)", PTAU_0001, {
  entropySource: "node:crypto randomBytes(32), discarded after use",
});

step("ptau contribute #2", () =>
  snark("powersoftau", "contribute", PTAU_0001, PTAU_0002, "--name=phase1-dev-2", entropy()),
);
record("phase 1", "contribution #2 (phase1-dev-2)", PTAU_0002, {
  entropySource: "node:crypto randomBytes(32), discarded after use",
});

step("ptau beacon", () =>
  snark("powersoftau", "beacon", PTAU_0002, PTAU_BEACON, BEACON_HASH, BEACON_ITERS, "-n=phase1-beacon"),
);
record("phase 1", "beacon", PTAU_BEACON, { beacon: BEACON_HASH, iterationsExp: BEACON_ITERS });

step("ptau prepare phase2", () =>
  snark("powersoftau", "prepare", "phase2", PTAU_BEACON, PTAU_FINAL, "-v"),
);
record("phase 1", "prepare phase2", PTAU_FINAL);

step("ptau verify", () => snark("powersoftau", "verify", PTAU_FINAL));

/* ------------------------------------------- 4. phase 2 (circuit-specific) */

console.log("\n[4/7] groth16 phase 2 - two independent contributions plus a beacon");

const ZKEY_0000 = b(`${CIRCUIT}_0000.zkey`);
const ZKEY_0001 = b(`${CIRCUIT}_0001.zkey`);
const ZKEY_0002 = b(`${CIRCUIT}_0002.zkey`);
const ZKEY_FINAL = b(`${CIRCUIT}_final.zkey`);
const VKEY = b("verification_key.json");

step("groth16 setup", () => snark("groth16", "setup", b(`${CIRCUIT}.r1cs`), PTAU_FINAL, ZKEY_0000));
record("phase 2", "setup (zkey_0000)", ZKEY_0000);

step("zkey contribute #1", () =>
  snark("zkey", "contribute", ZKEY_0000, ZKEY_0001, "--name=phase2-dev-1", entropy()),
);
record("phase 2", "contribution #1 (phase2-dev-1)", ZKEY_0001, {
  entropySource: "node:crypto randomBytes(32), discarded after use",
});

step("zkey contribute #2", () =>
  snark("zkey", "contribute", ZKEY_0001, ZKEY_0002, "--name=phase2-dev-2", entropy()),
);
record("phase 2", "contribution #2 (phase2-dev-2)", ZKEY_0002, {
  entropySource: "node:crypto randomBytes(32), discarded after use",
});

step("zkey beacon", () =>
  snark("zkey", "beacon", ZKEY_0002, ZKEY_FINAL, BEACON_HASH, BEACON_ITERS, "-n=phase2-beacon"),
);
record("phase 2", "beacon (final)", ZKEY_FINAL, {
  beacon: BEACON_HASH,
  iterationsExp: BEACON_ITERS,
});

const zkeyVerifyOut = step("zkey verify", () =>
  snark("zkey", "verify", b(`${CIRCUIT}.r1cs`), PTAU_FINAL, ZKEY_FINAL),
);
if (!/ZKey Ok/i.test(zkeyVerifyOut)) fail("snarkjs zkey verify did not report OK:\n" + zkeyVerifyOut);
console.log("  zkey verify: ZKey Ok");

step("export vkey", () => snark("zkey", "export", "verificationkey", ZKEY_FINAL, VKEY));
record("phase 2", "verification key export", VKEY);

const vk = JSON.parse(readFileSync(VKEY, "utf8"));
if (Number(vk.nPublic) !== nPublic) {
  fail(`verification_key.json says nPublic=${vk.nPublic}, the r1cs says ${nPublic}`);
}
if (vk.IC.length !== nPublic + 1) {
  fail(`vk.IC has ${vk.IC.length} points, expected nPublic + 1 = ${nPublic + 1}`);
}
console.log(`  vkey: protocol=${vk.protocol} curve=${vk.curve} nPublic=${vk.nPublic} IC=${vk.IC.length}`);

/* ------------------------------- 5. end-to-end value check (layout, again) */

console.log("\n[5/7] end-to-end proof over a known witness");

// snarkjs is hoisted to the root node_modules by npm workspaces; plain
// specifier resolution finds it from anywhere inside the repo.
const snarkjs = await import("snarkjs");

const { input, expectedPublicSignals, derived } = buildCircuitInput(DEMO);
writeFileSync(b("input.json"), JSON.stringify(input, null, 2));

const tProve = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`),
  ZKEY_FINAL,
);
const proveMs = Date.now() - tProve;

const tVerify = Date.now();
const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
const verifyMs = Date.now() - tVerify;
if (!ok) fail("the proof produced by this setup does not verify against its own verification key");

console.log(`  fullProve: ${proveMs} ms    verify: ${verifyMs} ms    verified: ${ok}`);

// The SECOND, independent layout check: the values the circuit actually
// emitted must equal the values poseidon-lite computes for the same inputs,
// slot for slot. This catches a Poseidon arity or argument-order drift
// between the circuit and backend/src/protocol/policy.ts, which otherwise
// surfaces only as "proof invalid" with no useful error.
if (publicSignals.length !== nPublic) {
  fail(`fullProve returned ${publicSignals.length} public signals, expected ${nPublic}`);
}
for (let i = 0; i < nPublic; i++) {
  if (String(publicSignals[i]) !== expectedPublicSignals[i]) {
    fail(
      `public signal [${i}] (${DOCUMENTED_LAYOUT[i]}) is ${publicSignals[i]} from the circuit but ` +
        `${expectedPublicSignals[i]} from poseidon-lite.\n` +
        "  The circuit's Poseidon arity/argument order has drifted from " +
        "backend/src/protocol/policy.ts. Fix one of them.",
    );
  }
}
console.log("  VALUE ASSERTION PASSED - all 7 signals match poseidon-lite for the same inputs");
console.log(`    eligible = ${derived.eligible} (a demo profile that satisfies the demo policy)`);

writeFileSync(b("proof.json"), JSON.stringify(proof, null, 2));
writeFileSync(b("public.json"), JSON.stringify(publicSignals, null, 2));

/* ------------------------------------------------------- 6. emit outputs */

console.log("\n[6/7] emit artifacts - browser AND Solana, together");

const signalLayout = {
  circuit: CIRCUIT,
  circomVersion,
  generatedAt: new Date().toISOString(),
  nPublic,
  nPublicOutputs: header.nPubOut,
  nPublicInputs: header.nPubIn,
  nPrivateInputs: header.nPrvIn,
  constraints: {
    nonLinear: counts.nonLinear,
    linear: counts.linear,
    total: counts.nonLinear + counts.linear,
    r1cs: header.nConstraints,
  },
  /** Index -> signal name. Derived from the compiled .sym, not assumed. */
  order: derivedLayout,
  artifacts: {
    wasmSha256: sha256(b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`)),
    zkeySha256: sha256(ZKEY_FINAL),
    vkeySha256: sha256(VKEY),
  },
  ceremony: {
    kind: "development",
    trusted: false,
    note:
      "Development setup run by one person on one machine. Whoever ran it could forge proofs. " +
      "See zk/build/ceremony-transcript.md.",
  },
};
writeFileSync(b("signal_layout.json"), JSON.stringify(signalLayout, null, 2));

// ---- browser artifacts ----
mkdirSync(FRONTEND_PUBLIC_ZK, { recursive: true });
const copies = [
  [b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`), path.join(FRONTEND_PUBLIC_ZK, `${CIRCUIT}.wasm`)],
  [ZKEY_FINAL, path.join(FRONTEND_PUBLIC_ZK, `${CIRCUIT}.zkey`)],
  [VKEY, path.join(FRONTEND_PUBLIC_ZK, "verification_key.json")],
  [b("signal_layout.json"), path.join(FRONTEND_PUBLIC_ZK, "signal_layout.json")],
];
for (const [src, dst] of copies) copyFileSync(src, dst);

// ---- generated TypeScript mirror of the layout ----
mkdirSync(FRONTEND_SHARED, { recursive: true });
const tsPath = path.join(FRONTEND_SHARED, "signalLayout.ts");
writeFileSync(tsPath, renderSignalLayoutTs(signalLayout));

// ---- Solana verifying key + proof fixture ----
const { rust, checks } = toSolana({ proof, publicSignals, vk });
for (const c of checks) {
  if (!c.passed) fail(`to_solana check "${c.name}" failed (${c.detail})`);
}
console.log(`  to_solana: ${checks.length} byte-level checks passed (proof.A negated, G2 c1-first, all 32-byte BE)`);
writeFileSync(b("vk_data.rs"), rust);

// ---- ceremony transcript ----
writeFileSync(b("ceremony-transcript.md"), renderTranscript());

/* --------------------------------------------------------- 7. size report */

console.log("\n[7/7] artifacts");
const report = [
  ["frontend/public/zk/credit_policy.wasm", path.join(FRONTEND_PUBLIC_ZK, `${CIRCUIT}.wasm`), mb],
  ["frontend/public/zk/credit_policy.zkey", path.join(FRONTEND_PUBLIC_ZK, `${CIRCUIT}.zkey`), mb],
  ["frontend/public/zk/verification_key.json", path.join(FRONTEND_PUBLIC_ZK, "verification_key.json"), kb],
  ["frontend/public/zk/signal_layout.json", path.join(FRONTEND_PUBLIC_ZK, "signal_layout.json"), kb],
  ["frontend/src/shared/signalLayout.ts", tsPath, kb],
  ["zk/build/vk_data.rs", b("vk_data.rs"), kb],
  ["zk/build/ceremony-transcript.md", b("ceremony-transcript.md"), kb],
  ["zk/build/credit_policy.r1cs", b(`${CIRCUIT}.r1cs`), kb],
  [`zk/build/pot${POWER}_final.ptau`, PTAU_FINAL, mb],
];
for (const [label, file, fmt] of report) {
  console.log(`  ${label.padEnd(42)} ${fmt(size(file)).padStart(10)}`);
}

console.log(`\ndone in ${secs(Date.now() - t0)}`);
console.log(
  "\nTRUSTED SETUP: development ceremony, one person, one machine. Whoever ran it\n" +
    "could forge proofs. This is not a real multi-party ceremony - see\n" +
    "zk/build/ceremony-transcript.md and say so out loud in the demo.",
);

// snarkjs (via ffjavascript) leaves its worker-thread pool alive, so the
// process never reaches a natural exit. Flush stdout, then exit explicitly —
// without the flush callback, process.exit() truncates output on Windows,
// where stdout pipes are asynchronous.
process.stdout.write("", () => process.exit(0));

/* ------------------------------------------------------------- renderers */

function renderSignalLayoutTs(layout) {
  const names = layout.order.map((n) => JSON.stringify(n)).join(", ");
  const rows = layout.order.map((n, i) => `//   [${i}] ${n}`).join("\n");
  return `// GENERATED FILE - do not edit.
// Emitted by zk/build.mjs from the COMPILED circuit (.r1cs header + .sym),
// not from anybody's assumption about how snarkjs orders public signals.
// Regenerate with \`node zk/build.mjs\`.
//
// Circuit: ${layout.circuit} (${layout.circomVersion})
// Generated: ${layout.generatedAt}
// Constraints: ${layout.constraints.nonLinear} non-linear + ${layout.constraints.linear} linear
//
// Public signal order:
${rows}
//
// The zkey these indices belong to is ${layout.artifacts.zkeySha256.slice(0, 16)}...
// Regenerating the zkey regenerates this file; the two always move together.

import type { PublicSignals } from "./protocol-types";

export const PUBLIC_SIGNAL_ORDER = [${names}] as const;

export type PublicSignalName = (typeof PUBLIC_SIGNAL_ORDER)[number];

export const N_PUBLIC_SIGNALS = ${layout.nPublic};

export const CIRCUIT_NAME = ${JSON.stringify(layout.circuit)};

/**
 * Constraint counts of the compiled circuit, so the UI can state the size of
 * the statement being proven without a human retyping a number that moves
 * every time the circuit does.
 */
export const CIRCUIT_CONSTRAINTS = {
  nonLinear: ${layout.constraints.nonLinear},
  linear: ${layout.constraints.linear},
  total: ${layout.constraints.total},
} as const;

/** circom compiler that produced the artifacts. */
export const CIRCOM_VERSION = ${JSON.stringify(layout.circomVersion)};

/** sha256 of the artifacts these indices were derived from. */
export const ARTIFACT_HASHES = {
  wasm: ${JSON.stringify(layout.artifacts.wasmSha256)},
  zkey: ${JSON.stringify(layout.artifacts.zkeySha256)},
  verificationKey: ${JSON.stringify(layout.artifacts.vkeySha256)},
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
  const eligible = raw[${layout.order.indexOf("eligible")}];
  if (eligible !== "0" && eligible !== "1") {
    throw new Error("eligible must be a bit, got " + eligible);
  }
  return {
    passportCommitment: toHex(raw[${layout.order.indexOf("passportCommitment")}]),
    eligible: eligible === "1",
    policyHash: toHex(raw[${layout.order.indexOf("policyHash")}]),
    subjectCommitment: toHex(raw[${layout.order.indexOf("subjectCommitment")}]),
    expiry: Number(raw[${layout.order.indexOf("expiry")}]),
    nullifier: toHex(raw[${layout.order.indexOf("nullifier")}]),
    verifierCommitment: toHex(raw[${layout.order.indexOf("verifierCommitment")}]),
  };
}

/** The inverse: PublicSignals -> decimal strings in wire order, for verify(). */
export function encodePublicSignals(signals: PublicSignals): string[] {
  const out: string[] = new Array(N_PUBLIC_SIGNALS);
  out[${layout.order.indexOf("passportCommitment")}] = BigInt(signals.passportCommitment).toString();
  out[${layout.order.indexOf("eligible")}] = signals.eligible ? "1" : "0";
  out[${layout.order.indexOf("policyHash")}] = BigInt(signals.policyHash).toString();
  out[${layout.order.indexOf("subjectCommitment")}] = BigInt(signals.subjectCommitment).toString();
  out[${layout.order.indexOf("expiry")}] = String(signals.expiry);
  out[${layout.order.indexOf("nullifier")}] = BigInt(signals.nullifier).toString();
  out[${layout.order.indexOf("verifierCommitment")}] = BigInt(signals.verifierCommitment).toString();
  return out;
}
`;
}

function renderTranscript() {
  const rows = transcript
    .map(
      (e) =>
        `| ${e.phase} | ${e.label} | \`${e.file}\` | ${e.bytes.toLocaleString("en-US")} | \`${e.sha256}\` | ${e.at} |`,
    )
    .join("\n");
  const timingRows = timings.map((t) => `| ${t.label} | ${secs(t.ms)} |`).join("\n");

  return `# Trusted setup transcript — \`credit_policy\`

**Generated:** ${new Date().toISOString()}
**Circuit:** \`zk/circuits/credit_policy.circom\` compiled with ${circomVersion}
**Constraints:** ${counts.nonLinear} non-linear + ${counts.linear} linear (${counts.nonLinear + counts.linear} total)
**Public signals:** ${nPublic} — ${derivedLayout.join(", ")}
**Powers of tau:** 2^${POWER}, generated locally
**Final zkey:** \`${path.basename(ZKEY_FINAL)}\` · sha256 \`${sha256(ZKEY_FINAL)}\`
**Verification key:** sha256 \`${sha256(VKEY)}\`

---

## READ THIS FIRST — this is NOT a real ceremony

This is a **development trusted setup**. Every step below was run by **one person, on one
machine, in one process**, inside a single invocation of \`zk/build.mjs\`. The phase-1 and
phase-2 contributions are "independent" only in the sense that each drew fresh entropy from
\`node:crypto\`'s \`randomBytes(32)\`; they were not made by independent parties who could not
collude, because there was only ever one party.

**The practical consequence, stated plainly: whoever ran this build could forge proofs.**
The Groth16 toxic waste (the trapdoor from every contribution, and the beacon) passed through
a single process on a single machine. Nothing here prevents that process from having retained
it. Anyone who did retain it can produce a proof for a statement that is false — an "eligible"
credential for a portfolio that does not satisfy the policy — and that forged proof would
verify against this verification key, in the browser and on Solana alike.

The entropy was discarded (never written to disk, never logged) and the run ends with a public
beacon, which is what a real ceremony does. That is good hygiene. It is **not** a security
argument, because you have only this document's word for it, and this document was written by
the same script.

**What a real setup requires:** many independent participants, at least one of whom is honest
and destroys their contribution; a public, verifiable, append-only transcript that third
parties attested to at the time; a beacon drawn from a source fixed after the last contribution.
Perpetual Powers of Tau supplies phase 1 for exactly this reason. This build supplies neither
phase properly.

**Therefore:** treat every proof produced against this key as a demonstration of the mechanism,
not as a security guarantee. Do not put value behind it. A production deployment must re-run
phase 2 as a real multi-party ceremony over a real phase-1 transcript, and re-issue both the
browser artifacts and the Solana program's \`VK_*\` constants from it.

---

## Steps

| phase | step | artifact | bytes | sha256 | timestamp (UTC) |
|---|---|---|---|---|---|
${rows}

### Beacon

Both phases were finalised with \`beacon\`, hash
\`${BEACON_HASH}\`, ${BEACON_ITERS} iterations
(2^${BEACON_ITERS} applications of SHA-256 as the delay function).

This beacon value is a **fixed constant in \`zk/build.mjs\`**, not a value drawn from a public
randomness source after the last contribution. A real ceremony draws it from something nobody
could have predicted or influenced — a future block hash, a drand round, an NIST beacon pulse.
Using a hardcoded constant means the beacon adds reproducibility, not unpredictability. It is
listed here so nobody mistakes it for the real thing.

### Contributions

| phase | name | entropy |
|---|---|---|
| 1 | \`phase1-dev-1\` | \`crypto.randomBytes(32)\`, generated in-process, never persisted |
| 1 | \`phase1-dev-2\` | \`crypto.randomBytes(32)\`, generated in-process, never persisted |
| 1 | \`phase1-beacon\` | fixed constant above |
| 2 | \`phase2-dev-1\` | \`crypto.randomBytes(32)\`, generated in-process, never persisted |
| 2 | \`phase2-dev-2\` | \`crypto.randomBytes(32)\`, generated in-process, never persisted |
| 2 | \`phase2-beacon\` | fixed constant above |

Two independent phase-2 contributions plus a beacon, as required. \`snarkjs zkey verify\`
re-checked the full phase-2 chain against the r1cs and the phase-1 transcript and reported
\`ZKey Ok\`.

## Timings on the build machine

| step | wall clock |
|---|---|
${timingRows}
| **total** | **${secs(Date.now() - t0)}** |

## Reproduce

\`\`\`bash
npm install            # links the zk workspace
node zk/getcircom.mjs  # circom 2.2.3 into zk/bin/
node zk/build.mjs      # this transcript, regenerated
\`\`\`

The artifact hashes will differ from the table above: every run draws fresh entropy, so every
run produces a different zkey and a different verification key. That is expected. What must
reproduce is the **circuit** — \`credit_policy.r1cs\` is deterministic — and the derived public
signal layout.

## One build step, two outputs

\`build.mjs\` writes the browser artifacts (\`frontend/public/zk/\`) and the Solana program's
verifying key (\`zk/build/vk_data.rs\`) in the same run, on purpose. Regenerating the zkey
changes the verifying key, so if the two are ever regenerated separately every proof fails
on-chain with no useful error.
`;
}
