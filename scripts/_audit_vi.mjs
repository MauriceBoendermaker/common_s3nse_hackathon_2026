// TEMP adversarial probe - verification-integrity lens. Read/probe only.
import * as snarkjs from "snarkjs";
import { b, CIRCUIT } from "../zk/paths.mjs";
import { buildCircuitInput, fieldToHex, passportCommitment } from "../zk/protocol.mjs";

const BASE = `http://localhost:${process.env.PORT || 3021}/api`;
const WASM = b(`${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY = b(`${CIRCUIT}_final.zkey`);

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  PASS  " + m); };
const bad = (m) => { FAIL++; console.log("  FAIL  " + m); };
const step = (m) => console.log("\n== " + m);

async function api(method, path, bodyObj) {
  const r = await fetch(BASE + path, {
    method,
    headers: bodyObj ? { "content-type": "application/json" } : {},
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  return { status: r.status, json: j };
}

const PROVENANCE = {
  address: "GYtUMZdNmU7M5m2oC4hxaaJdheDHVCmhz5BY3XitjARu",
  sources: [{ label: "probe", detail: "synthetic witness, audit probe" }],
};

const WITNESS = { assets: 42500, collateralQuality: 71, historyMonths: 19, restrictedExposure: false };
const POLICY = { minimumAssets: 10000, minimumCollateralQuality: 50, minimumHistoryMonths: 6, screenRestrictedExposure: true };
const RESULTS = [
  { key: "assets", label: "Assets", passed: true, requirement: ">= 10000" },
  { key: "quality", label: "Quality", passed: true, requirement: ">= 50%" },
  { key: "history", label: "History", passed: true, requirement: ">= 6mo" },
  { key: "exposure", label: "Exposure", passed: true, requirement: "no restricted" },
];

const blinding = "0x" + "17".repeat(32);
let saltCounter = 0;
const nextSalt = () => "0x" + (++saltCounter).toString(16).padStart(2, "0").repeat(32);

async function fullFlow({ subject = "probe.eth", policy = POLICY, witness = WITNESS }) {
  const saltHex = nextSalt();
  const borrower = (await api("POST", "/session", { role: "borrower" })).json;
  const lender = (await api("POST", "/session", { role: "lender" })).json;

  const pcField = passportCommitment(witness, saltHex);
  const req = (await api("POST", "/requests", {
    sessionId: borrower.sessionId, amount: 5000, collateral: 8000, termDays: 30,
    passportCommitment: fieldToHex(pcField), provenance: PROVENANCE, ensName: subject,
  })).json;
  if (!req.id) throw new Error("request failed: " + JSON.stringify(req));

  const ch = (await api("POST", "/challenges", {
    sessionId: lender.sessionId, requestId: req.id, policy, validityMinutes: 30,
  })).json;
  if (!ch.id) throw new Error("challenge failed: " + JSON.stringify(ch));

  const expiry = Math.floor(ch.expiresAt / 1000);
  const built = buildCircuitInput({
    witness, policy, salt: saltHex, subjectId: subject, blindingFactor: blinding,
    lenderLabel: ch.lenderLabel, lenderSessionId: ch.lenderSessionId, expiry,
  });
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, WASM, ZKEY);

  const signals = {
    passportCommitment: fieldToHex(built.derived.pc),
    eligible: built.derived.eligible === 1n,
    policyHash: fieldToHex(built.derived.ph),
    subjectCommitment: fieldToHex(built.derived.sc),
    expiry,
    nullifier: fieldToHex(built.derived.nf),
    verifierCommitment: fieldToHex(built.derived.vc),
  };
  return { borrower, lender, req, ch, proof, publicSignals, signals, results: RESULTS };
}

const submit = (f, proofObj, arr, signals) =>
  api("POST", "/proofs", {
    sessionId: f.borrower.sessionId, requestId: f.req.id, challengeId: f.ch.id,
    proofSystem: "groth16-bn254",
    publicSignals: signals ?? f.signals,
    results: f.results,
    proof: JSON.stringify({ proof: proofObj ?? f.proof, publicSignals: arr ?? f.publicSignals }),
  });

/* ================================================================== */

const health = (await api("GET", "/health")).json;
console.log("server verifier ready:", health.verifier.ready, "vkey", health.verifier.verifyingKeySha256.slice(0, 16));

step("1. BASELINE honest flow");
const f1 = await fullFlow({});
const s1 = await submit(f1);
if (s1.status === 201) ok("proof submitted " + s1.json.id); else bad("submit " + s1.status + " " + JSON.stringify(s1.json));
const v1 = await api("POST", `/proofs/${s1.json.id}/verify`, { sessionId: f1.lender.sessionId });
if (v1.json.verification.status === "verified") ok("honest proof verified, " + v1.json.verification.checks.length + " checks");
else bad("honest proof " + v1.json.verification.status + ": " + v1.json.verification.reason);

step("2. REORDERED public-signal array (swap [3] and [4])");
const f2 = await fullFlow({ subject: "reorder.eth" });
const swapped = [...f2.publicSignals];
const tmp = swapped[3]; swapped[3] = swapped[4]; swapped[4] = tmp;
const s2 = await submit(f2, undefined, swapped);
if (s2.status === 201) {
  const v2 = await api("POST", `/proofs/${s2.json.id}/verify`, { sessionId: f2.lender.sessionId });
  const layout = v2.json.verification.checks.find((c) => c.name === "public_signal_layout");
  const g16 = v2.json.verification.checks.find((c) => c.name === "groth16_verified");
  const nz = v2.json.verification.checks.find((c) => c.name === "nullifier_unused");
  if (v2.json.verification.status === "rejected" && !layout.passed) ok("reordered array REJECTED by public_signal_layout");
  else bad("reordered array -> " + v2.json.verification.status);
  if (g16.detail.startsWith("Not performed")) ok("groth16 skipped, not claimed as pass");
  else bad("groth16 detail: " + g16.detail.slice(0, 90));
  if (nz.detail.startsWith("Not performed")) ok("nullifier NOT burned by the rejected verification");
  else bad("nullifier burned: " + nz.detail.slice(0, 90));
} else bad("submit swapped: " + s2.status + " " + JSON.stringify(s2.json));

step("3. named signals object lies about eligible while the array is honest");
const f3 = await fullFlow({ subject: "liar.eth" });
const s3 = await submit(f3, undefined, undefined, { ...f3.signals, eligible: false });
if (s3.status === 201) {
  const v3 = await api("POST", `/proofs/${s3.json.id}/verify`, { sessionId: f3.lender.sessionId });
  const layout = v3.json.verification.checks.find((c) => c.name === "public_signal_layout");
  if (v3.json.verification.status === "rejected" && !layout.passed) ok("object/array mismatch REJECTED");
  else bad("object/array mismatch -> " + v3.json.verification.status);
} else bad("submit lying object: " + s3.status);

step("4. tampered proof point");
const f4 = await fullFlow({ subject: "tamper.eth" });
const badProof = JSON.parse(JSON.stringify(f4.proof));
badProof.pi_a[0] = (BigInt(badProof.pi_a[0]) + 1n).toString();
const s4 = await submit(f4, badProof);
if (s4.status === 201) {
  const v4 = await api("POST", `/proofs/${s4.json.id}/verify`, { sessionId: f4.lender.sessionId });
  const g16 = v4.json.verification.checks.find((c) => c.name === "groth16_verified");
  const nz = v4.json.verification.checks.find((c) => c.name === "nullifier_unused");
  if (!g16.passed && v4.json.verification.status === "rejected") ok("mangled pi_a REJECTED by the pairing check");
  else bad("mangled pi_a -> " + v4.json.verification.status);
  if (nz.detail.startsWith("Not performed")) ok("nullifier NOT burned on pairing failure");
  else bad("nullifier burned on pairing failure");
  const s4b = await submit(f4);
  const v4b = await api("POST", `/proofs/${s4b.json.id}/verify`, { sessionId: f4.lender.sessionId });
  if (v4b.json.verification.status === "verified") ok("honest resubmission of the same nullifier still verifies");
  else bad("honest resubmission -> " + v4b.json.verification.status + " " + v4b.json.verification.reason);
} else bad("submit tampered proof: " + s4.status);

step("5. policy-eval-v0 refused");
const p0 = await api("POST", "/proofs", {
  sessionId: f1.borrower.sessionId, requestId: f1.req.id, challengeId: f1.ch.id,
  proofSystem: "policy-eval-v0", publicSignals: f1.signals, results: f1.results, proof: null,
});
if (p0.status === 400) ok("policy-eval-v0 -> 400 " + JSON.stringify(p0.json.error)); else bad("policy-eval-v0 -> " + p0.status);

step("6. can the client choose the verifying key?");
const f6 = await fullFlow({ subject: "vkey.eth" });
const vkAttack = await api("POST", "/proofs", {
  sessionId: f6.borrower.sessionId, requestId: f6.req.id, challengeId: f6.ch.id,
  proofSystem: "groth16-bn254", publicSignals: f6.signals, results: f6.results,
  proof: JSON.stringify({ proof: f6.proof, publicSignals: f6.publicSignals, vkey: { protocol: "groth16" } }),
  vkey: "attacker", verificationKey: "attacker", vkeyPath: "/tmp/evil.json",
});
if (vkAttack.status === 201) {
  const v = await api("POST", `/proofs/${vkAttack.json.id}/verify`, { sessionId: f6.lender.sessionId, vkey: "attacker", verificationKey: "attacker", vkeyPath: "/tmp/evil.json" });
  const g = v.json.verification.checks.find((c) => c.name === "groth16_verified");
  if (g.detail.includes(health.verifier.verifyingKeySha256.slice(0, 16))) ok("server-side vkey used regardless of client fields");
  else bad("vkey detail: " + g.detail.slice(0, 120));
} else bad("vkey probe submit " + vkAttack.status + " " + JSON.stringify(vkAttack.json));

step("7. SESSION TAKEOVER - is the lender sessionId in /api/state, and can it be claimed?");
const state = await api("GET", `/state?role=borrower&sessionId=${f1.borrower.sessionId}&since=0`);
const leaked = state.json.challenges[0].lenderSessionId;
console.log("  lenderSessionId visible to the BORROWER in GET /api/state:", leaked);
const claimed = await api("POST", "/session", { role: "lender", sessionId: leaked });
if (claimed.json.sessionId === leaked) bad("POST /api/session with a leaked lender sessionId RETURNS that lender party: " + JSON.stringify(claimed.json));
else ok("leaked lender sessionId could not be claimed");

step("8. self-verify + self-fund using the hijacked lender session");
const f8 = await fullFlow({ subject: "selfdeal.eth" });
const st8 = await api("GET", `/state?role=borrower&sessionId=${f8.borrower.sessionId}&since=0`);
const victimLender = st8.json.challenges.find((c) => c.id === f8.ch.id).lenderSessionId;
const hijack = (await api("POST", "/session", { role: "lender", sessionId: victimLender })).json;
console.log("  hijacked party:", JSON.stringify(hijack));
const s8 = await submit(f8);
const v8 = await api("POST", `/proofs/${s8.json.id}/verify`, { sessionId: hijack.sessionId });
console.log("  verify as hijacked lender ->", v8.json.verification?.status);
const o8 = await api("POST", "/offers", {
  sessionId: hijack.sessionId, requestId: f8.req.id, proofId: s8.json.id,
  apr: 5, fee: 10, deposit: 100, note: "self-dealt",
});
if (v8.json.verification?.status === "verified" && o8.status === 201) {
  bad("BORROWER hijacked the lender session, verified their own proof and funded their own request: offer " + o8.json.id);
  const acc = await api("POST", `/offers/${o8.json.id}/accept`, { sessionId: f8.borrower.sessionId });
  console.log("  and accepted it ->", acc.status, acc.json.loan ? "loan " + acc.json.loan.id : JSON.stringify(acc.json));
} else ok("hijack path did not complete (" + v8.json.verification?.status + " / offer " + o8.status + ")");

step("9. can a lender fund against an unverified proof?");
const f9 = await fullFlow({ subject: "unverified.eth" });
const s9 = await submit(f9);
const o9 = await api("POST", "/offers", {
  sessionId: f9.lender.sessionId, requestId: f9.req.id, proofId: s9.json.id, apr: 5, fee: 1, deposit: 1,
});
if (o9.status === 409) ok("offer against a pending proof -> 409 " + JSON.stringify(o9.json.error)); else bad("offer against pending -> " + o9.status);

step("10. can a DIFFERENT lender fund against a proof they never verified?");
const lenderB = (await api("POST", "/session", { role: "lender" })).json;
const v9 = await api("POST", `/proofs/${s9.json.id}/verify`, { sessionId: f9.lender.sessionId });
console.log("  lender A verify:", v9.json.verification.status);
const vB = await api("POST", `/proofs/${s9.json.id}/verify`, { sessionId: lenderB.sessionId });
console.log("  lender B verify:", vB.json.verification.status, "-", vB.json.verification.reason.slice(0, 120));
const oB = await api("POST", "/offers", {
  sessionId: lenderB.sessionId, requestId: f9.req.id, proofId: s9.json.id, apr: 5, fee: 1, deposit: 1,
});
console.log("  lender B offer ->", oB.status, JSON.stringify(oB.json).slice(0, 200));
const stAfter = await api("GET", `/state?role=lender&sessionId=${lenderB.sessionId}&since=0`);
const pAfter = stAfter.json.proofs.find((p) => p.id === s9.json.id);
console.log("  proof status now stored as:", pAfter.verification.status);

step("11. ineligible proof");
const f11 = await fullFlow({ subject: "poor.eth", witness: { assets: 4000, collateralQuality: 12, historyMonths: 1, restrictedExposure: true } });
const s11 = await submit(f11);
const v11 = await api("POST", `/proofs/${s11.json.id}/verify`, { sessionId: f11.lender.sessionId });
const o11 = await api("POST", "/offers", { sessionId: f11.lender.sessionId, requestId: f11.req.id, proofId: s11.json.id, apr: 5, fee: 1, deposit: 1 });
if (v11.json.verification.status === "verified" && o11.status === 409) ok("sound ineligible proof: verified, offer 409");
else bad("ineligible: verify=" + v11.json.verification.status + " offer=" + o11.status);

step("12. replay a receipt at a different lender");
const f12 = await fullFlow({ subject: "replay.eth" });
const s12 = await submit(f12);
await api("POST", `/proofs/${s12.json.id}/verify`, { sessionId: f12.lender.sessionId });
const lenderC = (await api("POST", "/session", { role: "lender" })).json;
const v12 = await api("POST", `/proofs/${s12.json.id}/verify`, { sessionId: lenderC.sessionId });
const vb = v12.json.verification.checks.find((c) => c.name === "verifier_binding");
if (v12.json.verification.status === "rejected" && !vb.passed) ok("replay at a third-party lender REJECTED by verifier_binding");
else bad("replay at third party -> " + v12.json.verification.status);

step("13. error paths / leakage");
const e1 = await api("POST", "/proofs/does-not-exist/verify", { sessionId: f1.lender.sessionId });
console.log("  unknown proof:", e1.status, JSON.stringify(e1.json));
const junk = '{"proof":{"pi_a":["1","2","1"],"pi_b":[["1","2"],["3","4"],["1","0"]],"pi_c":["1","2","1"],"protocol":"groth16","curve":"bn128"},"publicSignals":["1","2","3","4","5","6","7"]}';
const e2 = await api("POST", "/proofs", { sessionId: f1.borrower.sessionId, requestId: f1.req.id, challengeId: f1.ch.id, proofSystem: "groth16-bn254", publicSignals: f1.signals, results: f1.results, proof: junk });
console.log("  junk-point proof submit:", e2.status);
if (e2.status === 201) {
  const v = await api("POST", `/proofs/${e2.json.id}/verify`, { sessionId: f1.lender.sessionId });
  const g = v.json.verification.checks.find((c) => c.name === "groth16_verified");
  console.log("  junk-point groth16 detail:", g.detail.slice(0, 260));
  console.log("  junk-point outcome:", v.json.verification.status);
}
const e3 = await fetch(BASE + "/proofs", { method: "POST", headers: { "content-type": "application/json" }, body: '{"sessionId":' });
console.log("  malformed JSON body:", e3.status, (await e3.text()).slice(0, 200));
console.log("  health.verifier.problems:", JSON.stringify(health.verifier.problems));

console.log(`\n${PASS} passed / ${FAIL} failed`);
