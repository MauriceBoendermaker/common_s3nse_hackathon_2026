#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# The whole two-party flow, over HTTP, with curl, against a REAL Groth16 proof.
#
# Nothing here is mocked. The passport is a live Solana mainnet read, the
# challenge is issued by the running server, the proof is produced by
# `zk/prove.mjs` from the committed circuit artifacts, and every assertion is
# made against the JSON the server actually returned.
#
#   ./scripts/e2e-curl.sh                            # starts its own server
#   E2E_PORT=3001 ./scripts/e2e-curl.sh --no-serve   # use a running one
#
# The default address is a real mainnet wallet chosen because its bounded
# signature scan is DETERMINATE (87 signatures, the first one reached, so the
# confidence is "exact"). Wallets with more than PAGE_CAP*1000 signatures
# report historyMonths = null, which fails the history check closed and can
# never be eligible - that is the fail-closed design, not a bug.
# ---------------------------------------------------------------------------
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${E2E_PORT:-3011}"
BASE="http://localhost:${PORT}/api"
ADDRESS="${E2E_ADDRESS:-GYtUMZdNmU7M5m2oC4hxaaJdheDHVCmhz5BY3XitjARu}"
ENS_NAME="${E2E_ENS:-privatecredit.eth}"
W=".e2e"
SERVE=1
[ "${1:-}" = "--no-serve" ] && SERVE=0

mkdir -p "$W"
PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# Read one dotted path out of a JSON file. node, not jq: jq is not installed
# here, and adding a dependency to read a field would be silly.
j() { node -e '
  const [file, path] = process.argv.slice(1);
  let v = require("./" + file);
  for (const k of path.split(".")) v = v == null ? v : v[k];
  process.stdout.write(v === undefined || v === null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
' "$1" "$2"; }

# Does a JSON file contain this substring anywhere?
has() { node -e '
  const [file, needle] = process.argv.slice(1);
  process.exit(require("fs").readFileSync(file, "utf8").includes(needle) ? 0 : 1);
' "$1" "$2"; }

post() { curl -s -o "$2" -w '%{http_code}' -X POST "$BASE$1" -H 'content-type: application/json' --data-binary "@$3"; }

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    printf '\nstopping the server this script started (pid %s)\n' "$SERVER_PID"
    kill "$SERVER_PID" 2>/dev/null
    sleep 1
    kill -9 "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- 0. server
if [ "$SERVE" = "1" ]; then
  step "0. start the backend on :$PORT"
  PORT="$PORT" node backend/src/index.ts > "$W/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -sf "$BASE/health" -o /dev/null && break
    sleep 0.5
  done
  sed -n '1,8p' "$W/server.log"
fi

curl -s "$BASE/health" -o "$W/health.json"
VKEY_FULL="$(j "$W/health.json" verifier.verifyingKeySha256)"
VKEY_BROWSER="$(j "$W/health.json" verifier.browserVerifyingKeySha256)"
VKEY_SHORT="$(printf '%s' "$VKEY_FULL" | cut -c1-16)"
echo "  verifier ready      : $(j "$W/health.json" verifier.ready)"
echo "  circuit             : $(j "$W/health.json" verifier.circuit)"
echo "  backend vkey sha256 : $VKEY_FULL"
echo "  browser vkey sha256 : $VKEY_BROWSER"
echo "  artifacts agree     : $(j "$W/health.json" verifier.artifactsAgree)"
echo "  public signals      : $(j "$W/health.json" verifier.publicSignals)"
echo "  ceremony            : $(j "$W/health.json" verifier.ceremony)"
if [ "$(j "$W/health.json" verifier.ready)" = "true" ]; then ok "the server has a usable verifying key"; else bad "verifier not ready"; fi
if [ "$VKEY_FULL" = "$VKEY_BROWSER" ]; then ok "backend and browser verifying keys are the same file"; else bad "verifying keys differ"; fi

curl -s -X POST "$BASE/dev/reset" -o "$W/reset.json" >/dev/null

# -------------------------------------------------------------- 1. sessions
step "1. two sessions, two roles"
echo '{"role":"borrower"}' > "$W/b.req"
post /session "$W/borrower.json" "$W/b.req" >/dev/null
echo '{"role":"lender"}' > "$W/l.req"
post /session "$W/lender.json" "$W/l.req" >/dev/null
BSID="$(j "$W/borrower.json" sessionId)"
BLABEL="$(j "$W/borrower.json" label)"
LSID="$(j "$W/lender.json" sessionId)"
LLABEL="$(j "$W/lender.json" label)"
echo "  borrower $BLABEL  $BSID"
echo "  lender   $LLABEL  $LSID"
if [ -n "$BSID" ] && [ -n "$LSID" ]; then ok "both sessions issued"; else bad "session creation failed"; fi

# -------------------------------------------------- 2. real mainnet passport
step "2. borrower reads a REAL Solana mainnet passport"
# The unsigned read exists only when the backend runs with ALLOW_UNSIGNED_PASSPORT=1;
# the app itself uses POST /api/passport with a Phantom signature.
curl -s --max-time 180 "$BASE/passport/$ADDRESS" -o "$W/passport.json"
if grep -q '"unknown_endpoint"' "$W/passport.json"; then
  bad "GET /api/passport is disabled - restart the backend with ALLOW_UNSIGNED_PASSPORT=1 for this script"
fi
echo "  address    $ADDRESS"
echo "  witness    $(j "$W/passport.json" witness)"
echo "  history    $(j "$W/passport.json" provenance.history)"
if [ -n "$(j "$W/passport.json" witness.assets)" ]; then ok "passport read returned a witness"; else bad "passport read failed"; fi
if [ "$(j "$W/passport.json" provenance.history.confidence)" = "exact" ]; then
  ok "history is determinate, so an eligible verdict is reachable"
else
  bad "history is $(j "$W/passport.json" provenance.history.confidence) - eligible can never be 1"
fi

# ---------------------------------------------------- 3. publish the request
step "3. borrower publishes a request (commitment BEFORE any policy exists)"
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { passportCommitment, fieldToHex } from "./zk/protocol.mjs";
const [sid, ensName] = process.argv.slice(1);
const p = JSON.parse(readFileSync(".e2e/passport.json", "utf8"));
// Fresh per passport, never published. With the portfolio itself, these are
// the only secrets the applicant keeps.
const salt = "0x" + randomBytes(32).toString("hex");
const blindingFactor = "0x" + randomBytes(32).toString("hex");
writeFileSync(".e2e/secrets.json", JSON.stringify({ salt, blindingFactor }, null, 2));
writeFileSync(".e2e/request.req", JSON.stringify({
  sessionId: sid,
  amount: 5000, collateral: 8000, termDays: 90,
  passportCommitment: fieldToHex(passportCommitment(p.witness, salt)),
  provenance: p.provenance,
  ensName,
}, null, 2));
' "$BSID" "$ENS_NAME"
CODE="$(post /requests "$W/request.json" "$W/request.req")"
REQ_ID="$(j "$W/request.json" id)"
echo "  http $CODE  request $REQ_ID"
echo "  commitment $(j "$W/request.json" passportCommitment)"
if [ "$CODE" = "201" ]; then ok "request published"; else bad "publish failed: $(cat "$W/request.json")"; fi

# ---------------------------------------------------- 4. the lender's policy
# `minimumAssets: 25` sits BELOW the cheapest tier the lender UI offers ($100),
# deliberately. This wallet holds a fraction of a SOL, so its USD value moves
# with the SOL price between runs; pinning the threshold under it keeps the run
# deterministic instead of green on Tuesday and red on Wednesday. The store
# accepts any threshold from 0 upward, so this is a real policy, just not one
# the dropdown offers. POLICY_OPTIONS is what the UI restricts a human to.
step "4. lender issues policy A - one this real portfolio satisfies"
node --input-type=module -e '
import { writeFileSync } from "node:fs";
const [sid, requestId] = process.argv.slice(1);
writeFileSync(".e2e/challengeA.req", JSON.stringify({
  sessionId: sid, requestId, validityMinutes: 30,
  policy: { minimumAssets: 25, minimumCollateralQuality: 0, minimumHistoryMonths: 12, screenRestrictedExposure: true },
}, null, 2));
' "$LSID" "$REQ_ID"
CODE="$(post /challenges "$W/challengeA.json" "$W/challengeA.req")"
CH_A="$(j "$W/challengeA.json" id)"
echo "  http $CODE  challenge $CH_A"
echo "  policyHash          $(j "$W/challengeA.json" policyHash)"
echo "  verifierCommitment  $(j "$W/challengeA.json" verifierCommitment)"
if [ "$CODE" = "201" ]; then ok "challenge A created, both hashes computed server-side"; else bad "challenge A failed"; fi

printf '%s' '{"sessionId":"x","requestId":"y","policyHash":"0x01","policy":{"minimumAssets":1,"minimumCollateralQuality":1,"minimumHistoryMonths":1,"screenRestrictedExposure":false}}' > "$W/badch.req"
CODE="$(post /challenges "$W/badch.json" "$W/badch.req")"
if [ "$CODE" = "400" ]; then ok "a client-supplied policyHash is refused ($(j "$W/badch.json" error))"; else bad "client policyHash accepted, http $CODE"; fi

# --------------------------------------------------------- 5. the real proof
step "5. borrower proves policy A with the real circuit"
node scripts/e2e-build-input.mjs \
  --witness "$W/passport.json" --challenge "$W/challengeA.json" \
  --salt "$(j "$W/secrets.json" salt)" --blinding "$(j "$W/secrets.json" blindingFactor)" \
  --subject "$ENS_NAME" \
  --out-input "$W/inputA.json" --out-body "$W/bodyA.json" | sed 's/^/  /'
node zk/prove.mjs --input "$W/inputA.json" 2>&1 | sed -n '/^prove:/,/^eligible:/p' | sed 's/^/  /'
cp zk/build/proof.json "$W/proofA.json"
cp zk/build/public.json "$W/publicA.json"

if node --input-type=module -e '
import { readFileSync } from "node:fs";
const emitted = JSON.parse(readFileSync(".e2e/publicA.json", "utf8")).map(String);
const expected = JSON.parse(readFileSync(".e2e/bodyA.json", "utf8")).expectedPublicSignals;
const wrong = expected.map((v, i) => (emitted[i] === v ? null : i)).filter((i) => i !== null);
if (wrong.length) { console.error("  signal mismatch at " + wrong.join(", ")); process.exit(1); }
'; then ok "the 7 emitted signals equal the values poseidon-lite derived"; else bad "emitted signals diverge from the mirror"; fi

mkproof() { node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const [sid, requestId, challengeId, bodyFile, proofFile, publicFile, out, tamper] = process.argv.slice(1);
const body = JSON.parse(readFileSync(bodyFile, "utf8"));
const proof = JSON.parse(readFileSync(proofFile, "utf8"));
const publicSignals = JSON.parse(readFileSync(publicFile, "utf8")).map(String);
const signals = { ...body.publicSignals };
if (tamper === "eligible") {
  // Flip the bit in BOTH the ordered array and the named object, so the layout
  // check still agrees and the only thing left to catch it is the pairing.
  signals.eligible = !signals.eligible;
  publicSignals[1] = signals.eligible ? "1" : "0";
}
writeFileSync(out, JSON.stringify({
  sessionId: sid, requestId, challengeId,
  proofSystem: "groth16-bn254",
  publicSignals: signals,
  results: body.results,
  proof: JSON.stringify({ proof, publicSignals }),
}, null, 2));
' "$@"; }

mkproof "$BSID" "$REQ_ID" "$CH_A" "$W/bodyA.json" "$W/proofA.json" "$W/publicA.json" "$W/submitA.req" none
CODE="$(post /proofs "$W/proofsubA.json" "$W/submitA.req")"
PROOF_A="$(j "$W/proofsubA.json" id)"
echo "  http $CODE  proof $PROOF_A  payload $(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(".e2e/submitA.req","utf8")).proof.length))') chars of proof JSON"
if [ "$CODE" = "201" ]; then ok "the receipt was accepted"; else bad "submit failed: $(cat "$W/proofsubA.json")"; fi

# ----------------------------------------------------------- 6. verification
step "6. lender verifies - the checklist"
printf '{"sessionId":"%s"}' "$LSID" > "$W/verify.req"
printf '{"sessionId":"%s"}' "$BSID" > "$W/bverify.req"
post "/proofs/$PROOF_A/verify" "$W/verifyA.json" "$W/verify.req" >/dev/null
node -e '
  const p = require("./.e2e/verifyA.json");
  console.log("  status " + p.verification.status);
  for (const c of p.verification.checks) {
    console.log("    " + (c.passed ? "[32mPASS[0m" : "[31mFAIL[0m") + "  " +
      c.name.padEnd(29) + c.detail.slice(0, 116));
  }
  console.log("  reason: " + p.verification.reason.slice(0, 260));
'
if [ "$(j "$W/verifyA.json" verification.status)" = "verified" ]; then ok "status verified"; else bad "status $(j "$W/verifyA.json" verification.status)"; fi
if has "$W/verifyA.json" '"name":"groth16_verified","passed":true'; then ok "groth16_verified passed"; else bad "groth16_verified did not pass"; fi
if has "$W/verifyA.json" "sha256:$VKEY_SHORT"; then ok "the checklist names verifying key sha256:$VKEY_SHORT"; else bad "vkey hash absent from the checklist"; fi
if has "$W/verifyA.json" '"name":"nullifier_unused","passed":true'; then ok "the nullifier was claimed"; else bad "nullifier not claimed"; fi

# -------------------------------------------------------- 7. tampered signal
step "7. a tampered public signal is REJECTED"
mkproof "$BSID" "$REQ_ID" "$CH_A" "$W/bodyA.json" "$W/proofA.json" "$W/publicA.json" "$W/submitT.req" eligible
post /proofs "$W/proofsubT.json" "$W/submitT.req" >/dev/null
PROOF_T="$(j "$W/proofsubT.json" id)"
post "/proofs/$PROOF_T/verify" "$W/verifyT.json" "$W/verify.req" >/dev/null
echo "  status $(j "$W/verifyT.json" verification.status)"
node -e 'const p=require("./.e2e/verifyT.json");for(const c of p.verification.checks) if(["public_signal_layout","groth16_verified","nullifier_unused"].includes(c.name)) console.log("    "+(c.passed?"PASS":"FAIL")+"  "+c.name.padEnd(22)+c.detail.slice(0,150));'
if [ "$(j "$W/verifyT.json" verification.status)" = "rejected" ]; then ok "tampered receipt rejected"; else bad "tampered receipt was $(j "$W/verifyT.json" verification.status)"; fi
if has "$W/verifyT.json" '"name":"groth16_verified","passed":false'; then ok "the pairing check is what caught it"; else bad "groth16_verified did not fail"; fi
if has "$W/verifyT.json" 'Not performed: an earlier binding failed'; then ok "a rejected receipt did NOT burn a nullifier"; else bad "nullifier was claimed on a rejected receipt"; fi

# ---------------------------------------------------- 8. wrong-policy replay
step "8. a proof bound to a different policy is REJECTED"
node --input-type=module -e '
import { writeFileSync } from "node:fs";
const [sid, requestId] = process.argv.slice(1);
writeFileSync(".e2e/challengeB.req", JSON.stringify({
  sessionId: sid, requestId, validityMinutes: 30,
  policy: { minimumAssets: 250000, minimumCollateralQuality: 90, minimumHistoryMonths: 18, screenRestrictedExposure: true },
}, null, 2));
' "$LSID" "$REQ_ID"
post /challenges "$W/challengeB.json" "$W/challengeB.req" >/dev/null
CH_B="$(j "$W/challengeB.json" id)"
echo "  challenge B $CH_B"
echo "  policyHash  $(j "$W/challengeB.json" policyHash)"
mkproof "$BSID" "$REQ_ID" "$CH_B" "$W/bodyA.json" "$W/proofA.json" "$W/publicA.json" "$W/submitX.req" none
post /proofs "$W/proofsubX.json" "$W/submitX.req" >/dev/null
PROOF_X="$(j "$W/proofsubX.json" id)"
post "/proofs/$PROOF_X/verify" "$W/verifyX.json" "$W/verify.req" >/dev/null
echo "  status $(j "$W/verifyX.json" verification.status)"
node -e 'const p=require("./.e2e/verifyX.json");for(const c of p.verification.checks) if(c.name==="policy_hash_matches"||c.name==="nullifier_unused") console.log("    "+(c.passed?"PASS":"FAIL")+"  "+c.name.padEnd(30)+c.detail.slice(0,180));'
if [ "$(j "$W/verifyX.json" verification.status)" = "rejected" ]; then ok "policy A's proof presented against policy B is rejected"; else bad "cross-policy proof was accepted"; fi
if has "$W/verifyX.json" '"name":"policy_hash_matches","passed":false'; then ok "policy_hash_matches is the check that caught it"; else bad "a different check caught it"; fi

# ----------------------------------------------- 9. a sound but ineligible NO
step "9. a valid eligible=0 proof VERIFIES, and the lender cannot fund it"
post /challenges "$W/challengeC.json" "$W/challengeB.req" >/dev/null
CH_C="$(j "$W/challengeC.json" id)"
node scripts/e2e-build-input.mjs \
  --witness "$W/passport.json" --challenge "$W/challengeC.json" \
  --salt "$(j "$W/secrets.json" salt)" --blinding "$(j "$W/secrets.json" blindingFactor)" \
  --subject "$ENS_NAME" \
  --out-input "$W/inputC.json" --out-body "$W/bodyC.json" | sed 's/^/  /'
node zk/prove.mjs --input "$W/inputC.json" 2>&1 | sed -n '/^prove:/,/^eligible:/p' | sed 's/^/  /'
cp zk/build/proof.json "$W/proofC.json"
cp zk/build/public.json "$W/publicC.json"
mkproof "$BSID" "$REQ_ID" "$CH_C" "$W/bodyC.json" "$W/proofC.json" "$W/publicC.json" "$W/submitC.req" none
post /proofs "$W/proofsubC.json" "$W/submitC.req" >/dev/null
PROOF_C="$(j "$W/proofsubC.json" id)"
post "/proofs/$PROOF_C/verify" "$W/verifyC.json" "$W/verify.req" >/dev/null
echo "  status   $(j "$W/verifyC.json" verification.status)"
echo "  eligible $(j "$W/verifyC.json" publicSignals.eligible)"
echo "  reason   $(j "$W/verifyC.json" verification.reason)"
if [ "$(j "$W/verifyC.json" verification.status)" = "verified" ]; then ok "the receipt is SOUND"; else bad "an honest ineligible receipt was rejected"; fi
if [ "$(j "$W/verifyC.json" publicSignals.eligible)" = "false" ]; then ok "and reports eligible = false"; else bad "eligible flag wrong"; fi
if has "$W/verifyC.json" '"name":"groth16_verified","passed":true'; then ok "the pairing check passed on the ineligible proof too"; else bad "groth16 failed on a valid ineligible proof"; fi
printf '{"sessionId":"%s","requestId":"%s","proofId":"%s","apr":9.5,"fee":120,"deposit":5000}' "$LSID" "$REQ_ID" "$PROOF_C" > "$W/offerC.req"
CODE="$(post /offers "$W/offerC.json" "$W/offerC.req")"
echo "  POST /offers -> http $CODE  $(j "$W/offerC.json" error)"
if [ "$CODE" = "409" ]; then ok "capital cannot move against an ineligible receipt"; else bad "an offer was created against eligible=false (http $CODE)"; fi

# ------------------------------------------------------------ 10. the replay
step "10. replaying the same nullifier is REJECTED, naming the earlier proof"
mkproof "$BSID" "$REQ_ID" "$CH_A" "$W/bodyA.json" "$W/proofA.json" "$W/publicA.json" "$W/submitR.req" none
post /proofs "$W/proofsubR.json" "$W/submitR.req" >/dev/null
PROOF_R="$(j "$W/proofsubR.json" id)"
post "/proofs/$PROOF_R/verify" "$W/verifyR.json" "$W/verify.req" >/dev/null
echo "  status $(j "$W/verifyR.json" verification.status)"
node -e 'const p=require("./.e2e/verifyR.json");for(const c of p.verification.checks) if(c.name==="groth16_verified"||c.name==="nullifier_unused") console.log("    "+(c.passed?"PASS":"FAIL")+"  "+c.name.padEnd(20)+c.detail.slice(0,175));'
if [ "$(j "$W/verifyR.json" verification.status)" = "rejected" ]; then ok "the replay is rejected"; else bad "a replayed nullifier verified"; fi
if has "$W/verifyR.json" "already claimed by proof $PROOF_A"; then ok "and the message names the earlier proof $PROOF_A"; else bad "the replay message does not name the earlier proof"; fi

# ---------------------------------------------------- 11. policy-eval-v0 gone
step "11. policy-eval-v0 is refused"
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const [sid, requestId, challengeId] = process.argv.slice(1);
const body = JSON.parse(readFileSync(".e2e/bodyA.json", "utf8"));
writeFileSync(".e2e/submitLegacy.req", JSON.stringify({
  sessionId: sid, requestId, challengeId,
  proofSystem: "policy-eval-v0",
  publicSignals: body.publicSignals, results: body.results, proof: null,
}, null, 2));
' "$BSID" "$REQ_ID" "$CH_A"
CODE="$(post /proofs "$W/legacy.json" "$W/submitLegacy.req")"
echo "  http $CODE  $(j "$W/legacy.json" error)"
echo "  detail: $(j "$W/legacy.json" detail)"
if [ "$CODE" = "400" ]; then ok "policy-eval-v0 is refused at the door"; else bad "policy-eval-v0 accepted (http $CODE)"; fi
if has "$W/legacy.json" "$VKEY_SHORT"; then ok "the refusal names the loaded verifying key"; else bad "refusal does not name the vkey"; fi

# ------------------------------------------------- 12. the happy path, funded
step "12. the eligible receipt funds an offer and the loan runs to repaid"
printf '{"sessionId":"%s","requestId":"%s","proofId":"%s","apr":9.5,"fee":120,"deposit":5000,"note":"e2e"}' "$LSID" "$REQ_ID" "$PROOF_A" > "$W/offerA.req"
CODE="$(post /offers "$W/offerA.json" "$W/offerA.req")"
OFFER_A="$(j "$W/offerA.json" id)"
echo "  POST /offers -> http $CODE  offer $OFFER_A"
if [ "$CODE" = "201" ]; then ok "an offer was funded against the verified, eligible receipt"; else bad "offer failed: $(cat "$W/offerA.json")"; fi
CODE="$(post "/offers/$OFFER_A/accept" "$W/acceptA.json" "$W/bverify.req")"
LOAN_ID="$(j "$W/acceptA.json" loan.id)"
echo "  POST /offers/:id/accept -> http $CODE  loan $LOAN_ID  status $(j "$W/acceptA.json" loan.status)"
CODE="$(post "/loans/$LOAN_ID/draw" "$W/loan-draw.json" "$W/bverify.req")"
echo "  POST /loans/:id/draw  -> http $CODE  status $(j "$W/loan-draw.json" status)"
CODE="$(post "/loans/$LOAN_ID/due" "$W/loan-due.json" "$W/verify.req")"
echo "  POST /loans/:id/due   -> http $CODE  status $(j "$W/loan-due.json" status)"
CODE="$(post "/loans/$LOAN_ID/repay" "$W/loan-repay.json" "$W/bverify.req")"
echo "  POST /loans/:id/repay -> http $CODE  status $(j "$W/loan-repay.json" status)"
if [ "$(j "$W/loan-repay.json" status)" = "repaid" ]; then ok "the loan reached repaid"; else bad "loan lifecycle stalled at $(j "$W/loan-repay.json" status)"; fi

# --------------------------------------------------- 13. the trust boundary
step "13. the lender's projection carries no portfolio value"
curl -s "$BASE/state?role=lender&sessionId=$LSID&since=0" -o "$W/stateL.json"
LEAK=0
for token in collateralQuality historyMonths restrictedExposure holdings passportSalt blindingFactor usdValue priceUsd DEMO_WITNESS viewingPrivateKey; do
  if has "$W/stateL.json" "$token"; then echo "    LEAK: $token"; LEAK=1; fi
done
if [ "$LEAK" = "0" ]; then ok "no witness field name appears in GET /state for a lender"; else bad "the lender projection leaks a witness field name"; fi
printf '{"sessionId":"%s","requestId":"%s","challengeId":"%s","proofSystem":"groth16-bn254","publicSignals":{},"results":[],"collateralQuality":71}' "$BSID" "$REQ_ID" "$CH_A" > "$W/witnessy.req"
CODE="$(post /proofs "$W/witnessy.json" "$W/witnessy.req")"
echo "  POST /proofs carrying collateralQuality -> http $CODE  $(j "$W/witnessy.json" error)"
if [ "$CODE" = "400" ]; then ok "a witness-shaped key is refused by name"; else bad "a witness field was accepted (http $CODE)"; fi

# ------------------------------------------------------------------ summary
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
