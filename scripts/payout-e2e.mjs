// scripts/payout-e2e.mjs — drive the ENS payout leg end to end against a
// RUNNING backend, with a real Groth16 proof.
//
// This exists because the browser demo needs a portfolio that actually passes
// a policy, and real mainnet addresses that do are hard to come by on demand.
// The protocol path, though, is exactly the same one the two tabs walk:
//
//   session x2 -> publish request (ensName + payout key)
//              -> challenge -> groth16 proof -> verify
//              -> offer -> accept -> TWO payout announcements
//              -> recover both in the "borrower"
//
// Nothing here is mocked. The proof is produced by snarkjs over the compiled
// circuit, the server verifies it with its own verifying key, and the payout
// addresses are derived and recovered with the SHIPPING modules
// (frontend/src/shared/ensPayout.ts), imported directly rather than
// reimplemented, so a break in the app breaks this too.
//
// Usage:  node scripts/payout-e2e.mjs [--api http://localhost:3005]

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as snarkjs from "snarkjs";

import { buildCircuitInput, fieldToHex, randomFieldElement } from "../zk/protocol.mjs";
import { b, CIRCUIT } from "../zk/paths.mjs";
import {
  bytesToHex0x,
  derivePayoutAddress,
  deriveViewingKeypair,
  encodePayoutRecord,
  hexToBytesStrict,
  recoverPayoutKeypair,
  solanaAddressFromSecretKey,
} from "../frontend/src/shared/ensPayout.ts";

const argv = process.argv.slice(2);
const optIndex = argv.indexOf("--api");
const API = optIndex >= 0 && argv[optIndex + 1] ? argv[optIndex + 1] : "http://localhost:3005";

const WASM = b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY = b(`${CIRCUIT}_final.zkey`);
for (const artifact of [WASM, ZKEY]) {
  if (!existsSync(artifact)) {
    console.error(`missing ${path.relative(process.cwd(), artifact)} — run \`npm run zk:build\``);
    process.exit(1);
  }
}

let failures = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? "  " + detail : ""}`);
const bad = (label, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`);
};
const assert = (cond, label, detail = "") => (cond ? ok(label, detail) : bad(label, detail));

async function call(method, route, body) {
  const response = await fetch(API + route, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${route} did not return JSON: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    const error = new Error(`${method} ${route} -> ${response.status} ${parsed?.error ?? ""}`);
    error.status = response.status;
    error.body = parsed;
    throw error;
  }
  return parsed;
}

async function expectReject(status, label, work) {
  try {
    await work();
    bad(label, `expected ${status}, the call succeeded`);
  } catch (cause) {
    if (cause.status === status) ok(label, `-> ${status} ${cause.body?.error ?? ""}`);
    else bad(label, `expected ${status}, got ${cause.status ?? cause.message}`);
  }
}

console.log(`payout-e2e against ${API}`);

/* ------------------------------------------------------------- 0. health */

const health = await call("GET", "/api/health");
console.log(
  `  server ${health.version} · groth16 ${health.verifier?.ready ? "ready" : "NOT READY"} · vkey ${
    (health.verifier?.verifyingKeySha256 ?? "?").slice(0, 16)
  } · ceremony ${health.verifier?.ceremony?.kind} (trusted=${health.verifier?.ceremony?.trusted})`,
);

/* ------------------------------------------- 1. the borrower's identity */

// A FIXED 65 bytes standing in for a `personal_sign` output. Fixed on purpose:
// the browser tab can paste the same hex into the recovery panel and derive
// the identical viewing key, which is the whole point of deriving the key from
// a deterministic signature instead of storing one.
const SIGNATURE = "0x" + "5e".repeat(65);
const viewing = deriveViewingKeypair(SIGNATURE);
const ENS_NAME = "lplensagent.eth";

console.log(`  identity ${ENS_NAME}`);
console.log(`  viewing key ${bytesToHex0x(viewing.publicKey)}`);
console.log(`  record value it would publish: ${encodePayoutRecord(viewing.publicKey)}`);
console.log(`  signature to paste into the browser: ${SIGNATURE}`);

/* -------------------------------------------------------- 2. two parties */

const borrower = await call("POST", "/api/session", { role: "borrower", sessionId: null });
const lender = await call("POST", "/api/session", { role: "lender", sessionId: null });
console.log(`  borrower ${borrower.label} ${borrower.sessionId}`);
console.log(`  lender   ${lender.label} ${lender.sessionId}`);

/* ------------------------------------------------- 3. a witness and salt */

const witness = {
  assets: 42_500,
  collateralQuality: 71,
  historyMonths: 19,
  restrictedExposure: false,
};
const policy = {
  minimumAssets: 10_000,
  minimumCollateralQuality: 50,
  minimumHistoryMonths: 6,
  screenRestrictedExposure: true,
};
const salt = randomFieldElement();
const blindingFactor = randomFieldElement();

// A real provenance object, so the request is publishable: the route requires
// provenance.address to be a genuine Solana address.
const passport = await call(
  "GET",
  // Unsigned read: needs the backend started with ALLOW_UNSIGNED_PASSPORT=1.
  "/api/passport/DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
);

const built0 = buildCircuitInput({
  witness,
  policy,
  salt,
  subjectId: ENS_NAME,
  blindingFactor,
  lenderLabel: "placeholder",
  lenderSessionId: "placeholder",
  expiry: 0,
});

/* ------------------------------------------------------- 4. the request */

const request = await call("POST", "/api/requests", {
  sessionId: borrower.sessionId,
  amount: 25_000,
  collateral: 20_000,
  termDays: 90,
  // protocol.mjs returns field elements as bigints; the wire carries hex.
  passportCommitment: fieldToHex(built0.derived.pc),
  provenance: passport.provenance,
  ensName: ENS_NAME,
});
assert(request.ensName === ENS_NAME, "the request carries the ENS identity", request.ensName);

/* ----------------------------------------------------- 5. the challenge */

const challenge = await call("POST", "/api/challenges", {
  sessionId: lender.sessionId,
  requestId: request.id,
  policy,
  validityMinutes: 30,
});

/* -------------------------------------------------------- 6. the proof */

const built = buildCircuitInput({
  witness,
  policy,
  salt,
  subjectId: ENS_NAME,
  blindingFactor,
  lenderLabel: challenge.lenderLabel,
  lenderSessionId: challenge.lenderSessionId,
  expiry: Math.floor(challenge.expiresAt / 1000),
});
assert(
  BigInt(built.derived.ph) === BigInt(challenge.policyHash),
  "the policy hash this script derives equals the server's",
);
assert(
  BigInt(built.derived.vc) === BigInt(challenge.verifierCommitment),
  "the verifier commitment this script derives equals the server's",
);

const started = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, WASM, ZKEY);
const proveMs = Date.now() - started;
assert(
  publicSignals.length === 7 && publicSignals.every((v, i) => v === built.expectedPublicSignals[i]),
  "the circuit emitted the 7 expected public signals",
  `${proveMs} ms`,
);

const hex = (decimal) => "0x" + BigInt(decimal).toString(16).padStart(64, "0");
const signals = {
  passportCommitment: hex(publicSignals[0]),
  eligible: publicSignals[1] === "1",
  policyHash: hex(publicSignals[2]),
  subjectCommitment: hex(publicSignals[3]),
  expiry: Number(publicSignals[4]),
  nullifier: hex(publicSignals[5]),
  verifierCommitment: hex(publicSignals[6]),
};
assert(signals.eligible, "eligible = 1");

const submitted = await call("POST", "/api/proofs", {
  sessionId: borrower.sessionId,
  requestId: request.id,
  challengeId: challenge.id,
  proofSystem: "groth16-bn254",
  publicSignals: signals,
  results: [
    { key: "assets", label: "Collateral value", passed: true, requirement: "" },
    { key: "quality", label: "Collateral quality", passed: true, requirement: "" },
    { key: "history", label: "Account history", passed: true, requirement: "" },
    { key: "exposure", label: "Restricted exposure", passed: true, requirement: "" },
  ],
  proof: JSON.stringify({ proof, publicSignals }),
});

const verified = await call("POST", `/api/proofs/${submitted.id}/verify`, {
  sessionId: lender.sessionId,
});
assert(verified.verification.status === "verified", "the server verified the proof");
const groth = verified.verification.checks.find((c) => c.name === "groth16_verified");
assert(Boolean(groth?.passed), "groth16_verified passed", groth?.detail.slice(0, 96));

// `--stop-after-verify` leaves the run at exactly the state where the lender's
// VerificationPanel is on screen with the receipt and the server's checklist —
// useful when what you want to look at is the receipt rather than the payout.
if (argv.includes("--stop-after-verify")) {
  console.log("");
  console.log("Stopped after verification. Open the lender tab with:");
  console.log(`  sessionStorage['pc.session.lender'] = "${lender.sessionId}"`);
  console.log(failures === 0 ? "payout-e2e OK (partial run)" : `payout-e2e FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

/* -------------------------------------------------- 7. offer and loan */

const offer = await call("POST", "/api/offers", {
  sessionId: lender.sessionId,
  requestId: request.id,
  proofId: submitted.id,
  apr: 10.4,
  fee: 125,
  deposit: request.collateral,
  note: "payout-e2e",
});
const accepted = await call("POST", `/api/offers/${offer.id}/accept`, {
  sessionId: borrower.sessionId,
});
assert(accepted.loan.status === "funded", "the loan exists", accepted.loan.id);

/* ------------------------------------------- 8. the payout derivations */

// The lender resolves the identity and derives against the key published
// under the ENS name. This script holds the viewing keypair itself, so it
// derives against its public half directly — the same bytes the ENS record
// carries once `npm run ens:setup -- --set-text` has written it.
const recipientPublicKey = viewing.publicKey;

const announcements = [];
for (let draw = 1; draw <= 2; draw += 1) {
  const derived = derivePayoutAddress({ recipientPublicKey, requestId: request.id });
  const row = await call("POST", "/api/payouts", {
    sessionId: lender.sessionId,
    requestId: request.id,
    offerId: offer.id,
    ensName: ENS_NAME,
    ephemeralPublicKey: bytesToHex0x(derived.ephemeralPublicKey),
    viewTag: derived.viewTag,
    payoutAddress: derived.solanaAddress,
    keySource: "ens-text-record",
    ensBlockNumber: null,
    ensRecordValue: "",
  });
  announcements.push(row);
  console.log(
    `  draw ${draw}  ${row.payoutAddress}  R ${row.ephemeralPublicKey.slice(0, 14)}…  tag 0x${row.viewTag
      .toString(16)
      .padStart(2, "0")}`,
  );
}

assert(
  announcements[0].payoutAddress !== announcements[1].payoutAddress,
  "TWO DRAWS ON ONE ENS NAME PRODUCE TWO DIFFERENT PAYOUT ADDRESSES",
);
assert(
  announcements[0].ephemeralPublicKey !== announcements[1].ephemeralPublicKey,
  "each draw published its own ephemeral key R",
);

await expectReject(403, "a borrower announcing a payout", () =>
  call("POST", "/api/payouts", {
    sessionId: borrower.sessionId,
    requestId: request.id,
    offerId: offer.id,
    ensName: ENS_NAME,
    ephemeralPublicKey: announcements[0].ephemeralPublicKey,
    viewTag: 1,
    payoutAddress: announcements[0].payoutAddress,
    keySource: "ens-text-record",
  }),
);

await expectReject(409, "a payout announced against a different ENS name", () =>
  call("POST", "/api/payouts", {
    sessionId: lender.sessionId,
    requestId: request.id,
    offerId: offer.id,
    ensName: "somebodyelse.eth",
    ephemeralPublicKey: bytesToHex0x(new Uint8Array(32).fill(9)),
    viewTag: 1,
    payoutAddress: announcements[0].payoutAddress,
    keySource: "ens-text-record",
  }),
);

/* --------------------------------------------------- 9. the recovery */

for (const [index, row] of announcements.entries()) {
  const recovered = recoverPayoutKeypair({
    viewingPrivateKey: viewing.privateKey,
    ephemeralPublicKey: hexToBytesStrict(row.ephemeralPublicKey, "R"),
    requestId: request.id,
    viewTag: row.viewTag,
  });
  assert(recovered !== null, `draw ${index + 1}: the view tag matched`);
  assert(
    recovered?.solanaAddress === row.payoutAddress,
    `draw ${index + 1}: recovered address equals the announced one`,
    recovered?.solanaAddress,
  );
  assert(
    recovered !== null && solanaAddressFromSecretKey(recovered.secretKey) === row.payoutAddress,
    `draw ${index + 1}: the recovered secret key really controls that address`,
  );
}

// A stranger's viewing key must recover nothing.
const stranger = deriveViewingKeypair("0x" + "a7".repeat(65));
const strangerAttempt = recoverPayoutKeypair({
  viewingPrivateKey: stranger.privateKey,
  ephemeralPublicKey: hexToBytesStrict(announcements[0].ephemeralPublicKey, "R"),
  requestId: request.id,
  viewTag: announcements[0].viewTag,
});
assert(strangerAttempt === null, "an unrelated viewing key recovers nothing (view tag rejects it)");

const strangerNoTag = recoverPayoutKeypair({
  viewingPrivateKey: stranger.privateKey,
  ephemeralPublicKey: hexToBytesStrict(announcements[0].ephemeralPublicKey, "R"),
  requestId: request.id,
});
assert(
  strangerNoTag !== null && strangerNoTag.solanaAddress !== announcements[0].payoutAddress,
  "with the view-tag filter bypassed, a stranger still derives a DIFFERENT address",
);

/* ---------------------------------------------- 10. the shared state */

const state = await call(
  "GET",
  `/api/state?role=lender&sessionId=${lender.sessionId}&since=0`,
);
assert(state.payouts.length >= 2, "the announcements are in GET /api/state", String(state.payouts.length));
const serialised = JSON.stringify(state);
for (const forbidden of ["collateralQuality", "historyMonths", "restrictedExposure", "witness"]) {
  assert(!serialised.includes(forbidden), `the projection still contains no ${forbidden}`);
}

/* ----------------------------------- 11. settle it on Solana, for real */

// Everything above is off-chain protocol. This section is workstream E: the
// same receipt is handed to a deployed Anchor program that verifies the
// Groth16 proof with the BN254 syscalls, recomputes the policy hash from its
// own stored account, spends a nullifier PDA and moves SPL tokens to the
// one-time payout address derived from the ENS payout key.
//
// Skipped, loudly, when no program is deployed — a run against a machine with
// no validator should say "not deployed", never quietly pass.

const settlementConfig = await call("GET", "/api/settlement/config");
console.log("");
console.log(
  `  settlement: ${settlementConfig.cluster} · program ${settlementConfig.programId ?? "none"} · ` +
    `${settlementConfig.enabled ? "ready" : "DISABLED — " + settlementConfig.problem}`,
);

if (!settlementConfig.enabled) {
  console.log("  skipping the on-chain section. `npm run solana:up` brings it back.");
} else {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { getAccount, getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const connection = new Connection(settlementConfig.rpcUrl, "confirmed");

  assert(
    settlementConfig.vkMatches,
    "the deployed program was built against this backend's verifying key",
    settlementConfig.vkHash ?? "",
  );

  const settlement = await call("POST", "/api/settlements", {
    sessionId: lender.sessionId,
    requestId: request.id,
    offerId: offer.id,
    proofId: submitted.id,
    payoutId: announcements[0].id,
  });

  for (const step of settlement.steps) {
    const outcome = step.error
      ? `ERROR ${step.error}`
      : step.skipped
        ? "skipped (already on chain)"
        : `${step.signature.slice(0, 16)}…  slot ${step.slot}` +
          (step.computeUnits ? `  ${step.computeUnits} CU` : "");
    console.log(`    ${step.name.padEnd(22)} ${outcome}`);
  }

  assert(settlement.status === "settled", "the settlement completed", settlement.error ?? "");

  const present = settlement.steps.find((row) => row.name === "present_and_fund");
  assert(Boolean(present?.signature), "present_and_fund landed on chain", present?.signature ?? "");
  assert(
    (present?.computeUnits ?? 0) > 100_000,
    "on-chain Groth16 verification really ran",
    `${present?.computeUnits} compute units — the pairing check alone is ~105k`,
  );

  // The money. Not the program's word for it: read the accounts back.
  const payoutAddress = new PublicKey(announcements[0].payoutAddress);
  const payoutTokens = getAssociatedTokenAddressSync(
    new PublicKey(settlement.mint),
    payoutAddress,
    true,
  );
  const tokenAccount = await getAccount(connection, payoutTokens, "confirmed");
  assert(
    tokenAccount.amount.toString() === settlement.principalBaseUnits,
    "the principal arrived at the one-time payout address",
    `${tokenAccount.amount} base units of ${settlement.mintSymbol}`,
  );

  const lamports = await connection.getBalance(payoutAddress, "confirmed");
  assert(
    lamports >= 2_000_000,
    "the payout address was funded with SOL so it can actually sweep",
    `${lamports} lamports`,
  );

  // The vault must be empty afterwards: a settlement that leaves money in
  // escrow is a settlement that did not happen.
  const vaultAfter = await getAccount(
    connection,
    new PublicKey(
      settlement.accounts.find((row) => row.name === "Escrow vault").address,
    ),
    "confirmed",
  );
  assert(vaultAfter.amount === 0n, "the escrow vault is empty", `${vaultAfter.amount}`);

  /* -------- the replay guard, demonstrated rather than asserted -------- */

  const replayed = await call("POST", `/api/settlements/${settlement.id}/replay`, {
    sessionId: lender.sessionId,
    proofId: submitted.id,
    payoutId: announcements[0].id,
  });
  const replayStep = replayed.steps.find((row) => row.name === "replay_attempt");
  assert(
    Boolean(replayStep?.error) && !replayStep?.signature,
    "RE-PRESENTING THE SAME RECEIPT IS REJECTED BY THE RUNTIME",
    replayStep?.error?.slice(0, 110) ?? "",
  );

  console.log("");
  console.log(`  program   ${settlement.programId}`);
  console.log(`  explorer  ${present?.explorerUrl}`);
}

console.log("");
console.log("Open these in two browser tabs to see the same rows in the UI:");
console.log(`  borrower  sessionStorage['pc.session.borrower'] = "${borrower.sessionId}"`);
console.log(`  lender    sessionStorage['pc.session.lender']   = "${lender.sessionId}"`);
console.log(`  paste this signature into the recovery panel: ${SIGNATURE}`);
console.log("");
console.log(failures === 0 ? "payout-e2e OK" : `payout-e2e FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
