import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import fs from "node:fs";

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => F.toObject(poseidon(arr.map(BigInt)));

// --- private snapshot (in production: derived from real Mobula portfolio data) ---
const assets = 340000n, debtRatio = 28n, historyMonths = 14n, restrictedExposure = 0n;
const passportSalt = 987654321987654321n;

// --- lender policy ---
const minAssets = 100000n, maxDebtRatio = 40n, minHistoryMonths = 12n, screenExposure = 1n;

const policyHash = H([minAssets, maxDebtRatio, minHistoryMonths, screenExposure]);
// verifierCommitment: keccak/poseidon of the lender's ENS namehash, truncated into the field
const verifierCommitment = H([0x7661756c74n, 0x6c656e646572n]);
const expiry = 1789000000n;
const nullifier = H([passportSalt, policyHash, verifierCommitment]);

const input = {
  assets: assets.toString(), debtRatio: debtRatio.toString(),
  historyMonths: historyMonths.toString(), restrictedExposure: restrictedExposure.toString(),
  passportSalt: passportSalt.toString(),
  minAssets: minAssets.toString(), maxDebtRatio: maxDebtRatio.toString(),
  minHistoryMonths: minHistoryMonths.toString(), screenExposure: screenExposure.toString(),
  policyHash: policyHash.toString(), verifierCommitment: verifierCommitment.toString(),
  expiry: expiry.toString(), nullifier: nullifier.toString(),
};
fs.writeFileSync("input.json", JSON.stringify(input, null, 2));
console.log("policyHash  =", policyHash.toString());
console.log("nullifier   =", nullifier.toString());

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input, "credit_policy_js/credit_policy.wasm", "cp_final.zkey"
);
const t1 = Date.now();
console.log("PROVING TIME:", (t1 - t0), "ms");
console.log("publicSignals:", publicSignals);

const vKey = JSON.parse(fs.readFileSync("verification_key.json"));
const t2 = Date.now();
const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
console.log("VERIFY TIME:", (Date.now() - t2), "ms");
console.log("VERIFIED:", ok);

fs.writeFileSync("proof.json", JSON.stringify(proof, null, 2));
fs.writeFileSync("public.json", JSON.stringify(publicSignals, null, 2));

// --- negative test: a policy this profile should FAIL (min assets 500k) ---
const minAssets2 = 500000n;
const policyHash2 = H([minAssets2, maxDebtRatio, minHistoryMonths, screenExposure]);
const nullifier2 = H([passportSalt, policyHash2, verifierCommitment]);
const input2 = { ...input,
  minAssets: minAssets2.toString(), policyHash: policyHash2.toString(), nullifier: nullifier2.toString() };
const r2 = await snarkjs.groth16.fullProve(input2, "credit_policy_js/credit_policy.wasm", "cp_final.zkey");
console.log("FAILING-POLICY publicSignals:", r2.publicSignals);
console.log("  (index 1 = eligible flag; expect 0)");
process.exit(0);
