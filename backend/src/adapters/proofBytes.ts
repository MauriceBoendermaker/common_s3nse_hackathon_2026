/**
 * snarkjs Groth16 proof -> the byte layout `groth16-solana` expects.
 *
 * This is the crux of the whole on-chain verification claim, and it is three
 * non-obvious rules deep. Every one of them was proven end to end in
 * `prototype/solana-verify/`, whose Rust test printed:
 *
 *     proof.A NEGATED : VERIFIED
 *     proof.A as-is   : rejected
 *     TAMPERED inputs : correctly rejected
 *
 * The three rules:
 *
 *  1. `proof.A` MUST BE NEGATED -- (x, p - y). Non-negated A is rejected. This
 *     is the single most common reason a correct snarkjs proof fails on Solana.
 *  2. G2 coordinates SWAP. snarkjs emits [[x.c0, x.c1], [y.c0, y.c1]];
 *     arkworks -- and therefore groth16-solana -- wants c1 before c0.
 *  3. Everything is 32-byte BIG-ENDIAN, and the encoder must THROW rather than
 *     truncate. The classic bug is `hex.padStart(64, "0")` on a value already
 *     longer than 64 characters: padStart silently no-ops, the value is
 *     truncated, and the proof fails on-chain with no useful error.
 *
 * Every failure mode in this file produces exactly one symptom -- "proof
 * invalid" -- which is why the conversion is guarded at every step instead of
 * being trusted.
 *
 * This is a TypeScript port of `zk/to_solana.mjs`, kept deliberately separate:
 * that file is a build-time tool that emits Rust source, this one runs per
 * request. They must agree, and `selfTest()` below asserts the parts that can
 * be checked without a chain.
 */

/** BN254 base field modulus p (the coordinate field, not the scalar field r). */
export const BN254_P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/** The BN254 scalar field modulus r. Public signals live here. */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type SnarkjsProof = {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
};

export type SolanaProofBytes = {
  /** 64 bytes, Y already negated. */
  proofA: Uint8Array;
  /** 128 bytes, c1 before c0. */
  proofB: Uint8Array;
  /** 64 bytes. */
  proofC: Uint8Array;
  /** `nPublic` entries of exactly 32 bytes each, in circuit wire order. */
  publicSignals: Uint8Array[];
};

/**
 * 32-byte big-endian encoding that REFUSES to truncate.
 *
 * A value that does not fit is always a bug upstream (a missing mod-p
 * reduction, a decimal string parsed as hex, a swapped coordinate). Silently
 * keeping the low 32 bytes turns that bug into an unexplained on-chain
 * rejection a hundred lines later.
 */
export function be32(value: bigint | string, label = "value"): Uint8Array {
  let x = typeof value === "bigint" ? value : BigInt(value);
  if (x < 0n) {
    throw new Error(`proofBytes: ${label} is negative (${x})`);
  }
  if (x >= 1n << 256n) {
    throw new Error(
      `proofBytes: ${label} does not fit in 32 bytes (${x.toString(16).length} hex chars)`,
    );
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** G1 point -> 64 bytes (x || y). */
function g1(point: readonly string[], label: string): Uint8Array {
  return concat([be32(point[0], `${label}.x`), be32(point[1], `${label}.y`)]);
}

/** G1 point with Y negated -> 64 bytes. RULE 1. */
function g1neg(point: readonly string[], label: string): Uint8Array {
  const y = BigInt(point[1]) % BN254_P;
  return concat([be32(point[0], `${label}.x`), be32((BN254_P - y) % BN254_P, `${label}.-y`)]);
}

/** G2 point -> 128 bytes, c1 BEFORE c0 on both coordinates. RULE 2. */
function g2(point: readonly (readonly string[])[], label: string): Uint8Array {
  return concat([
    be32(point[0][1], `${label}.x.c1`),
    be32(point[0][0], `${label}.x.c0`),
    be32(point[1][1], `${label}.y.c1`),
    be32(point[1][0], `${label}.y.c0`),
  ]);
}

/**
 * Convert one snarkjs proof plus its ordered public signals into the exact
 * blobs the program takes as instruction data.
 *
 * `publicSignals` must be the ORDERED decimal-string array snarkjs produced --
 * the same array the backend already hands to `snarkjs.groth16.verify`. Its
 * order is the compiled circuit's, not a convention chosen here.
 */
export function toSolanaProof(
  proof: SnarkjsProof,
  publicSignals: string[],
): SolanaProofBytes {
  if (proof.protocol !== "groth16") {
    throw new Error(`proofBytes: protocol is ${proof.protocol}, expected groth16`);
  }
  if (proof.curve !== "bn128") {
    throw new Error(`proofBytes: curve is ${proof.curve}, expected bn128`);
  }

  const proofA = g1neg(proof.pi_a, "pi_a");
  const proofB = g2(proof.pi_b, "pi_b");
  const proofC = g1(proof.pi_c, "pi_c");

  const signals = publicSignals.map((value, index) => {
    const asBigint = BigInt(value);
    if (asBigint >= BN254_R) {
      // An unreduced public signal is accepted by snarkjs and rejected
      // on-chain. Catching it here names the signal instead of producing
      // "proof invalid".
      throw new Error(
        `proofBytes: publicSignals[${index}] is not reduced mod r (${value})`,
      );
    }
    return be32(asBigint, `publicSignals[${index}]`);
  });

  if (proofA.length !== 64) throw new Error("proofBytes: proofA is not 64 bytes");
  if (proofB.length !== 128) throw new Error("proofBytes: proofB is not 128 bytes");
  if (proofC.length !== 64) throw new Error("proofBytes: proofC is not 64 bytes");
  for (const [index, signal] of signals.entries()) {
    if (signal.length !== 32) {
      throw new Error(`proofBytes: publicSignals[${index}] is not 32 bytes`);
    }
  }

  return { proofA, proofB, proofC, publicSignals: signals };
}

/** `0x…` hex (any length) -> exactly 32 big-endian bytes, reduced into r. */
export function fieldHexToBytes(hex: string, label = "field"): Uint8Array {
  const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(`proofBytes: ${label} is not hex ("${hex}")`);
  }
  return be32(BigInt("0x" + body) % BN254_R, label);
}

/* -------------------------------------------------------------- self-test */

if (process.argv[1] && process.argv[1].endsWith("proofBytes.ts")) {
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error("FAIL: " + message);
  };
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

  assert(hex(be32(0n)) === "0".repeat(64), "be32(0)");
  assert(hex(be32(255n)).endsWith("ff"), "be32 is big-endian");
  assert(be32(255n)[0] === 0, "be32 pads on the left");

  let threw = false;
  try {
    be32(1n << 256n);
  } catch {
    threw = true;
  }
  assert(threw, "be32 throws instead of truncating");

  // Negation must round-trip mod p and must actually change Y.
  const sample = ["7", "9", "1"] as const;
  const negated = g1neg(sample, "sample");
  const plain = g1(sample, "sample");
  assert(hex(negated) !== hex(plain), "g1neg changes Y");
  const yNeg = BigInt("0x" + hex(negated).slice(64));
  assert((yNeg + 9n) % BN254_P === 0n, "g1neg round-trips mod p");

  // G2 really does swap the limbs.
  const g2point = [
    ["1", "2"],
    ["3", "4"],
    ["1", "0"],
  ] as const;
  const encoded = hex(g2(g2point, "sample"));
  assert(encoded.slice(0, 64).endsWith("02"), "g2 puts x.c1 first");
  assert(encoded.slice(64, 128).endsWith("01"), "g2 puts x.c0 second");
  assert(encoded.slice(128, 192).endsWith("04"), "g2 puts y.c1 third");
  assert(encoded.slice(192, 256).endsWith("03"), "g2 puts y.c0 fourth");

  assert(hex(fieldHexToBytes("0xff")).endsWith("ff"), "fieldHexToBytes short input");
  assert(
    BigInt("0x" + hex(fieldHexToBytes("0x" + "f".repeat(64)))) < BN254_R,
    "fieldHexToBytes reduces mod r",
  );

  console.log("proofBytes.ts OK");
}
