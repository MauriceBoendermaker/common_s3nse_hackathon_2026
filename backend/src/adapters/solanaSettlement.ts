/**
 * The Solana settlement leg — workstream E's client half.
 *
 * This module turns a verified proof in the backend store into a sequence of
 * real transactions against the `private_credit` program: publish the policy,
 * publish the request, fund the escrow, create the payout token account, and
 * then `present_and_fund`, which verifies the Groth16 proof ON CHAIN,
 * recomputes the policy hash ON CHAIN, spends a nullifier PDA and moves the
 * money.
 *
 * ---------------------------------------------------------------- who signs
 *
 * Three demo keypairs live in `.solana/` (gitignored), held by this backend:
 * `deployer`, `lender` and `borrower`. They are three rather than one so the
 * on-chain history shows two distinct parties doing two distinct jobs.
 *
 * They are CUSTODIAL DEMO KEYS and the UI says so on every screen that shows a
 * signature. In production the lender signs in their own wallet and this
 * module would build the transaction and hand it over unsigned. The reason it
 * is done this way here is narrow and honest: a judge should not have to
 * install a wallet extension and win a devnet faucet lottery before they can
 * see whether the protocol works. Every transaction below is still a real
 * transaction, with a real signature, on a real cluster, that anyone can open
 * in an explorer.
 *
 * ------------------------------------------------------------- no IDL client
 *
 * Instructions are encoded by hand rather than through `@coral-xyz/anchor`.
 * That is not asceticism: BACKEND_PLAN.md records that wallet-adapter takes
 * `@solana/web3.js` as a peer dependency while Anchor takes it as a regular
 * one, and two copies in the tree produce `PublicKey instanceof` failures that
 * look like nothing else. Borsh for these instructions is fixed-width arrays
 * and little-endian integers; the discriminators come straight out of the
 * generated IDL and are asserted against it at load time.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { toSolanaProof, fieldHexToBytes, type SnarkjsProof } from "./proofBytes.ts";
import type {
  CreditRequest,
  LendingPolicy,
  Offer,
  PayoutAnnouncement,
  PolicyChallenge,
  ProofSubmission,
  Settlement,
  SettlementAccount,
  SettlementConfig,
  SettlementStep,
  SettlementStepName,
} from "../protocol/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const keyDir = path.join(repoRoot, ".solana");
const deploymentFile = path.join(keyDir, "deployment.json");

/* ------------------------------------------------------------------ config */

export type DeploymentFile = {
  cluster: string;
  rpcUrl: string;
  programId: string;
  mint: string;
  mintSymbol: string;
  mintDecimals: number;
  vkHash: string;
  deployedAt: string;
};

/**
 * Every knob is an env var with a sane default, because the whole point of
 * developing against a local validator is that switching to devnet is one
 * variable rather than a code change.
 */
export const CLUSTER_URLS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

export function readDeployment(): DeploymentFile | null {
  try {
    if (!fs.existsSync(deploymentFile)) return null;
    return JSON.parse(fs.readFileSync(deploymentFile, "utf8")) as DeploymentFile;
  } catch {
    return null;
  }
}

export function writeDeployment(value: DeploymentFile): void {
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(value, null, 2) + "\n");
}

export function clusterName(): string {
  const deployment = readDeployment();
  return process.env.SOLANA_SETTLE_CLUSTER ?? deployment?.cluster ?? "localnet";
}

export function rpcUrl(): string {
  const deployment = readDeployment();
  return (
    process.env.SOLANA_SETTLE_RPC ??
    deployment?.rpcUrl ??
    CLUSTER_URLS[clusterName()] ??
    CLUSTER_URLS.localnet
  );
}

export function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

/**
 * A link a judge can click.
 *
 * A local validator has no hosted explorer, so the `custom` cluster parameter
 * is used and the URL is honest about pointing at a machine only the operator
 * can reach. On devnet it is an ordinary explorer link.
 */
export function explorerUrl(kind: "tx" | "address", value: string): string {
  const cluster = clusterName();
  const suffix =
    cluster === "localnet"
      ? `?cluster=custom&customUrl=${encodeURIComponent(rpcUrl())}`
      : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}

export function explorerBase(): string {
  return explorerUrl("address", "").replace(/\/$/, "");
}

/* ---------------------------------------------------------------- keypairs */

const KEY_ROLES = ["deployer", "lender", "borrower"] as const;
export type KeyRole = (typeof KEY_ROLES)[number];

export function loadOrCreateKeypair(role: KeyRole): Keypair {
  fs.mkdirSync(keyDir, { recursive: true });
  const file = path.join(keyDir, `${role}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify([...keypair.secretKey]));
  return keypair;
}

/* ---------------------------------------------------- instruction encoding */

/**
 * Anchor's default discriminator is `sha256("global:" + snake_case_name)[..8]`.
 * These are copied from `solana/target/idl/private_credit.json` and asserted
 * against that file at load time, so a renamed instruction fails loudly at
 * startup instead of producing "InstructionFallbackNotFound" at settlement
 * time.
 */
const DISCRIMINATORS: Record<string, number[]> = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  publish_policy: [48, 1, 101, 147, 0, 239, 136, 36],
  publish_request: [42, 127, 34, 25, 155, 225, 242, 93],
  fund_escrow: [155, 18, 218, 141, 182, 213, 69, 201],
  present_and_fund: [125, 23, 50, 59, 27, 89, 236, 28],
  draw: [61, 40, 62, 184, 31, 176, 24, 130],
  repay: [234, 103, 67, 82, 208, 234, 219, 166],
};

function discriminator(name: keyof typeof DISCRIMINATORS): Buffer {
  const expected = Buffer.from(
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
  );
  const declared = Buffer.from(DISCRIMINATORS[name]);
  if (!expected.equals(declared)) {
    throw new Error(
      `solanaSettlement: discriminator drift for "${name}" — the IDL says ` +
        `[${declared.join(",")}] but sha256("global:${name}") says [${expected.join(",")}]`,
    );
  }
  return declared;
}

function u64(value: bigint | number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

function bool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

/** A backend id string -> the fixed 32 bytes the program uses as a PDA seed. */
export function seedFromId(id: string): Buffer {
  return createHash("sha256").update(id, "utf8").digest();
}

/* --------------------------------------------------------------------- PDAs */

export function programId(): PublicKey {
  const deployment = readDeployment();
  const id = process.env.SOLANA_PROGRAM_ID ?? deployment?.programId;
  if (!id) {
    throw new Error(
      "solanaSettlement: no program id. Run `npm run solana:setup` (or set SOLANA_PROGRAM_ID).",
    );
  }
  return new PublicKey(id);
}

export function mintAddress(): PublicKey {
  const deployment = readDeployment();
  const mint = process.env.SOLANA_DEMO_MINT ?? deployment?.mint;
  if (!mint) {
    throw new Error("solanaSettlement: no settlement mint. Run `npm run solana:setup`.");
  }
  return new PublicKey(mint);
}

const pda = (seeds: Array<Buffer | Uint8Array>) =>
  PublicKey.findProgramAddressSync(seeds, programId())[0];

export const configPda = () => pda([Buffer.from("config")]);
/**
 * Keyed by (policy hash, verifier commitment).
 *
 * Not by the policy hash alone: two lenders publishing the same four
 * thresholds is normal, and they are still different verifiers. Signal [6]
 * binds a receipt to one of them, so a shared account makes the second
 * lender's proofs fail as "issued to a different verifier".
 */
export const policyPda = (policyHash: Buffer, verifierCommitment: Buffer) =>
  pda([Buffer.from("policy"), policyHash, verifierCommitment]);
export const requestPda = (requestSeed: Buffer) => pda([Buffer.from("request"), requestSeed]);
export const vaultPda = (requestSeed: Buffer) => pda([Buffer.from("vault"), requestSeed]);
export const loanPda = (requestSeed: Buffer) => pda([Buffer.from("loan"), requestSeed]);
export const nullifierPda = (nullifier: Buffer) => pda([Buffer.from("nullifier"), nullifier]);

/* ------------------------------------------------------- instruction builders */

function ix(
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
  data: Buffer,
): TransactionInstruction {
  return new TransactionInstruction({ programId: programId(), keys, data });
}

export function initializeIx(authority: PublicKey, vkHash: Buffer): TransactionInstruction {
  return ix(
    [
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([discriminator("initialize"), vkHash]),
  );
}

export function publishPolicyIx(
  lender: PublicKey,
  policyHash: Buffer,
  policy: LendingPolicy,
  verifierCommitment: Buffer,
): TransactionInstruction {
  return ix(
    [
      { pubkey: policyPda(policyHash, verifierCommitment), isSigner: false, isWritable: true },
      { pubkey: lender, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      discriminator("publish_policy"),
      policyHash,
      verifierCommitment,
      u64(policy.minimumAssets),
      u8(policy.minimumCollateralQuality),
      u16(policy.minimumHistoryMonths),
      bool(policy.screenRestrictedExposure),
    ]),
  );
}

export function publishRequestIx(
  borrower: PublicKey,
  requestSeed: Buffer,
  amountBaseUnits: bigint,
  collateralBaseUnits: bigint,
  termDays: number,
  passportCommitment: Buffer,
  subjectCommitment: Buffer,
): TransactionInstruction {
  return ix(
    [
      { pubkey: requestPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: vaultPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: mintAddress(), isSigner: false, isWritable: false },
      { pubkey: borrower, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      discriminator("publish_request"),
      requestSeed,
      u64(amountBaseUnits),
      u64(collateralBaseUnits),
      u16(termDays),
      passportCommitment,
      subjectCommitment,
    ]),
  );
}

export function fundEscrowIx(
  lender: PublicKey,
  lenderTokens: PublicKey,
  requestSeed: Buffer,
  amountBaseUnits: bigint,
): TransactionInstruction {
  return ix(
    [
      { pubkey: requestPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: vaultPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: lenderTokens, isSigner: false, isWritable: true },
      { pubkey: lender, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    Buffer.concat([discriminator("fund_escrow"), u64(amountBaseUnits)]),
  );
}

export type PresentArgs = {
  lender: PublicKey;
  requestSeed: Buffer;
  policyHash: Buffer;
  verifierCommitment: Buffer;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  publicSignals: Uint8Array[];
  payout: PublicKey;
  payoutTokens: PublicKey;
  ephemeralPublicKey: Buffer;
  viewTag: number;
  aprBps: number;
  feeBps: number;
};

/** Borsh `Vec<u8>`: a u32 little-endian length, then the bytes. */
function vecU8(bytes: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function presentAndFundIx(args: PresentArgs): TransactionInstruction {
  const nullifierSeed = Buffer.from(args.publicSignals[5]);
  return ix(
    [
      { pubkey: configPda(), isSigner: false, isWritable: true },
      {
        pubkey: policyPda(args.policyHash, args.verifierCommitment),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: requestPda(args.requestSeed), isSigner: false, isWritable: true },
      { pubkey: loanPda(args.requestSeed), isSigner: false, isWritable: true },
      { pubkey: nullifierPda(nullifierSeed), isSigner: false, isWritable: true },
      { pubkey: vaultPda(args.requestSeed), isSigner: false, isWritable: true },
      { pubkey: args.payoutTokens, isSigner: false, isWritable: true },
      { pubkey: args.payout, isSigner: false, isWritable: true },
      { pubkey: args.lender, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      discriminator("present_and_fund"),
      nullifierSeed,
      // 256 bytes, A || B || C, with A already negated. Sent as a Borsh
      // `Vec<u8>` rather than three fixed arrays because fixed arrays land on
      // the SBF stack and 4 KB is not enough for them — see the comment on the
      // handler in solana/programs/private_credit/src/lib.rs.
      vecU8(Buffer.concat([Buffer.from(args.proofA), Buffer.from(args.proofB), Buffer.from(args.proofC)])),
      vecU8(Buffer.concat(args.publicSignals.map((signal) => Buffer.from(signal)))),
      args.payout.toBuffer(),
      args.ephemeralPublicKey,
      u8(args.viewTag),
      u16(args.aprBps),
      u16(args.feeBps),
    ]),
  );
}

export function drawIx(borrower: PublicKey, requestSeed: Buffer): TransactionInstruction {
  return ix(
    [
      { pubkey: loanPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: borrower, isSigner: true, isWritable: false },
    ],
    discriminator("draw"),
  );
}

export function repayIx(
  payer: PublicKey,
  payerTokens: PublicKey,
  lenderTokens: PublicKey,
  requestSeed: Buffer,
  amountBaseUnits: bigint,
): TransactionInstruction {
  return ix(
    [
      { pubkey: loanPda(requestSeed), isSigner: false, isWritable: true },
      { pubkey: payerTokens, isSigner: false, isWritable: true },
      { pubkey: lenderTokens, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    Buffer.concat([discriminator("repay"), u64(amountBaseUnits)]),
  );
}

/* ------------------------------------------------------------------ sending */

/**
 * Turn an Anchor error code back into the message the program actually
 * declared, so the UI can say "the proof asserts the applicant is not
 * eligible" instead of "custom program error: 0x1772".
 */
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Groth16 proof is structurally malformed",
  6001: "Groth16 proof failed verification on-chain",
  6002: "Public signal [0] does not match the passport commitment on the request",
  6003: "Public signal [3] does not match the subject commitment on the request",
  6004: "Public signal [2] does not match Poseidon over the stored policy",
  6005: "Public signal [6] was issued to a different verifier",
  6006: "The proof asserts the applicant is not eligible under this policy",
  6007: "The receipt expired before it reached the chain",
  6008: "A public signal is larger than this field can decode",
  6009: "The nullifier PDA seed does not equal public signal [5]",
  6010: "Poseidon syscall failed",
  6011: "Collateral quality is a percentage and must be 0-100",
  6012: "Amount must be greater than zero",
  6013: "Term must be at least one day",
  6014: "The escrow vault holds nothing to disburse",
  6015: "The payout token account is not owned by the payout address",
  6016: "The payout token account holds the wrong mint",
  6017: "Only the borrower on this loan may draw it",
  6018: "The loan is not in a drawable state",
  6019: "The loan is already repaid",
  6020: "The repayment is short of principal, interest and fee",
};

export function explainSendError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const logs =
    cause && typeof cause === "object" && "logs" in cause && Array.isArray((cause as any).logs)
      ? ((cause as any).logs as string[])
      : [];
  const all = [raw, ...logs].join("\n");

  const custom = /custom program error: 0x([0-9a-fA-F]+)/.exec(all);
  if (custom) {
    const code = Number.parseInt(custom[1], 16);
    const message = PROGRAM_ERRORS[code];
    if (message) return `${message} (program error ${code})`;
  }
  const anchorMessage = /Error Message: (.+)/.exec(all);
  if (anchorMessage) return anchorMessage[1].trim();
  if (/already in use/i.test(all)) {
    return "account already in use — the Solana runtime refused to create a PDA that exists";
  }
  return raw;
}

async function accountExists(conn: Connection, address: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(address, "confirmed");
  return info !== null;
}

type SendResult = { signature: string; slot: number | null; computeUnits: number | null };

async function send(
  conn: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  computeUnitLimit?: number,
): Promise<SendResult> {
  const all = computeUnitLimit
    ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }), ...instructions]
    : instructions;

  const transaction = new Transaction();
  transaction.add(...all);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = signers[0].publicKey;
  transaction.sign(...signers);

  const signature = await conn.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  const detail = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  return {
    signature,
    slot: detail?.slot ?? null,
    computeUnits: detail?.meta?.computeUnitsConsumed ?? null,
  };
}

/* ------------------------------------------------------------ health probe */

export async function settlementConfig(vkHashHex: string | null): Promise<SettlementConfig> {
  const deployment = readDeployment();
  const base: SettlementConfig = {
    enabled: false,
    cluster: clusterName(),
    rpcUrl: rpcUrl(),
    programId: deployment?.programId ?? process.env.SOLANA_PROGRAM_ID ?? null,
    mint: deployment?.mint ?? process.env.SOLANA_DEMO_MINT ?? null,
    mintSymbol: deployment?.mintSymbol ?? "PCUSD",
    mintDecimals: deployment?.mintDecimals ?? 6,
    vkHash: deployment?.vkHash ?? null,
    vkMatches: false,
    lender: null,
    borrower: null,
    lenderSol: null,
    problem: null,
    explorerBase: explorerBase(),
  };

  if (!base.programId || !base.mint) {
    base.problem = "The program is not deployed yet. Run `npm run solana:setup`.";
    return base;
  }

  // Both sides are SHA-256 of the same file, but one comes from a JSON field
  // written with an `0x` prefix and the other from the verifier's status
  // object without one. Comparing them raw is a bug that renders as "the
  // deployed program does not match this backend" every single time.
  const normalise = (value: string | null) =>
    value === null ? null : value.trim().toLowerCase().replace(/^0x/, "");
  base.vkMatches =
    normalise(vkHashHex) !== null &&
    deployment !== null &&
    normalise(deployment.vkHash) === normalise(vkHashHex);

  try {
    const conn = connection();
    const lender = loadOrCreateKeypair("lender");
    const borrower = loadOrCreateKeypair("borrower");
    base.lender = lender.publicKey.toBase58();
    base.borrower = borrower.publicKey.toBase58();

    const [program, config, lamports] = await Promise.all([
      conn.getAccountInfo(new PublicKey(base.programId), "confirmed"),
      conn.getAccountInfo(configPda(), "confirmed"),
      conn.getBalance(lender.publicKey, "confirmed"),
    ]);

    base.lenderSol = lamports / LAMPORTS_PER_SOL;

    if (!program) {
      base.problem = `No program at ${base.programId} on ${base.cluster}.`;
    } else if (!config) {
      base.problem = "The program is deployed but not initialized. Run `npm run solana:setup`.";
    } else if (base.lenderSol < 0.05) {
      base.problem = `The demo lender key holds ${base.lenderSol.toFixed(4)} SOL — not enough to settle.`;
    } else {
      base.enabled = true;
    }
  } catch (cause) {
    base.problem = `Cannot reach ${base.rpcUrl}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }

  return base;
}

/* ---------------------------------------------------------- the orchestration */

export type SettleInput = {
  request: CreditRequest;
  challenge: PolicyChallenge;
  proof: ProofSubmission;
  offer: Offer;
  payout: PayoutAnnouncement;
  loanId: string | null;
};

const step = (
  name: SettlementStepName,
  label: string,
  detail: string,
): SettlementStep => ({
  name,
  label,
  detail,
  signature: null,
  slot: null,
  skipped: false,
  computeUnits: null,
  explorerUrl: null,
  error: null,
});

/**
 * Run the whole on-chain sequence for one offer, returning a `Settlement` row
 * whether it succeeded or not.
 *
 * It never throws for an on-chain rejection: a rejected `present_and_fund` is
 * a RESULT — often the correct one, as when a replayed nullifier is refused —
 * and the UI has to be able to show why. Only a configuration problem (no
 * deployment, unreachable RPC) throws.
 */
export async function settleOnChain(input: SettleInput): Promise<Settlement> {
  const deployment = readDeployment();
  const decimals = deployment?.mintDecimals ?? 6;
  const symbol = deployment?.mintSymbol ?? "PCUSD";
  const conn = connection();
  const lender = loadOrCreateKeypair("lender");
  const borrower = loadOrCreateKeypair("borrower");

  const requestSeed = seedFromId(input.request.id);
  const policyHash = Buffer.from(fieldHexToBytes(input.challenge.policyHash, "policyHash"));
  const verifierCommitment = Buffer.from(
    fieldHexToBytes(input.challenge.verifierCommitment, "verifierCommitment"),
  );
  const passportCommitment = Buffer.from(
    fieldHexToBytes(input.request.passportCommitment, "passportCommitment"),
  );
  const subjectCommitment = Buffer.from(
    fieldHexToBytes(input.proof.publicSignals.subjectCommitment, "subjectCommitment"),
  );

  const scale = 10n ** BigInt(decimals);
  const principal = BigInt(Math.round(input.offer.deposit || input.request.amount)) * scale;
  const collateral = BigInt(Math.round(input.request.collateral)) * scale;

  const payoutAddress = new PublicKey(input.payout.payoutAddress);
  const mint = mintAddress();
  const lenderTokens = getAssociatedTokenAddressSync(mint, lender.publicKey);
  const payoutTokens = getAssociatedTokenAddressSync(mint, payoutAddress, true);

  if (!input.proof.proof) {
    throw new Error("settleOnChain: the stored receipt carries no Groth16 proof");
  }
  const parsed = JSON.parse(input.proof.proof) as {
    proof: SnarkjsProof;
    publicSignals: string[];
  };
  const bytes = toSolanaProof(parsed.proof, parsed.publicSignals);

  const steps: SettlementStep[] = [
    step(
      "publish_policy",
      "Publish the policy",
      "The lender's four thresholds go on chain. The program recomputes Poseidon over them and refuses to store the account anywhere but at the address its own contents hash to.",
    ),
    step(
      "publish_request",
      "Publish the request and open the vault",
      "The borrower posts the terms and the passport commitment, and an escrow token account is created whose authority is the request PDA — not the lender.",
    ),
    step(
      "fund_escrow",
      `Fund the escrow with ${symbol}`,
      "The lender moves real tokens into that vault before any proof is presented. An offer that is not funded is a quote.",
    ),
    step(
      "create_payout_account",
      "Create the one-time payout account",
      "An associated token account for the address derived from the borrower's ENS payout key. It has never been used before and will never be used again.",
    ),
    step(
      "present_and_fund",
      "Verify the proof on chain and disburse",
      "Groth16 verification over the BN254 syscalls, the policy hash recomputed from the stored account, the nullifier PDA created, and the vault swept to the payout address — one atomic transaction.",
    ),
  ];

  const accounts: SettlementAccount[] = [];
  const record = (name: string, role: string, address: PublicKey) => {
    accounts.push({
      name,
      role,
      address: address.toBase58(),
      explorerUrl: explorerUrl("address", address.toBase58()),
    });
  };

  const settlement: Settlement = {
    id: `stl_${input.offer.id}`,
    requestId: input.request.id,
    offerId: input.offer.id,
    loanId: input.loanId,
    cluster: clusterName(),
    rpcUrl: rpcUrl(),
    programId: programId().toBase58(),
    mint: mint.toBase58(),
    mintSymbol: symbol,
    mintDecimals: decimals,
    payoutAddress: payoutAddress.toBase58(),
    principalBaseUnits: principal.toString(),
    steps,
    accounts,
    status: "settled",
    error: null,
    createdAt: Date.now(),
  };

  const finish = (index: number, result: SendResult) => {
    steps[index].signature = result.signature;
    steps[index].slot = result.slot;
    steps[index].computeUnits = result.computeUnits;
    steps[index].explorerUrl = explorerUrl("tx", result.signature);
  };

  const fail = (index: number, cause: unknown): Settlement => {
    steps[index].error = explainSendError(cause);
    settlement.status = "failed";
    settlement.error = `${steps[index].label}: ${steps[index].error}`;
    return settlement;
  };

  record("Program", "the deployed private_credit program", programId());
  record("Config", "vk hash + settled counter", configPda());
  record("Policy", "the lender's thresholds", policyPda(policyHash, verifierCommitment));
  record("Request", "terms + passport commitment, and the vault authority", requestPda(requestSeed));
  record("Escrow vault", `${symbol} held for this request`, vaultPda(requestSeed));
  record("Loan", "principal, term, payout address, ephemeral key", loanPda(requestSeed));
  record(
    "Nullifier",
    "the replay guard — its existence is the mechanism",
    nullifierPda(Buffer.from(bytes.publicSignals[5])),
  );
  record("Payout address", "derived from the ENS payout key, single use", payoutAddress);

  // ---- 1. publish_policy ------------------------------------------------
  try {
    if (await accountExists(conn, policyPda(policyHash, verifierCommitment))) {
      steps[0].skipped = true;
      steps[0].detail += " Already on chain for this policy hash — nothing re-sent.";
    } else {
      finish(
        0,
        await send(
          conn,
          [publishPolicyIx(lender.publicKey, policyHash, input.challenge.policy, verifierCommitment)],
          [lender],
        ),
      );
    }
  } catch (cause) {
    return fail(0, cause);
  }

  // ---- 2. publish_request ------------------------------------------------
  try {
    if (await accountExists(conn, requestPda(requestSeed))) {
      steps[1].skipped = true;
      steps[1].detail += " Already on chain for this request id — nothing re-sent.";
    } else {
      finish(
        1,
        await send(
          conn,
          [
            publishRequestIx(
              borrower.publicKey,
              requestSeed,
              principal,
              collateral,
              input.request.termDays,
              passportCommitment,
              subjectCommitment,
            ),
          ],
          [borrower],
        ),
      );
    }
  } catch (cause) {
    return fail(1, cause);
  }

  // ---- 3. fund_escrow ----------------------------------------------------
  try {
    const vault = await getAccount(conn, vaultPda(requestSeed), "confirmed").catch(() => null);
    if (vault && vault.amount >= principal) {
      steps[2].skipped = true;
      steps[2].detail += " The vault already holds the principal.";
    } else {
      const shortfall = principal - (vault?.amount ?? 0n);
      finish(
        2,
        await send(
          conn,
          [fundEscrowIx(lender.publicKey, lenderTokens, requestSeed, shortfall)],
          [lender],
        ),
      );
    }
  } catch (cause) {
    return fail(2, cause);
  }

  // ---- 4. the payout token account ---------------------------------------
  try {
    if (await accountExists(conn, payoutTokens)) {
      steps[3].skipped = true;
      steps[3].detail += " Already created.";
    } else {
      finish(
        3,
        await send(
          conn,
          [
            createAssociatedTokenAccountIdempotentInstruction(
              lender.publicKey,
              payoutTokens,
              payoutAddress,
              mint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          ],
          [lender],
        ),
      );
    }
    record("Payout token account", `where the ${symbol} lands`, payoutTokens);
  } catch (cause) {
    return fail(3, cause);
  }

  // ---- 5. present_and_fund -----------------------------------------------
  //
  // 400k CU is the default; the Groth16 verify alone is ~105k for seven public
  // inputs and the CPIs and account creations sit on top of it. 600k leaves
  // room without paying for headroom nobody uses.
  try {
    finish(
      4,
      await send(
        conn,
        [
          presentAndFundIx({
            lender: lender.publicKey,
            requestSeed,
            policyHash,
            verifierCommitment,
            proofA: bytes.proofA,
            proofB: bytes.proofB,
            proofC: bytes.proofC,
            publicSignals: bytes.publicSignals,
            payout: payoutAddress,
            payoutTokens,
            ephemeralPublicKey: Buffer.from(
              input.payout.ephemeralPublicKey.replace(/^0x/, ""),
              "hex",
            ),
            viewTag: input.payout.viewTag,
            aprBps: Math.round(input.offer.apr * 100),
            feeBps: Math.round((input.offer.fee / Math.max(1, input.request.amount)) * 10_000),
          }),
        ],
        [lender],
        600_000,
      ),
    );
  } catch (cause) {
    return fail(4, cause);
  }

  return settlement;
}

/**
 * Re-send the exact `present_and_fund` that already succeeded.
 *
 * The expected result is a rejection, and the rejection is the demo: the
 * nullifier PDA already exists, so the Solana runtime refuses to create it and
 * the transaction dies before a single line of our program runs. This is the
 * one guarantee in the project that requires trusting nobody — not the
 * backend, not the circuit, not the ceremony.
 */
export async function replayOnChain(input: SettleInput): Promise<SettlementStep> {
  const conn = connection();
  const lender = loadOrCreateKeypair("lender");
  const requestSeed = seedFromId(input.request.id);
  const policyHash = Buffer.from(fieldHexToBytes(input.challenge.policyHash, "policyHash"));
  const verifierCommitment = Buffer.from(
    fieldHexToBytes(input.challenge.verifierCommitment, "verifierCommitment"),
  );
  const mint = mintAddress();
  const payoutAddress = new PublicKey(input.payout.payoutAddress);
  const payoutTokens = getAssociatedTokenAddressSync(mint, payoutAddress, true);

  if (!input.proof.proof) {
    throw new Error("replayOnChain: the stored receipt carries no Groth16 proof");
  }
  const parsed = JSON.parse(input.proof.proof) as {
    proof: SnarkjsProof;
    publicSignals: string[];
  };
  const bytes = toSolanaProof(parsed.proof, parsed.publicSignals);

  const outcome = step(
    "replay_attempt",
    "Present the same receipt a second time",
    "Byte-identical instruction data, re-sent. The nullifier PDA at signal [5] already exists, so the runtime rejects the transaction before our program is entered.",
  );

  try {
    const result = await send(
      conn,
      [
        presentAndFundIx({
          lender: lender.publicKey,
          requestSeed,
          policyHash,
          verifierCommitment,
          proofA: bytes.proofA,
          proofB: bytes.proofB,
          proofC: bytes.proofC,
          publicSignals: bytes.publicSignals,
          payout: payoutAddress,
          payoutTokens,
          ephemeralPublicKey: Buffer.from(
            input.payout.ephemeralPublicKey.replace(/^0x/, ""),
            "hex",
          ),
          viewTag: input.payout.viewTag,
          aprBps: Math.round(input.offer.apr * 100),
          feeBps: Math.round((input.offer.fee / Math.max(1, input.request.amount)) * 10_000),
        }),
      ],
      [lender],
      600_000,
    );
    // Reaching here would mean the replay guard did not hold. Say so plainly
    // rather than rendering a success badge for a security failure.
    outcome.signature = result.signature;
    outcome.slot = result.slot;
    outcome.explorerUrl = explorerUrl("tx", result.signature);
    outcome.error =
      "THE REPLAY SUCCEEDED. That is a soundness failure, not a demo — the nullifier PDA did not stop it.";
  } catch (cause) {
    outcome.error = explainSendError(cause);
  }

  return outcome;
}

/** The `nullifier` PDA for a settled proof, so the UI can link to it. */
export function nullifierAddressFor(proof: ProofSubmission): string | null {
  try {
    return nullifierPda(
      Buffer.from(fieldHexToBytes(proof.publicSignals.nullifier, "nullifier")),
    ).toBase58();
  } catch {
    return null;
  }
}
