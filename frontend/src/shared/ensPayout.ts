/**
 * ENS -> rotating Solana payout address derivation.
 *
 * This is the mechanism that makes ENS load-bearing rather than decorative:
 * the lender **cannot pay the borrower** without first resolving the borrower's
 * ENS name to an X25519 public key and deriving a fresh, unlinkable *Solana*
 * address from it. Remove ENS and the settlement leg stops working.
 *
 * -- The protocol (BACKEND_PLAN.md 3.1) -----------------------------------
 *
 *   1. Borrower, once. Derive an X25519 keypair deterministically from a
 *      `personal_sign` over a fixed message, and publish the PUBLIC key as an
 *      ENS text record under `privatecredit.payout-key[501]` (501 = SLIP-44
 *      Solana). Nothing is stored: the key is re-derivable on any device from
 *      the same wallet.
 *   2. Lender, per draw. Resolve the name -> `X`. Pick an ephemeral `r`,
 *      compute `R = r*G` and `ss = X25519(r, X)`, then
 *        seed   = HKDF-SHA256(ss, salt = requestId, info = "privatecredit/v1/sol-payout")
 *        payout = ed25519 Keypair.fromSeed(seed).publicKey
 *      which is an ordinary Solana address that any wallet can receive at.
 *   3. The lender publishes `R` (32 B) and a 1-byte view tag with the draw.
 *   4. Borrower recomputes `ss = X25519(x, R)`, obtains the SAME keypair and
 *      can sweep the funds.
 *
 * -- Standards cited, and NOT claimed -------------------------------------
 *
 *   - RFC 7748 - Elliptic Curves for Security (X25519, and the scalar
 *     clamping in section 5 that `deriveViewingKeypair` applies).
 *   - RFC 5869 - HMAC-based Extract-and-Expand Key Derivation Function
 *     (HKDF). Salt and info are used exactly as that RFC intends: the salt
 *     separates draws, the info separates purposes.
 *   - RFC 8032 - Ed25519, whose "seed -> keypair" construction is what
 *     Solana's `Keypair.fromSeed` implements.
 *
 *   We do **not** claim ENSIP compliance. The pending stealth-address ENSIP
 *   states plainly that non-EVM scoping "would be an ERC-5564 extension and is
 *   out of scope here", so this is presented as an early implementation of a
 *   direction ENS is standardising - not as an implementation of a standard.
 *   For the same reason the record deliberately does NOT reuse ERC-5564
 *   `schemeId 1`, which is registered for secp256k1 and would be a false claim
 *   about the curve carried in the payload. The record key and value format
 *   below are self-describing and unmistakably ours.
 *
 * -- The honest weakness, stated up front ---------------------------------
 *
 *   Full ERC-5564 stealth addresses use two keys: a spending key and a viewing
 *   key, so a third party can be given scanning ability without spending
 *   ability. We derive the entire one-time key from a single ECDH secret,
 *   which sidesteps ed25519 scalar arithmetic (standard Solana `Keypair` APIs
 *   will not do scalar addition for you) at a real cost: **whoever can scan
 *   can also spend.** Unlinkability is unaffected - an observer without `x`
 *   still cannot connect two draws to one identity, or either to the ENS name.
 *   What is lost is key compartmentalisation. This must be surfaced in the UI,
 *   not just in this comment.
 *
 * Pure and isomorphic: no network, no DOM, no `window`. Anything that touches
 * an RPC lives in `ensClient.ts`.
 */

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

/* ------------------------------------------------------------- constants */

/**
 * The ENS text-record key. Deliberately namespaced to this protocol and
 * annotated with the SLIP-44 coin type it pays out on, so a reader who has
 * never seen this project can tell from the key alone that the value is a
 * Solana-targeting key and not an ENS-standard one.
 *
 * The ENS manager app will NOT display a custom key like this, so the only
 * honest evidence that the record exists is a direct `text(node, key)` call
 * against the resolver - which is exactly what `ensClient.readPayoutRecord`
 * does and what the UI must show.
 */
export const PAYOUT_RECORD_KEY = "privatecredit.payout-key[501]";

/**
 * Value prefix: `pcv1` = Private Credit, record format v1; `sol` = the chain
 * the derived address lives on; `x25519` = the curve of the key that follows.
 * Self-describing on purpose - a future v2 changes the prefix rather than
 * silently reinterpreting the same bytes.
 */
export const PAYOUT_RECORD_PREFIX = "pcv1:sol:x25519:";

/**
 * The message the borrower signs with `personal_sign`. It must never change:
 * change it and every previously published payout key becomes unrecoverable.
 * It says what it authorises, because a wallet signature prompt the user
 * cannot read is a phishing lesson waiting to happen.
 */
export const PAYOUT_KEY_SIGN_MESSAGE = [
  "Private Credit - payout key derivation (v1)",
  "",
  "Signing this message derives the X25519 viewing key that lenders use to",
  "compute a fresh Solana payout address for each draw against your ENS name.",
  "",
  "It authorises no transaction, moves no funds, and grants no allowance.",
].join("\n");

/** HKDF domain separators. Distinct info strings imply independent outputs. */
const HKDF_SALT_VIEWING_KEY = utf8ToBytes("privatecredit/v1/ens-payout");
const HKDF_INFO_VIEWING_KEY = utf8ToBytes("privatecredit/v1/x25519-viewing-key");
const HKDF_INFO_PAYOUT_SEED = utf8ToBytes("privatecredit/v1/sol-payout");
const HKDF_INFO_VIEW_TAG = utf8ToBytes("privatecredit/v1/sol-payout-view-tag");

/**
 * The view tag is derived with an info string of its own so that publishing it
 * leaks nothing about the payout seed: they are two independent HKDF expansions
 * of the same shared secret, not a prefix of one another.
 */
const HKDF_SALT_VIEW_TAG = utf8ToBytes("privatecredit/v1/view-tag");

/* ------------------------------------------------------------- base58 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode bytes as base58 (Bitcoin alphabet) - i.e. produce a Solana address
 * from a 32-byte ed25519 public key.
 *
 * The matching DECODER already exists at `backend/src/adapters/solanaRpc.ts`
 * (`base58Decode`, used to validate `GET /api/passport/:address`). It is not
 * duplicated here: the two workspaces cannot import each other's source, and
 * this module needs only the encode direction, which the backend does not
 * have. `scripts/ens-selftest.mjs` imports BOTH and asserts they round-trip,
 * so the two halves are cross-checked rather than merely coexisting.
 */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  // Every leading zero byte is one leading '1'.
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) out += "1";
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]!];
  return out;
}

/* ------------------------------------------------------------- hex */

/**
 * Strict hex -> bytes. `@noble/hashes`' own `hexToBytes` rejects a `0x` prefix
 * with a message about "non-hex characters", which is a confusing thing to
 * show a user who pasted a perfectly ordinary Ethereum-style hex string. This
 * accepts the prefix, rejects everything else, and says why.
 */
export function hexToBytesStrict(value: string, label: string): Uint8Array {
  const body = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (body.length === 0) throw new Error(`${label}: empty hex string`);
  if (body.length % 2 !== 0) {
    throw new Error(`${label}: odd-length hex string (${body.length} chars)`);
  }
  if (!/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(`${label}: contains non-hex characters`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Bytes -> lowercase `0x`-prefixed hex. */
export function bytesToHex0x(bytes: Uint8Array): string {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/* ------------------------------------------------------------- types */

export interface ViewingKeypair {
  /** 32-byte X25519 scalar, clamped per RFC 7748 section 5. Never leaves the device. */
  privateKey: Uint8Array;
  /** 32-byte X25519 public key. This is what goes into the ENS text record. */
  publicKey: Uint8Array;
}

export interface PayoutAnnouncement {
  /** Base58 Solana address the lender must disburse to. */
  solanaAddress: string;
  /** 32-byte ephemeral X25519 public key `R`, published with the draw. */
  ephemeralPublicKey: Uint8Array;
  /** One byte, 0-255. The cheap scan filter: ~1 in 256 candidates survive. */
  viewTag: number;
}

export interface RecoveredPayoutKeypair {
  /** Base58 Solana address - must equal the announced one. */
  solanaAddress: string;
  /** 64-byte Solana secret key: `seed(32) || publicKey(32)`. */
  secretKey: Uint8Array;
  /** The 32-byte ed25519 seed, i.e. the argument to `Keypair.fromSeed`. */
  seed: Uint8Array;
  /** The view tag recomputed locally, for display next to the announced one. */
  viewTag: number;
}

export type DecodedPayoutRecord =
  | { publicKey: Uint8Array; error?: undefined }
  | { publicKey?: undefined; error: string };

/* ------------------------------------------------------------- borrower */

/**
 * Step 1 - derive the borrower's long-lived X25519 viewing keypair from a
 * `personal_sign` signature.
 *
 * Why a signature rather than a stored key: an ECDSA signature over a fixed
 * message is deterministic per wallet under RFC 6979 (and every major wallet
 * implements it that way), so the same wallet reproduces the same key on any
 * device with nothing persisted. Nothing to back up, nothing to leak at rest.
 *
 * The signature is NOT used as a key directly - it is only 65 bytes of
 * structured, partly predictable material. It is run through HKDF-Extract to
 * concentrate its entropy (RFC 5869 section 3.1 is explicit that this is the
 * intended use of Extract), and the result is clamped per RFC 7748 section 5:
 * clear the low three bits, clear the top bit, set the second-highest bit.
 * Clamping puts the scalar in the correct cofactor-cleared range;
 * `@noble/curves` clamps internally too, but we clamp here so that
 * `privateKey` is exactly the value used, not a value that silently becomes
 * something else downstream.
 *
 * @param signatureHex 65-byte `personal_sign` output (64 accepted for
 *        EIP-2098 compact signatures), with or without a `0x` prefix.
 * @throws if the input is not plausible signature material. A short or
 *         malformed signature must never be silently stretched into a key.
 */
export function deriveViewingKeypair(signatureHex: string): ViewingKeypair {
  const signature = hexToBytesStrict(signatureHex, "signature");
  if (signature.length < 64) {
    throw new Error(
      `signature: expected at least 64 bytes of personal_sign output, got ${signature.length}`,
    );
  }
  const privateKey = hkdf(sha256, signature, HKDF_SALT_VIEWING_KEY, HKDF_INFO_VIEWING_KEY, 32);
  // RFC 7748 section 5 clamping.
  privateKey[0] = privateKey[0]! & 248;
  privateKey[31] = privateKey[31]! & 127;
  privateKey[31] = privateKey[31]! | 64;
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/**
 * The exact string to write into the ENS text record.
 * `pcv1:sol:x25519:0x<64 hex>` - 82 characters, cheap to `setText`.
 */
export function encodePayoutRecord(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`payout key: expected 32 bytes, got ${publicKey.length}`);
  }
  return PAYOUT_RECORD_PREFIX + bytesToHex0x(publicKey);
}

/**
 * Parse a text-record value read off ENS. Strict, and never throws: this runs
 * on data an arbitrary third party wrote to a public resolver, so every failure
 * mode has to come back as a message the UI can print rather than an exception
 * in the render path.
 */
export function decodePayoutRecord(value: string): DecodedPayoutRecord {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { error: `no ${PAYOUT_RECORD_KEY} record is set on this name` };
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith(PAYOUT_RECORD_PREFIX)) {
    const head = trimmed.slice(0, 24);
    const ellipsis = trimmed.length > 24 ? "..." : "";
    return {
      error: `unrecognised record format: expected it to start with "${PAYOUT_RECORD_PREFIX}", got "${head}${ellipsis}"`,
    };
  }
  const hex = trimmed.slice(PAYOUT_RECORD_PREFIX.length);
  let bytes: Uint8Array;
  try {
    bytes = hexToBytesStrict(hex, "payout key");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (bytes.length !== 32) {
    return { error: `payout key: expected 32 bytes of X25519 public key, got ${bytes.length}` };
  }
  if (bytes.every((byte) => byte === 0)) {
    return { error: "payout key: all-zero X25519 public key (a small-order point, not usable)" };
  }
  return { publicKey: bytes };
}

/* ------------------------------------------------------------- view tag */

/**
 * One byte of the shared secret's HKDF expansion. Published alongside the
 * draw so a scanning borrower can discard ~255/256 of candidate announcements
 * after a single hash instead of a full key derivation. It leaks one byte of a
 * value only the two parties can compute, and nothing about the payout seed
 * (different `info`).
 */
export function payoutViewTag(sharedSecret: Uint8Array): number {
  const tag = hkdf(sha256, sharedSecret, HKDF_SALT_VIEW_TAG, HKDF_INFO_VIEW_TAG, 1);
  return tag[0]!;
}

/* ------------------------------------------------------------- shared */

/**
 * `seed = HKDF-SHA256(ss, salt = requestId, info = "privatecredit/v1/sol-payout")`.
 *
 * The requestId is the salt, which is what makes two draws under two different
 * requests land on two unrelated addresses even if the ephemeral key were
 * somehow reused. It is domain-separating, not secret - RFC 5869 section 3.1
 * explicitly allows a non-secret salt.
 */
function payoutSeed(sharedSecret: Uint8Array, requestId: string): Uint8Array {
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new Error(
      "requestId: must be a non-empty string - it is the HKDF salt that separates draws",
    );
  }
  return hkdf(sha256, sharedSecret, utf8ToBytes(requestId), HKDF_INFO_PAYOUT_SEED, 32);
}

/* ------------------------------------------------------------- lender */

/**
 * Step 2 - the lender derives a one-time Solana payout address for one draw.
 *
 * @param recipientPublicKey the 32-byte X25519 key read from the borrower's
 *        ENS text record (via `decodePayoutRecord`).
 * @param requestId the loan request this draw belongs to; the HKDF salt.
 * @param ephemeralPrivateKey normally omitted - a fresh random `r` is drawn
 *        per call, and reusing one across draws under the same requestId would
 *        link them. Accepted only so that tests can be deterministic.
 */
export function derivePayoutAddress(input: {
  recipientPublicKey: Uint8Array;
  requestId: string;
  ephemeralPrivateKey?: Uint8Array;
}): PayoutAnnouncement {
  const { recipientPublicKey, requestId } = input;
  if (recipientPublicKey.length !== 32) {
    throw new Error(`recipient payout key: expected 32 bytes, got ${recipientPublicKey.length}`);
  }
  const ephemeralPrivateKey = input.ephemeralPrivateKey ?? x25519.utils.randomSecretKey();
  if (ephemeralPrivateKey.length !== 32) {
    throw new Error(`ephemeral key: expected 32 bytes, got ${ephemeralPrivateKey.length}`);
  }
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  // Throws on an all-zero output, i.e. if the recipient key is a small-order
  // point. That is the correct behaviour: silently paying out to a key an
  // attacker also knows would be the worst possible failure here.
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey);
  const seed = payoutSeed(sharedSecret, requestId);
  const publicKey = ed25519.getPublicKey(seed);
  return {
    solanaAddress: base58Encode(publicKey),
    ephemeralPublicKey,
    viewTag: payoutViewTag(sharedSecret),
  };
}

/* ------------------------------------------------------------- recovery */

/**
 * Step 4 - the borrower recovers the full keypair for one announcement.
 *
 * Returns `null` when the view tag does not match, which is the ordinary case
 * while scanning: most announcements on chain belong to somebody else. A `null`
 * is "not for me", never "something went wrong".
 *
 * The returned `secretKey` is in Solana's 64-byte `seed || publicKey` layout,
 * so it can be handed straight to `Keypair.fromSecretKey`. It is a spending
 * key: see the compartmentalisation note at the top of this file.
 */
export function recoverPayoutKeypair(input: {
  viewingPrivateKey: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  requestId: string;
  /** The announced tag. Omit to skip the filter and always derive. */
  viewTag?: number;
}): RecoveredPayoutKeypair | null {
  const { viewingPrivateKey, ephemeralPublicKey, requestId, viewTag } = input;
  if (viewingPrivateKey.length !== 32) {
    throw new Error(`viewing key: expected 32 bytes, got ${viewingPrivateKey.length}`);
  }
  if (ephemeralPublicKey.length !== 32) {
    throw new Error(`ephemeral key: expected 32 bytes, got ${ephemeralPublicKey.length}`);
  }
  const sharedSecret = x25519.getSharedSecret(viewingPrivateKey, ephemeralPublicKey);
  const recomputedTag = payoutViewTag(sharedSecret);
  if (viewTag !== undefined && recomputedTag !== viewTag) return null;

  const seed = payoutSeed(sharedSecret, requestId);
  const publicKey = ed25519.getPublicKey(seed);
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(publicKey, 32);
  return {
    solanaAddress: base58Encode(publicKey),
    secretKey,
    seed,
    viewTag: recomputedTag,
  };
}

/**
 * The public key implied by a recovered 64-byte Solana secret key, as base58.
 * Used by the self-test to prove the recovered key really controls the
 * announced address rather than merely hashing to the same string.
 */
export function solanaAddressFromSecretKey(secretKey: Uint8Array): string {
  if (secretKey.length !== 64) {
    throw new Error(`secret key: expected 64 bytes (seed || publicKey), got ${secretKey.length}`);
  }
  return base58Encode(ed25519.getPublicKey(secretKey.slice(0, 32)));
}
