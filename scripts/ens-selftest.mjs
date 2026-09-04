/**
 * Self-test for the ENS -> rotating Solana payout derivation.
 *
 *   node scripts/ens-selftest.mjs
 *
 * No network, no keys, no chain. This proves the cryptography round-trips:
 * three successive draws against ONE identity land on three DIFFERENT Solana
 * addresses; the borrower recovers a spending key for each; an unrelated
 * viewer cannot; and a wrong requestId derives a different address.
 *
 * Modelled on the round-trip shape in `prototype/ens/stealth.mjs`, but that
 * script is the secp256k1 / ERC-5564 variant that derives an ETHEREUM address.
 * This is the X25519 -> ed25519 -> Solana variant the protocol actually uses.
 *
 * It imports the SHIPPING module (`frontend/src/shared/ensPayout.ts`) directly
 * via Node's native type stripping, so there is no second implementation that
 * could pass while the real one is broken. It also imports the backend's
 * `base58Decode` to cross-check the encoder against a decoder written
 * independently, in another workspace, for another purpose.
 */

import { x25519 } from "@noble/curves/ed25519.js";

import {
  PAYOUT_KEY_SIGN_MESSAGE,
  PAYOUT_RECORD_KEY,
  base58Encode,
  bytesToHex0x,
  decodePayoutRecord,
  derivePayoutAddress,
  deriveViewingKeypair,
  encodePayoutRecord,
  payoutViewTag,
  recoverPayoutKeypair,
  solanaAddressFromSecretKey,
} from "../frontend/src/shared/ensPayout.ts";
import { base58Decode } from "../backend/src/adapters/solanaRpc.ts";

/* ------------------------------------------------------------- harness */

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed: Boolean(passed), detail });
  if (!passed) failures += 1;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Deterministic stand-in for a real `personal_sign` output (65 bytes). */
function fakeSignature(seedByte) {
  const bytes = new Uint8Array(65);
  for (let i = 0; i < 65; i += 1) bytes[i] = (seedByte * 131 + i * 17 + 7) & 0xff;
  bytes[64] = 27;
  return bytesToHex0x(bytes);
}

/** Deterministic 32-byte ephemeral scalar, so the whole run is reproducible. */
function fixedEphemeral(index) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = (index * 61 + i * 29 + 3) & 0xff;
  return bytes;
}

/* ------------------------------------------------------------- base58 */

{
  const zeros = new Uint8Array(32);
  check(
    "base58Encode(32 zero bytes) === the Solana system program id form",
    base58Encode(zeros) === "1".repeat(32),
    base58Encode(zeros),
  );

  // Cross-check against the backend's independently written decoder.
  let roundTrips = 0;
  for (let i = 0; i < 256; i += 1) {
    const bytes = new Uint8Array(32);
    for (let j = 0; j < 32; j += 1) bytes[j] = (i * 251 + j * 37) & 0xff;
    const decoded = base58Decode(base58Encode(bytes));
    if (decoded && bytesEqual(decoded, bytes)) roundTrips += 1;
  }
  check(
    "base58Encode round-trips through backend base58Decode (256 vectors)",
    roundTrips === 256,
    `${roundTrips}/256`,
  );
}

/* ------------------------------------------------------------- borrower */

const borrowerSignature = fakeSignature(1);
const borrower = deriveViewingKeypair(borrowerSignature);
const borrowerAgain = deriveViewingKeypair(borrowerSignature);

check(
  "viewing key is deterministic from the signature (re-derivable on any device)",
  bytesEqual(borrower.privateKey, borrowerAgain.privateKey) &&
    bytesEqual(borrower.publicKey, borrowerAgain.publicKey),
);
check(
  "viewing scalar is clamped per RFC 7748 section 5",
  (borrower.privateKey[0] & 0b111) === 0 &&
    (borrower.privateKey[31] & 0b1000_0000) === 0 &&
    (borrower.privateKey[31] & 0b0100_0000) !== 0,
  bytesToHex0x(borrower.privateKey.slice(0, 1)) + " .. " + bytesToHex0x(borrower.privateKey.slice(31)),
);
check(
  "a short signature is rejected rather than stretched into a key",
  (() => {
    try {
      deriveViewingKeypair("0xdeadbeef");
      return false;
    } catch {
      return true;
    }
  })(),
);

const record = encodePayoutRecord(borrower.publicKey);
const decoded = decodePayoutRecord(record);
check(
  "ENS text record encodes and decodes back to the same X25519 key",
  Boolean(decoded.publicKey) && bytesEqual(decoded.publicKey, borrower.publicKey),
);
check(
  "an empty record decodes to an explanatory error, not a key",
  Boolean(decodePayoutRecord("").error),
  decodePayoutRecord("").error,
);
check(
  "an ERC-5564 stealth-meta-address is REJECTED (wrong curve, not our format)",
  Boolean(decodePayoutRecord("st:eth:0x" + "02".repeat(66)).error),
);
check(
  "a truncated payout key is rejected",
  Boolean(decodePayoutRecord("pcv1:sol:x25519:0x" + "ab".repeat(31)).error),
  decodePayoutRecord("pcv1:sol:x25519:0x" + "ab".repeat(31)).error,
);

/* ------------------------------------------------------------- draws */

const REQUEST_IDS = ["req_9f21ac#draw-1", "req_9f21ac#draw-2", "req_9f21ac#draw-3"];
const draws = [];

for (let i = 0; i < REQUEST_IDS.length; i += 1) {
  const requestId = REQUEST_IDS[i];
  const announcement = derivePayoutAddress({
    recipientPublicKey: decoded.publicKey,
    requestId,
    ephemeralPrivateKey: fixedEphemeral(i + 1),
  });
  const recovered = recoverPayoutKeypair({
    viewingPrivateKey: borrower.privateKey,
    ephemeralPublicKey: announcement.ephemeralPublicKey,
    requestId,
    viewTag: announcement.viewTag,
  });
  draws.push({ requestId, announcement, recovered });
}

check(
  "three successive draws produce three DIFFERENT Solana addresses",
  new Set(draws.map((d) => d.announcement.solanaAddress)).size === 3,
);
check(
  "every announced address is a valid 32-byte base58 Solana address",
  draws.every((d) => {
    const bytes = base58Decode(d.announcement.solanaAddress);
    return bytes !== null && bytes.length === 32;
  }),
);
check(
  "the borrower recovers all three (view tag matched)",
  draws.every((d) => d.recovered !== null),
);
check(
  "each recovered address equals the announced address",
  draws.every((d) => d.recovered && d.recovered.solanaAddress === d.announcement.solanaAddress),
);
check(
  "each recovered 64-byte secret key really controls that address",
  draws.every(
    (d) => d.recovered && solanaAddressFromSecretKey(d.recovered.secretKey) === d.announcement.solanaAddress,
  ),
);

// Two draws under the SAME requestId, differing only in the ephemeral scalar,
// must still be unlinkable. This is the property that matters when one loan
// request is drawn against more than once.
{
  const a = derivePayoutAddress({
    recipientPublicKey: decoded.publicKey,
    requestId: "req_same",
    ephemeralPrivateKey: fixedEphemeral(41),
  });
  const b = derivePayoutAddress({
    recipientPublicKey: decoded.publicKey,
    requestId: "req_same",
    ephemeralPrivateKey: fixedEphemeral(42),
  });
  check(
    "same requestId + different ephemeral key still gives different addresses",
    a.solanaAddress !== b.solanaAddress,
  );
}

/* ------------------------------------------------------------- negatives */

const target = draws[0];

// An unrelated viewer: a different wallet, hence a different viewing key.
const stranger = deriveViewingKeypair(fakeSignature(99));
const strangerSecret = x25519.getSharedSecret(
  stranger.privateKey,
  target.announcement.ephemeralPublicKey,
);
const strangerTag = payoutViewTag(strangerSecret);
const strangerRecovery = recoverPayoutKeypair({
  viewingPrivateKey: stranger.privateKey,
  ephemeralPublicKey: target.announcement.ephemeralPublicKey,
  requestId: target.requestId,
  viewTag: target.announcement.viewTag,
});
check(
  "an unrelated viewer's view tag does not match",
  strangerTag !== target.announcement.viewTag,
  `stranger tag 0x${strangerTag.toString(16).padStart(2, "0")} vs announced 0x${target.announcement.viewTag
    .toString(16)
    .padStart(2, "0")}`,
);
check("an unrelated viewer recovers nothing (null)", strangerRecovery === null);

// Even ignoring the view-tag filter entirely, a stranger derives a different
// address - the filter is an optimisation, not the security boundary.
{
  const forced = recoverPayoutKeypair({
    viewingPrivateKey: stranger.privateKey,
    ephemeralPublicKey: target.announcement.ephemeralPublicKey,
    requestId: target.requestId,
  });
  check(
    "even with the view-tag filter disabled, a stranger derives a different address",
    forced !== null && forced.solanaAddress !== target.announcement.solanaAddress,
  );
}

// The view tag is a 1-byte filter: about 1 in 256 unrelated announcements
// survive it. Measured, not asserted from theory.
{
  let survivors = 0;
  const trials = 512;
  for (let i = 0; i < trials; i += 1) {
    const other = derivePayoutAddress({
      recipientPublicKey: deriveViewingKeypair(fakeSignature(1000 + i)).publicKey,
      requestId: "req_scan",
      ephemeralPrivateKey: fixedEphemeral(200 + i),
    });
    const hit = recoverPayoutKeypair({
      viewingPrivateKey: borrower.privateKey,
      ephemeralPublicKey: other.ephemeralPublicKey,
      requestId: "req_scan",
      viewTag: other.viewTag,
    });
    if (hit !== null) survivors += 1;
  }
  check(
    "view tag discards ~255/256 of foreign announcements while scanning",
    survivors <= trials / 32,
    `${survivors}/${trials} survived (expected ~${(trials / 256).toFixed(1)})`,
  );
}

// Wrong requestId: the shared secret still matches, so the view tag still
// matches, but the HKDF salt differs and the derived address is unrelated.
{
  const wrong = recoverPayoutKeypair({
    viewingPrivateKey: borrower.privateKey,
    ephemeralPublicKey: target.announcement.ephemeralPublicKey,
    requestId: "req_9f21ac#draw-WRONG",
    viewTag: target.announcement.viewTag,
  });
  check(
    "a wrong requestId does not recover the announced address",
    wrong !== null && wrong.solanaAddress !== target.announcement.solanaAddress,
    wrong ? wrong.solanaAddress : "null",
  );
}

/* ------------------------------------------------------------- output */

const line = "-".repeat(78);
console.log(line);
console.log("ENS -> rotating Solana payout derivation - self-test");
console.log(line);
console.log(`text record key   : ${PAYOUT_RECORD_KEY}`);
console.log(`sign message      : ${PAYOUT_KEY_SIGN_MESSAGE.split("\n")[0]}`);
console.log(`borrower X25519   : ${bytesToHex0x(borrower.publicKey)}`);
console.log(`text record value : ${record}`);
console.log();
console.log("Three successive draws to the SAME identity:");
for (let i = 0; i < draws.length; i += 1) {
  const d = draws[i];
  const tag = `0x${d.announcement.viewTag.toString(16).padStart(2, "0")}`;
  console.log(`  draw ${i + 1}  ${d.requestId}`);
  console.log(`    solana payout   ${d.announcement.solanaAddress}`);
  console.log(`    ephemeral R     ${bytesToHex0x(d.announcement.ephemeralPublicKey)}`);
  console.log(`    view tag        ${tag}`);
  console.log(
    `    borrower scan   ${d.recovered ? "FOUND" : "MISS"}   spendable: ${
      d.recovered && solanaAddressFromSecretKey(d.recovered.secretKey) === d.announcement.solanaAddress
        ? "YES"
        : "NO"
    }`,
  );
}
console.log();
console.log(line);
for (const r of results) {
  const status = r.passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${r.name}${r.detail ? `\n         ${r.detail}` : ""}`);
}
console.log(line);
console.log(
  `${results.length - failures}/${results.length} checks passed - ${failures === 0 ? "PASS" : "FAIL"}`,
);
console.log(line);
console.log(
  "Honest limitation: the payout key is derived from a single ECDH secret, so\n" +
    "whoever can scan can also spend. Unlinkability is unaffected; key\n" +
    "compartmentalisation is lost versus full ERC-5564. This is not an ENSIP\n" +
    "implementation - the pending stealth-address ENSIP scopes non-EVM out.",
);

process.exit(failures === 0 ? 0 : 1);
