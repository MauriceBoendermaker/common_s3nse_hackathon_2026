/**
 * Field-element helpers shared by policy hashing, commitments and nullifiers.
 *
 * Everything the protocol hashes eventually becomes a BN254 scalar-field
 * element, because that is the only thing Poseidon (and, later, the circom
 * circuit and the Solana verifier) can consume. This file fixes ONE definition
 * of every encoding step so that circom, Rust and TypeScript can agree.
 *
 * Why that matters concretely (BACKEND_PLAN.md section 3.2):
 *  - An ENS namehash exceeds the BN254 scalar field roughly 78% of the time.
 *    If the three implementations reduce mod r differently -- or one forgets
 *    to reduce -- verification fails about one time in four and looks random.
 *  - `Poseidon("privatecredit.v1")` is under-specified: Poseidon eats field
 *    elements, not strings. `utf8ToField` below is this project's single fixed
 *    answer to "what is Poseidon over a string".
 *
 * No TypeScript `enum`, no `namespace`, no decorators: Node 22 runs this file
 * directly via native type stripping.
 */

import { createHash, randomBytes } from "node:crypto";

/** The BN254 (alt_bn128) scalar field modulus `r`. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Canonical hex width of a field element: 32 bytes = 64 hex characters. */
const FIELD_HEX_CHARS = 64;

/**
 * Reduce an integer into the BN254 scalar field.
 *
 * Negative inputs are rejected rather than wrapped. A negative value here is
 * always a bug upstream (a subtraction that underflowed, a signed parse), and
 * silently mapping it to `r - n` would produce a commitment that nothing else
 * can reproduce.
 *
 * Strings are accepted in two forms only: `0x`-prefixed hex, or plain decimal.
 */
export function toField(value: bigint | number | string): bigint {
  let raw: bigint;

  if (typeof value === "bigint") {
    raw = value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("toField: value is not finite (" + String(value) + ")");
    }
    if (!Number.isInteger(value)) {
      throw new Error("toField: value is not an integer (" + String(value) + ")");
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error("toField: value exceeds Number.MAX_SAFE_INTEGER (" + String(value) + ")");
    }
    raw = BigInt(value);
  } else {
    const text = value.trim();
    if (text.length === 0) {
      throw new Error("toField: empty string");
    }
    try {
      // BigInt() understands both "0x..." and plain decimal, and rejects junk.
      raw = BigInt(text);
    } catch {
      throw new Error('toField: not a decimal or 0x-hex integer ("' + text + '")');
    }
  }

  if (raw < 0n) {
    throw new Error("toField: negative values are rejected (" + raw.toString() + ")");
  }

  return raw % FIELD_MODULUS;
}

/**
 * Interpret an arbitrary-length `0x`-prefixed hex string as a big-endian
 * integer and reduce it into the field.
 *
 * Deliberately accepts ANY length, because the two things fed through here --
 * an ENS namehash and a 32-byte salt -- are both 256-bit values that routinely
 * exceed `r`. The reduction is the whole point; it must be identical in circom
 * and in Rust.
 */
export function hexToField(hex: string): bigint {
  if (typeof hex !== "string") {
    throw new Error("hexToField: expected a string");
  }

  const text = hex.trim();
  const body = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;

  if (body.length === 0) {
    throw new Error('hexToField: no hex digits in "' + hex + '"');
  }
  if (!/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error('hexToField: not hex ("' + hex + '")');
  }

  return BigInt("0x" + body) % FIELD_MODULUS;
}

/**
 * The project's ONE definition of "Poseidon over a string".
 *
 * SHA-256 the UTF-8 bytes, read the 32-byte digest big-endian, reduce mod r.
 *
 * This is a deliberate choice, not an accident:
 *  - Poseidon's domain is field elements. Any string-to-field map has to be
 *    specified somewhere, and BACKEND_PLAN.md section 3.2 calls out that
 *    leaving it implicit guarantees the on-chain recompute will never match
 *    the client's.
 *  - SHA-256 was chosen over keccak256 for one boring, decisive reason: it is
 *    in `node:crypto`, in the browser's WebCrypto, and in
 *    `solana_program::hash` -- three implementations, no dependency, same
 *    digest. Any collision-resistant hash would do; what matters is that
 *    exactly one is used everywhere.
 *  - The reduction is mandatory: a 256-bit digest exceeds r about 78% of the
 *    time, the same as a namehash.
 *
 * Used for domain tags AND for string identities (an ENS name, a Solana
 * address, a lender label) so there is never a second, ad-hoc encoding.
 */
export function utf8ToField(text: string): bigint {
  if (typeof text !== "string") {
    throw new Error("utf8ToField: expected a string");
  }
  const digest = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
  return BigInt("0x" + digest) % FIELD_MODULUS;
}

/**
 * Canonical wire form of a field element: `0x` + exactly 64 lowercase hex.
 *
 * Throws rather than truncating. `String.prototype.padStart` is a no-op when
 * the string is already too long, so a naive `padStart(64, "0")` on an
 * oversized value silently emits a wrong-but-plausible 65+ character hash --
 * a known trap that produces commitments which never match anywhere else.
 */
export function fieldToHex(value: bigint): string {
  if (typeof value !== "bigint") {
    throw new Error("fieldToHex: expected a bigint");
  }
  if (value < 0n) {
    throw new Error("fieldToHex: negative value (" + value.toString() + ")");
  }

  const body = value.toString(16);
  if (body.length > FIELD_HEX_CHARS) {
    throw new Error(
      "fieldToHex: value needs " +
        body.length +
        " hex chars, max is " +
        FIELD_HEX_CHARS +
        " -- reduce with toField() before encoding",
    );
  }

  return "0x" + body.padStart(FIELD_HEX_CHARS, "0");
}

/**
 * Display form: `0x` + first 6 + U+2026 + last 4 of the hex body.
 * Short values are returned unchanged rather than mangled.
 */
export function shortHash(hex: string): string {
  if (typeof hex !== "string") {
    throw new Error("shortHash: expected a string");
  }

  const text = hex.trim();
  const hasPrefix = text.startsWith("0x") || text.startsWith("0X");
  const body = hasPrefix ? text.slice(2) : text;

  if (body.length <= 10) {
    return hasPrefix ? "0x" + body : body;
  }

  return (hasPrefix ? "0x" : "") + body.slice(0, 6) + "…" + body.slice(-4);
}

/**
 * 32 cryptographically random bytes reduced into the field, in canonical hex.
 * Backs commitment salts, challenge nonces and blinding factors.
 *
 * The modular reduction biases towards small values by about 2^-127, which is
 * far below anything that matters here.
 */
export function randomFieldElement(): string {
  const raw = BigInt("0x" + randomBytes(32).toString("hex"));
  return fieldToHex(raw % FIELD_MODULUS);
}

/* -------------------------------------------------------------- self-test */

if (process.argv[1] && process.argv[1].endsWith("hashing.ts")) {
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new Error("FAIL: " + message);
    }
  };
  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // ---- toField
  assert(toField(0) === 0n, "toField(0)");
  assert(toField(42) === 42n, "toField(42)");
  assert(toField("42") === 42n, "toField decimal string");
  assert(toField("0x2a") === 42n, "toField hex string");
  assert(toField(FIELD_MODULUS) === 0n, "toField reduces the modulus to 0");
  assert(toField(FIELD_MODULUS + 7n) === 7n, "toField reduces past the modulus");
  assert(throws(() => toField(-1)), "toField rejects negatives");
  assert(throws(() => toField(1.5)), "toField rejects non-integers");
  assert(throws(() => toField("nope")), "toField rejects junk strings");

  // ---- hexToField: the namehash case, a 256-bit value above r must reduce.
  const bigHex = "0x" + "f".repeat(64);
  const reduced = hexToField(bigHex);
  assert(reduced < FIELD_MODULUS, "hexToField reduces an over-field namehash");
  assert(reduced === BigInt(bigHex) % FIELD_MODULUS, "hexToField reduction is plain mod r");
  assert(hexToField("0xff") === 255n, "hexToField short input");
  assert(hexToField("ff") === 255n, "hexToField tolerates a missing 0x");
  assert(hexToField("0x00") === 0n, "hexToField zero");
  assert(throws(() => hexToField("0xzz")), "hexToField rejects non-hex");

  // ---- utf8ToField: stable, in-field, sensitive to input.
  const tag = utf8ToField("privatecredit.v1");
  assert(tag === utf8ToField("privatecredit.v1"), "utf8ToField is deterministic");
  assert(tag !== utf8ToField("privatecredit.v2"), "utf8ToField separates domains");
  assert(tag < FIELD_MODULUS, "utf8ToField output is in-field");
  assert(utf8ToField("") < FIELD_MODULUS, "utf8ToField accepts the empty string");

  // ---- fieldToHex round-trips.
  assert(fieldToHex(0n) === "0x" + "0".repeat(64), "fieldToHex(0)");
  assert(fieldToHex(255n).endsWith("ff"), "fieldToHex lowercase");
  assert(fieldToHex(255n).length === 66, "fieldToHex is always 66 chars");
  assert(hexToField(fieldToHex(tag)) === tag, "fieldToHex -> hexToField round-trip");
  assert(toField(fieldToHex(reduced)) === reduced, "fieldToHex -> toField round-trip");
  assert(throws(() => fieldToHex(2n ** 256n)), "fieldToHex throws instead of truncating");

  // ---- shortHash
  assert(
    shortHash("0x1234567890abcdef1234567890abcdef") === "0x123456…cdef",
    "shortHash shape: " + shortHash("0x1234567890abcdef1234567890abcdef"),
  );
  assert(shortHash("0xabcd") === "0xabcd", "shortHash leaves short values alone");
  assert(shortHash(fieldToHex(tag)).includes("…"), "shortHash uses U+2026");

  // ---- randomFieldElement
  const a = randomFieldElement();
  const b = randomFieldElement();
  assert(a !== b, "randomFieldElement is random");
  assert(a.length === 66, "randomFieldElement is canonical width");
  assert(hexToField(a) < FIELD_MODULUS, "randomFieldElement is in-field");

  console.log("hashing.ts OK");
}
