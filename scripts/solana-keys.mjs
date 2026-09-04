/**
 * scripts/solana-keys.mjs — create, inspect and fund the devnet identities.
 *
 * Three keypairs, and they are three on purpose rather than one:
 *
 *   deployer  pays for the program deployment and holds the upgrade authority
 *   lender    signs `publish_policy`, `fund_escrow` and `present_and_fund`
 *   borrower  signs `publish_request` and `draw`
 *
 * The two party keys exist so the on-chain history shows two distinct
 * identities doing two distinct jobs. Collapsing them into one signer would
 * make every account on the explorer trace back to the same pubkey, and the
 * "two parties" claim would be exactly as decorative on-chain as the shared
 * `useState` made it in the UI before workstream A.
 *
 * HONESTY, stated here and in the UI: these are demo custodial keys held by
 * the backend. In production the lender signs in their own wallet. A judge
 * should not have to install Phantom and win a faucet lottery to see the
 * protocol work, so the demo signs server-side and says so on screen — every
 * transaction is still a real devnet transaction with a real signature you can
 * open in the explorer.
 *
 * Usage:
 *   node scripts/solana-keys.mjs                 # create if missing, print status
 *   node scripts/solana-keys.mjs --airdrop       # also try the devnet faucet
 *   node scripts/solana-keys.mjs --cluster testnet
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
export const KEY_DIR = path.join(root, ".solana");

export const CLUSTER_URLS = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

export const ROLES = ["deployer", "lender", "borrower"];

/** Read a keypair from disk, creating it on first use. */
export function loadOrCreateKeypair(role) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const file = path.join(KEY_DIR, `${role}.json`);
  if (fs.existsSync(file)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
    return Keypair.fromSecretKey(secret);
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify([...keypair.secretKey]));
  return keypair;
}

/**
 * Verify a balance actually landed rather than trusting the RPC's answer to
 * `requestAirdrop`.
 *
 * BACKEND_PLAN.md §4E records a probe where the faucet returned a signature
 * that reached `finalized` with `err: null` while the balance stayed at zero —
 * the transaction was a bare Memo with the target not even in `accountKeys`.
 * So the only trustworthy check is the balance itself, read afterwards.
 */
export async function balanceSol(connection, pubkey) {
  const lamports = await connection.getBalance(new PublicKey(pubkey), "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

async function main() {
  const args = process.argv.slice(2);
  const clusterArg = args.includes("--cluster")
    ? args[args.indexOf("--cluster") + 1]
    : "devnet";
  const cluster = clusterArg in CLUSTER_URLS ? clusterArg : "devnet";
  const connection = new Connection(CLUSTER_URLS[cluster], "confirmed");

  const keys = Object.fromEntries(ROLES.map((role) => [role, loadOrCreateKeypair(role)]));

  console.log(`cluster: ${cluster} (${CLUSTER_URLS[cluster]})`);
  console.log(`keys:    ${KEY_DIR}\n`);

  if (args.includes("--airdrop")) {
    for (const role of ROLES) {
      const want = role === "deployer" ? 2 : 1;
      try {
        const signature = await connection.requestAirdrop(
          keys[role].publicKey,
          want * LAMPORTS_PER_SOL,
        );
        await connection.confirmTransaction(signature, "confirmed");
        console.log(`  airdrop ${role}: ${signature}`);
      } catch (cause) {
        console.log(`  airdrop ${role}: FAILED — ${cause.message ?? cause}`);
      }
    }
    console.log("");
  }

  let total = 0;
  for (const role of ROLES) {
    const sol = await balanceSol(connection, keys[role].publicKey);
    total += sol;
    console.log(
      `  ${role.padEnd(9)} ${keys[role].publicKey.toBase58()}  ${sol.toFixed(4)} SOL`,
    );
  }

  console.log("");
  if (total === 0) {
    console.log("NO SOL ANYWHERE. Deployment costs ~0.63 SOL and cannot proceed.");
    console.log("Fund the deployer address above from any of:");
    console.log("  https://faucet.solana.com          (GitHub login, most reliable)");
    console.log("  https://faucet.quicknode.com/solana/devnet");
    console.log("  a wallet you already have devnet SOL in");
    process.exitCode = 1;
  } else {
    console.log(`total ${total.toFixed(4)} SOL`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
