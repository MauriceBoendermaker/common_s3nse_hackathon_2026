/**
 * scripts/solana-setup.mjs — make a deployed `private_credit` program usable.
 *
 * Idempotent. Run it as often as you like; it only does what is missing.
 *
 *   1. create the three demo keypairs in `.solana/` if they do not exist
 *   2. fund them (airdrop on localnet, faucet-with-a-warning elsewhere)
 *   3. create the settlement mint and give the lender a supply of it
 *   4. call `initialize` with the SHA-256 of the verifying key
 *   5. write `.solana/deployment.json`, which is what the backend reads
 *
 * WHY A MINT WE CONTROL. Devnet USDC exists, but obtaining it needs Circle's
 * faucet and one more thing that can be down at 3am. The settlement leg is
 * about escrow, proof verification and disbursement — none of which care which
 * SPL mint moves — so this creates one, calls it PCUSD, and the UI says
 * plainly that it is a demo mint on a test cluster rather than implying it is
 * real USDC. Swap `--mint <address>` in to settle against any existing mint
 * the lender key holds a balance of.
 *
 * Usage:
 *   node scripts/solana-setup.mjs
 *   node scripts/solana-setup.mjs --cluster devnet
 *   node scripts/solana-setup.mjs --mint <existing mint address>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const keyDir = path.join(root, ".solana");

const CLUSTER_URLS = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

const MINT_SYMBOL = "PCUSD";
const MINT_DECIMALS = 6;
/** 50 million units. Enough for every demo run without ever re-minting. */
const LENDER_SUPPLY = 50_000_000n * 10n ** BigInt(MINT_DECIMALS);

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

function loadOrCreateKeypair(role) {
  fs.mkdirSync(keyDir, { recursive: true });
  const file = path.join(keyDir, `${role}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify([...keypair.secretKey]));
  console.log(`  created .solana/${role}.json`);
  return keypair;
}

function programIdFromArtifacts() {
  const file = path.join(root, "solana", "target", "deploy", "private_credit-keypair.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "No program keypair at solana/target/deploy/private_credit-keypair.json — run `npm run solana:build` first.",
    );
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

function vkHashHex() {
  const file = path.join(root, "zk", "build", "vk_hash.json");
  if (!fs.existsSync(file)) {
    throw new Error("No zk/build/vk_hash.json — run `node zk/emit-program-vk.mjs` first.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8")).vkHashHex;
}

async function ensureFunded(connection, cluster, keypair, role, wantSol) {
  const lamports = await connection.getBalance(keypair.publicKey, "confirmed");
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= wantSol) {
    console.log(`  ${role.padEnd(9)} ${keypair.publicKey.toBase58()}  ${sol.toFixed(4)} SOL`);
    return sol;
  }

  try {
    const signature = await connection.requestAirdrop(
      keypair.publicKey,
      Math.ceil(wantSol - sol) * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(signature, "confirmed");
  } catch (cause) {
    console.log(
      `  ${role.padEnd(9)} ${keypair.publicKey.toBase58()}  ${sol.toFixed(4)} SOL  ` +
        `(airdrop failed: ${cause.message ?? cause})`,
    );
    return sol;
  }

  // Never trust the airdrop response. BACKEND_PLAN.md §4E records a devnet
  // probe where the faucet returned a finalized signature with err: null while
  // the balance stayed at zero — the transaction was a bare Memo and the
  // target was not even in accountKeys. Read the balance back.
  const after = (await connection.getBalance(keypair.publicKey, "confirmed")) / LAMPORTS_PER_SOL;
  console.log(`  ${role.padEnd(9)} ${keypair.publicKey.toBase58()}  ${after.toFixed(4)} SOL`);
  return after;
}

async function main() {
  const cluster = flag("cluster", process.env.SOLANA_SETTLE_CLUSTER ?? "localnet");
  const rpcUrl = flag("rpc", process.env.SOLANA_SETTLE_RPC ?? CLUSTER_URLS[cluster]);
  if (!rpcUrl) throw new Error(`Unknown cluster "${cluster}" and no --rpc given.`);

  const connection = new Connection(rpcUrl, "confirmed");
  const program = programIdFromArtifacts();

  console.log(`cluster:  ${cluster} (${rpcUrl})`);
  console.log(`program:  ${program.toBase58()}\n`);

  // ---- 1 + 2. keys and SOL ------------------------------------------------
  const deployer = loadOrCreateKeypair("deployer");
  const lender = loadOrCreateKeypair("lender");
  const borrower = loadOrCreateKeypair("borrower");

  console.log("balances:");
  const deployerSol = await ensureFunded(connection, cluster, deployer, "deployer", 3);
  const lenderSol = await ensureFunded(connection, cluster, lender, "lender", 2);
  const borrowerSol = await ensureFunded(connection, cluster, borrower, "borrower", 1);
  console.log("");

  if (deployerSol + lenderSol + borrowerSol === 0) {
    console.error("NO SOL. Nothing below can run. Fund the deployer address from");
    console.error("https://faucet.solana.com (GitHub login) and re-run.");
    process.exit(1);
  }

  // ---- program presence ---------------------------------------------------
  const programAccount = await connection.getAccountInfo(program, "confirmed");
  if (!programAccount) {
    console.error(`No program deployed at ${program.toBase58()} on ${cluster}.`);
    console.error("Deploy it first:  npm run solana:deploy" + (cluster === "localnet" ? "" : ` -- --cluster ${cluster}`));
    process.exit(1);
  }
  console.log(`program account: ${programAccount.data.length} bytes, executable=${programAccount.executable}`);

  // ---- 3. the settlement mint --------------------------------------------
  const existing = fs.existsSync(path.join(keyDir, "deployment.json"))
    ? JSON.parse(fs.readFileSync(path.join(keyDir, "deployment.json"), "utf8"))
    : null;

  let mint = flag("mint", null) ?? existing?.mint ?? null;
  let mintKey = mint ? new PublicKey(mint) : null;

  if (mintKey && !(await connection.getAccountInfo(mintKey, "confirmed"))) {
    console.log(`  mint ${mint} does not exist on ${cluster} — creating a fresh one`);
    mintKey = null;
  }

  if (!mintKey) {
    mintKey = await createMint(
      connection,
      deployer,
      deployer.publicKey,
      null,
      MINT_DECIMALS,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );
    console.log(`  created mint ${mintKey.toBase58()} (${MINT_SYMBOL}, ${MINT_DECIMALS} decimals)`);
  } else {
    console.log(`  mint ${mintKey.toBase58()} already exists`);
  }

  const lenderTokens = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    mintKey,
    lender.publicKey,
    { commitment: "confirmed" },
  );
  const balance = await getAccount(connection, lenderTokens, "confirmed");
  if (balance.amount < LENDER_SUPPLY / 2n) {
    await mintTo(
      connection,
      deployer,
      mintKey,
      lenderTokens,
      deployer,
      LENDER_SUPPLY,
      [],
      { commitment: "confirmed" },
    );
    console.log(`  minted ${LENDER_SUPPLY / 10n ** BigInt(MINT_DECIMALS)} ${MINT_SYMBOL} to the lender`);
  } else {
    console.log(
      `  lender already holds ${balance.amount / 10n ** BigInt(MINT_DECIMALS)} ${MINT_SYMBOL}`,
    );
  }

  // ---- 4. initialize ------------------------------------------------------
  //
  // The adapter reads the program id from the environment, so it is set before
  // the dynamic import rather than after: static imports hoist, and a
  // top-level import here would run `programId()` against a deployment.json
  // that does not exist yet on a first run.
  process.env.SOLANA_PROGRAM_ID = program.toBase58();
  process.env.SOLANA_SETTLE_CLUSTER = cluster;
  process.env.SOLANA_SETTLE_RPC = rpcUrl;
  const settlement = await import("../backend/src/adapters/solanaSettlement.ts");

  const vkHex = vkHashHex();
  const configPda = settlement.configPda();
  const configAccount = await connection.getAccountInfo(configPda, "confirmed");

  if (configAccount) {
    console.log(`  config ${configPda.toBase58()} already initialized`);
  } else {
    const transaction = new Transaction().add(
      settlement.initializeIx(deployer.publicKey, Buffer.from(vkHex.replace(/^0x/, ""), "hex")),
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = deployer.publicKey;
    transaction.sign(deployer);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log(`  initialize: ${signature}`);
  }

  // ---- 5. deployment.json -------------------------------------------------
  const deployment = {
    cluster,
    rpcUrl,
    programId: program.toBase58(),
    mint: mintKey.toBase58(),
    mintSymbol: MINT_SYMBOL,
    mintDecimals: MINT_DECIMALS,
    vkHash: vkHex,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(keyDir, "deployment.json"),
    JSON.stringify(deployment, null, 2) + "\n",
  );

  console.log("\nwrote .solana/deployment.json");
  console.log(JSON.stringify(deployment, null, 2));
  console.log("\nlender token account:", lenderTokens.toBase58());
  console.log("config PDA:          ", configPda.toBase58());
}

await main();
