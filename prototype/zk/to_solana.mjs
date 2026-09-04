import fs from "node:fs";
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be32 = (v) => { const b = Buffer.alloc(32); let x = BigInt(v);
  for (let i = 31; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };
const g1  = ([x, y]) => Buffer.concat([be32(x), be32(y)]);                       // 64 bytes
const g1neg = ([x, y]) => Buffer.concat([be32(x), be32((P - BigInt(y)) % P)]);   // negate Y
// snarkjs G2 is [[x.c0, x.c1],[y.c0, y.c1]]; arkworks/solana wants c1 first
const g2  = (pt) => Buffer.concat([be32(pt[0][1]), be32(pt[0][0]), be32(pt[1][1]), be32(pt[1][0])]); // 128

const proof = JSON.parse(fs.readFileSync("proof.json"));
const pub   = JSON.parse(fs.readFileSync("public.json"));
const vk    = JSON.parse(fs.readFileSync("verification_key.json"));

const pA_neg = g1neg(proof.pi_a);
const pA_raw = g1(proof.pi_a);
const pB = g2(proof.pi_b);
const pC = g1(proof.pi_c);
const inputs = pub.map(be32);

console.log("proof_a(neg) bytes:", pA_neg.length, "proof_b:", pB.length, "proof_c:", pC.length);
console.log("public inputs:", inputs.length, "x 32 bytes");
console.log("vk_ic length:", vk.IC.length, "(must equal nPublic+1 =", pub.length + 1, ")");

const hex = (b) => "[" + [...b].join(",") + "]";
const rs = `// generated from snarkjs artifacts - do not edit
pub const NR_PUB: usize = ${pub.length};
pub const VK_ALPHA_G1: [u8; 64]  = ${hex(g1(vk.vk_alpha_1))};
pub const VK_BETA_G2:  [u8; 128] = ${hex(g2(vk.vk_beta_2))};
pub const VK_GAMMA_G2: [u8; 128] = ${hex(g2(vk.vk_gamma_2))};
pub const VK_DELTA_G2: [u8; 128] = ${hex(g2(vk.vk_delta_2))};
pub const VK_IC: [[u8; 64]; ${vk.IC.length}] = [
${vk.IC.map((p) => "    " + hex(g1(p))).join(",\n")}
];
pub const PROOF_A_NEG: [u8; 64]  = ${hex(pA_neg)};
pub const PROOF_A_RAW: [u8; 64]  = ${hex(pA_raw)};
pub const PROOF_B:     [u8; 128] = ${hex(pB)};
pub const PROOF_C:     [u8; 64]  = ${hex(pC)};
pub const PUBLIC_INPUTS: [[u8; 32]; ${inputs.length}] = [
${inputs.map((b) => "    " + hex(b)).join(",\n")}
];
`;
fs.writeFileSync("vk_data.rs", rs);
console.log("wrote vk_data.rs", fs.statSync("vk_data.rs").size, "bytes");
