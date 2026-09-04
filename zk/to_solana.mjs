// zk/to_solana.mjs - snarkjs -> groth16-solana byte converter.
//
// This is the crux of the whole chain-portability claim, and it is three
// non-obvious rules deep. It was proven end-to-end in
// `prototype/solana-verify/`, whose Rust test printed:
//
//     proof.A NEGATED : VERIFIED
//     proof.A as-is   : rejected
//     TAMPERED inputs : correctly rejected
//
// The three rules:
//
//  1. `proof.A` MUST BE NEGATED - (x, p - y). Non-negated A is rejected.
//     Not optional, not a nicety. This is the single most common reason a
//     correct snarkjs proof fails on Solana.
//  2. G2 coordinates SWAP. snarkjs emits [[x.c0, x.c1], [y.c0, y.c1]];
//     arkworks (and therefore groth16-solana) wants c1 before c0.
//  3. Everything is 32-byte BIG-ENDIAN. Guard it. The classic bug is
//     `hex.padStart(64, "0")` on a value that is already longer than 64
//     characters: padStart silently no-ops, the value is truncated
//     downstream, and the proof fails with no useful error. THROW instead.
//
// ------------------------------------------------------------------ traps
// The PUBLISHED `groth16-solana` 0.2.0 crate is NOT GitHub master:
//   - the struct field is misspelled `vk_gamme_g2`. Writing `vk_gamma_g2`
//     is a compile error. This is not a typo in this comment.
//   - there are NO feature flags, no `vk::circom` module, no
//     `proof_parser.rs`.
//   - VK generation in the published crate is a bundled Node script
//     (`npm run parse-vk`), not a Rust helper.
//   - every "generate_vk_file" tutorial online describes master and will
//     not compile against the published crate.
// 0.2.0 is also UNAUDITED. Only 0.0.1 was covered by the Light Protocol v3
// audit. It is widely used; it is not audited. Do not say otherwise.
//
// ---------------------------------------------------------------- warning
// The verifying key emitted here is derived from the zkey. Regenerating the
// zkey changes it, so `vk_data.rs` and the browser artifacts under
// `frontend/public/zk/` must ALWAYS be regenerated together - which is why
// `zk/build.mjs` does both in one step.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** BN254 base field modulus p (the coordinate field, not the scalar field r). */
export const P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/**
 * 32-byte big-endian encoding that REFUSES to truncate.
 *
 * A value that does not fit in 32 bytes is a bug (a missing mod-p reduction,
 * a decimal string parsed as hex, a swapped coordinate). Silently keeping the
 * low 32 bytes turns that bug into "the proof is invalid" a hundred lines
 * later, in Rust, on-chain.
 */
export function be32(value, label = "value") {
  let x = typeof value === "bigint" ? value : BigInt(value);
  if (x < 0n) throw new Error(`to_solana: ${label} is negative (${x})`);
  if (x >= 1n << 256n) {
    throw new Error(`to_solana: ${label} does not fit in 32 bytes (${x.toString(16).length} hex chars)`);
  }
  const b = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

/** G1 point -> 64 bytes (x || y). */
export const g1 = ([x, y], label = "g1") =>
  Buffer.concat([be32(x, `${label}.x`), be32(y, `${label}.y`)]);

/** G1 point with Y negated -> 64 bytes. RULE 1. */
export const g1neg = ([x, y], label = "g1neg") =>
  Buffer.concat([be32(x, `${label}.x`), be32((P - BigInt(y)) % P, `${label}.-y`)]);

/** G2 point -> 128 bytes, c1 BEFORE c0 on both coordinates. RULE 2. */
export const g2 = (pt, label = "g2") =>
  Buffer.concat([
    be32(pt[0][1], `${label}.x.c1`),
    be32(pt[0][0], `${label}.x.c0`),
    be32(pt[1][1], `${label}.y.c1`),
    be32(pt[1][0], `${label}.y.c0`),
  ]);

/**
 * Convert a snarkjs proof + public signals + verification key into the byte
 * blobs groth16-solana expects, and self-check the result.
 *
 * Returns { rust, checks } where `rust` is the generated `vk_data.rs` source
 * and `checks` is a list of { name, passed, detail } for the build log.
 */
export function toSolana({ proof, publicSignals, vk }) {
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    if (!passed) throw new Error(`to_solana check failed: ${name} - ${detail}`);
  };

  const pub = publicSignals.map((v) => BigInt(v));

  // ---- unit check: vk_ic.len() must equal nPublic + 1 ----------------
  check(
    "vk.IC.length === nPublic + 1",
    vk.IC.length === pub.length + 1,
    `IC=${vk.IC.length}, nPublic=${pub.length}`,
  );
  check(
    "vk.nPublic agrees with publicSignals",
    Number(vk.nPublic) === pub.length,
    `vk.nPublic=${vk.nPublic}, publicSignals=${pub.length}`,
  );
  check("vk.protocol is groth16", vk.protocol === "groth16", String(vk.protocol));
  check("vk.curve is bn128", vk.curve === "bn128", String(vk.curve));

  const pA_neg = g1neg(proof.pi_a, "proof.A");
  const pA_raw = g1(proof.pi_a, "proof.A");
  const pB = g2(proof.pi_b, "proof.B");
  const pC = g1(proof.pi_c, "proof.C");
  const inputs = pub.map((v, i) => be32(v, `publicSignals[${i}]`));
  const ic = vk.IC.map((p, i) => g1(p, `vk.IC[${i}]`));

  // ---- unit check: every emitted value is exactly 32 bytes ------------
  const widths = [
    ["proof_a(neg)", pA_neg, 64],
    ["proof_a(raw)", pA_raw, 64],
    ["proof_b", pB, 128],
    ["proof_c", pC, 64],
    ["vk_alpha_g1", g1(vk.vk_alpha_1, "vk.alpha"), 64],
    ["vk_beta_g2", g2(vk.vk_beta_2, "vk.beta"), 128],
    ["vk_gamma_g2", g2(vk.vk_gamma_2, "vk.gamma"), 128],
    ["vk_delta_g2", g2(vk.vk_delta_2, "vk.delta"), 128],
  ];
  for (const [name, buf, want] of widths) {
    check(`${name} is ${want} bytes`, buf.length === want, `${buf.length} bytes`);
  }
  check(
    "every public input is exactly 32 bytes",
    inputs.every((b) => b.length === 32),
    `${inputs.length} inputs`,
  );
  check(
    "every IC point is exactly 64 bytes (2 x 32)",
    ic.every((b) => b.length === 64),
    `${ic.length} points`,
  );
  // Negation must be a real change AND must round-trip.
  const yRaw = BigInt(proof.pi_a[1]) % P;
  const yNeg = (P - yRaw) % P;
  check("proof.A negation actually changed Y", yRaw !== yNeg || yRaw === 0n, `y=${yRaw}`);
  check("proof.A negation round-trips mod p", (yNeg + yRaw) % P === 0n, "y + (p-y) = 0 mod p");

  const arr = (b) => "[" + [...b].join(",") + "]";
  const rust = `// GENERATED by zk/build.mjs via zk/to_solana.mjs - do not edit.
//
// Regenerating the zkey changes the verifying key, so these constants and the
// browser artifacts in frontend/public/zk/ MUST always be regenerated
// together. If they drift apart every proof fails on-chain with no useful
// error.
//
// NOTE for whoever writes the Anchor program: in the PUBLISHED groth16-solana
// 0.2.0 crate the verifying-key struct field is misspelled \`vk_gamme_g2\`.
// Writing \`vk_gamma_g2\` is a compile error. The crate is unaudited.
//
// proof.A is stored NEGATED. PROOF_A_RAW is kept only so a test can show that
// the non-negated form is rejected.

pub const NR_PUB: usize = ${pub.length};

pub const VK_ALPHA_G1: [u8; 64]  = ${arr(g1(vk.vk_alpha_1, "vk.alpha"))};
pub const VK_BETA_G2:  [u8; 128] = ${arr(g2(vk.vk_beta_2, "vk.beta"))};
pub const VK_GAMMA_G2: [u8; 128] = ${arr(g2(vk.vk_gamma_2, "vk.gamma"))};
pub const VK_DELTA_G2: [u8; 128] = ${arr(g2(vk.vk_delta_2, "vk.delta"))};
pub const VK_IC: [[u8; 64]; ${ic.length}] = [
${ic.map((p) => "    " + arr(p)).join(",\n")}
];

pub const PROOF_A_NEG: [u8; 64]  = ${arr(pA_neg)};
pub const PROOF_A_RAW: [u8; 64]  = ${arr(pA_raw)};
pub const PROOF_B:     [u8; 128] = ${arr(pB)};
pub const PROOF_C:     [u8; 64]  = ${arr(pC)};
pub const PUBLIC_INPUTS: [[u8; 32]; ${inputs.length}] = [
${inputs.map((b) => "    " + arr(b)).join(",\n")}
];
`;

  return { rust, checks, bytes: { pA_neg, pA_raw, pB, pC, inputs, ic } };
}

/* ------------------------------------------------------------------- CLI */

// fileURLToPath, not `new URL(...).pathname`: on Windows the latter yields
// "/C:/..." and percent-encodes spaces, so the comparison silently never
// matches and the CLI prints nothing at all.
const here = fileURLToPath(import.meta.url);
const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === here;

if (invokedDirectly) {
  const dir = process.argv[2] ?? path.join(path.dirname(here), "build");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const { rust, checks } = toSolana({
    proof: read("proof.json"),
    publicSignals: read("public.json"),
    vk: read("verification_key.json"),
  });
  for (const c of checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  const out = path.join(dir, "vk_data.rs");
  fs.writeFileSync(out, rust);
  console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
}
