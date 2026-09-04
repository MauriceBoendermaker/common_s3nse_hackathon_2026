/**
 * ENS write path - a HUMAN-RUN CLI, never called by the app.
 *
 *   SEPOLIA_PRIVATE_KEY=0x... node scripts/ens-setup.mjs --check
 *   SEPOLIA_PRIVATE_KEY=0x... node scripts/ens-setup.mjs --register --name privatecredit.eth --yes
 *   SEPOLIA_PRIVATE_KEY=0x... node scripts/ens-setup.mjs --set-text --name privatecredit.eth --yes
 *                             node scripts/ens-setup.mjs --verify   --name privatecredit.eth
 *
 * This is the only thing in the repo that can spend ETH, which is exactly why
 * it is a separate script rather than a code path in the app:
 *
 *   - the key comes from the environment ONLY. Never a file, never a flag
 *     (flags land in shell history), never committed;
 *   - every stage is explicit. With no stage flag it does nothing but report;
 *   - every write prints the estimated gas and the exact ETH cost FIRST and
 *     then waits for you to type "yes" (or for an explicit --yes);
 *   - it deploys nothing. `--register` and `--set-text` call ENS's own
 *     already-deployed Sepolia contracts.
 *
 * Stages, safe to run one at a time and safe to re-run:
 *   --check      read-only: balance, availability, price, current record
 *   --register   commit -> wait minCommitmentAge -> register (two txs, ~90 s)
 *   --set-text   setText the X25519 payout key on the PublicResolver
 *   --verify     read the record back with text() and print PASS / FAIL
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  namehash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  ENS_CHAIN,
  ENS_PUBLIC_RESOLVER,
  ENS_REGISTRY,
  ETH_REGISTRAR_CONTROLLER,
  SEPOLIA_RPC_URL,
} from "../frontend/src/shared/ensClient.ts";
import {
  PAYOUT_KEY_SIGN_MESSAGE,
  PAYOUT_RECORD_KEY,
  bytesToHex0x,
  decodePayoutRecord,
  deriveViewingKeypair,
  encodePayoutRecord,
} from "../frontend/src/shared/ensPayout.ts";

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

/* ------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
function value(flag, fallback) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const NAME = value("--name", process.env.ENS_NAME ?? "privatecredit.eth").trim().toLowerCase();
const LABEL = NAME.replace(/\.eth$/i, "");
const YEARS = Number(value("--years", "1"));
const DURATION = BigInt(Math.round(YEARS * 31_536_000));
const ASSUME_YES = has("--yes");
const WANT_REVERSE = has("--reverse");
const RESUME_SECRET = value("--secret", null);

const STAGES = {
  check: has("--check") || argv.length === 0,
  register: has("--register"),
  setText: has("--set-text"),
  verify: has("--verify"),
};

if (LABEL.includes(".")) {
  console.error(`--name must be a second-level .eth name, got "${NAME}"`);
  process.exit(2);
}
if (!Number.isFinite(YEARS) || YEARS < 1) {
  console.error("--years must be at least 1 (the registrar's minimum duration)");
  process.exit(2);
}

const NODE = namehash(NAME);

/* ------------------------------------------------------------- abis */

const registryAbi = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { name: "resolver", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
];

const resolverAbi = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }],
    outputs: [{ type: "string" }],
  },
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
];

/**
 * The 8-argument ETHRegistrarController. Confirmed against the deployed
 * bytecode at 0xFED6a9...65B72: the selector for the 9-argument (referrer)
 * variant is NOT present, so do not "upgrade" this ABI without re-checking.
 */
const controllerAbi = [
  { name: "available", type: "function", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  {
    name: "rentPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }, { name: "duration", type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "base", type: "uint256" }, { name: "premium", type: "uint256" }] }],
  },
  { name: "minCommitmentAge", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxCommitmentAge", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "commitments", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  {
    name: "makeCommitment",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { name: "commit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "commitment", type: "bytes32" }], outputs: [] },
  {
    name: "register",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [],
  },
];

/* ------------------------------------------------------------- clients */

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL, { timeout: 30_000 }),
});

/**
 * The key is read here and nowhere else. It is never printed, never written to
 * disk, and never sent anywhere but the local signer.
 */
function loadAccount() {
  const raw = process.env.SEPOLIA_PRIVATE_KEY;
  if (!raw) {
    console.error(THIN);
    console.error("SEPOLIA_PRIVATE_KEY is not set.");
    console.error("");
    console.error("  PowerShell : $env:SEPOLIA_PRIVATE_KEY = '0x<64 hex>'");
    console.error("  bash       : export SEPOLIA_PRIVATE_KEY=0x<64 hex>");
    console.error("");
    console.error("Use a THROWAWAY Sepolia key. Never pass it as a command-line flag:");
    console.error("flags are recorded in shell history and in process listings.");
    console.error(THIN);
    process.exit(2);
  }
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("SEPOLIA_PRIVATE_KEY must be 32 bytes of hex (64 characters, 0x optional).");
    process.exit(2);
  }
  return privateKeyToAccount(key);
}

function walletFor(account) {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL, { timeout: 30_000 }),
  });
}

/* ------------------------------------------------------------- helpers */

async function confirm(question) {
  if (ASSUME_YES) {
    console.log(`   ${question} -> --yes given, proceeding`);
    return true;
  }
  if (!stdin.isTTY) {
    console.log(`   ${question} -> refusing: no TTY to confirm on. Re-run with --yes if you mean it.`);
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`   ${question} type "yes" to proceed: `)).trim().toLowerCase();
  rl.close();
  return answer === "yes";
}

/** Wei -> gwei, 3 decimals. Display only. */
function formatGwei(wei) {
  return (Number(wei) / 1e9).toFixed(3);
}

/** Estimated worst-case cost of one transaction, printed BEFORE it is sent. */
async function quote(label, params, valueWei = 0n) {
  const gas = await publicClient.estimateContractGas(params);
  const fees = await publicClient.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas ?? (await publicClient.getGasPrice());
  const gasCost = gas * maxFee;
  console.log(`   ${label}`);
  console.log(`     gas estimate   ${gas}`);
  console.log(`     max fee/gas    ${formatGwei(maxFee)} gwei`);
  console.log(`     gas cost       ${formatEther(gasCost)} ETH`);
  if (valueWei > 0n) console.log(`     value sent     ${formatEther(valueWei)} ETH (excess is refunded)`);
  console.log(`     TOTAL          ${formatEther(gasCost + valueWei)} ETH`);
  return { gas, maxFee, gasCost };
}

async function sendAndWait(walletClient, params, label) {
  const hash = await walletClient.writeContract(params);
  console.log(`   ${label} tx ${hash}`);
  console.log(`     ${ENS_CHAIN.explorer}/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(
    `     status ${receipt.status}  block ${receipt.blockNumber}  gas used ${receipt.gasUsed}`,
  );
  if (receipt.status !== "success") {
    console.error(`   ${label} REVERTED - stopping.`);
    process.exit(1);
  }
  return receipt;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- payout key */

/**
 * `personal_sign` over the fixed message, then HKDF -> X25519. Deterministic:
 * the same key always yields the same payout keypair, on any machine, with
 * nothing stored. That is the whole point of deriving instead of generating.
 */
async function derivePayoutKey(account) {
  const signature = await account.signMessage({ message: PAYOUT_KEY_SIGN_MESSAGE });
  const keypair = deriveViewingKeypair(signature);
  return { keypair, record: encodePayoutRecord(keypair.publicKey) };
}

/* ------------------------------------------------------------- run */

console.log(RULE);
console.log(`ENS setup - ${NAME} on ${ENS_CHAIN.name} (chain id ${ENS_CHAIN.id})`);
console.log(RULE);
console.log(`node          ${NODE}`);
console.log(`registry      ${ENS_REGISTRY}`);
console.log(`resolver      ${ENS_PUBLIC_RESOLVER}`);
console.log(`controller    ${ETH_REGISTRAR_CONTROLLER}`);
console.log(`record key    ${PAYOUT_RECORD_KEY}`);
console.log(
  `stages        ${Object.entries(STAGES).filter(([, on]) => on).map(([k]) => k).join(", ") || "(none)"}`,
);
console.log();

const needsKey = STAGES.register || STAGES.setText || STAGES.check;
const account = needsKey ? loadAccount() : null;
let payout = null;

if (account) {
  console.log(`account       ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`balance       ${formatEther(balance)} ETH`);
  payout = await derivePayoutKey(account);
  console.log(`payout X25519 ${bytesToHex0x(payout.keypair.publicKey)}`);
  console.log(`record value  ${payout.record}`);
  console.log();
  if (balance === 0n && (STAGES.register || STAGES.setText)) {
    console.error("Balance is zero - fund this address from a Sepolia faucet before writing.");
    process.exit(1);
  }
}

/* ---------------------------------------------------------- stage: check */

const owner = await publicClient.readContract({
  address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [NODE],
});
const currentResolver = await publicClient.readContract({
  address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [NODE],
});
const available = await publicClient.readContract({
  address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "available", args: [LABEL],
});
const price = await publicClient.readContract({
  address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "rentPrice", args: [LABEL, DURATION],
});
const rent = price.base + price.premium;

console.log(THIN);
console.log("CHECK");
console.log(THIN);
console.log(`   registry owner(node)     ${owner}`);
console.log(`   registry resolver(node)  ${currentResolver}`);
console.log(`   available                ${available}`);
console.log(`   rentPrice ${(YEARS + "y").padEnd(14)} ${formatEther(rent)} ETH  (base ${formatEther(price.base)} + premium ${formatEther(price.premium)})`);

if (currentResolver !== "0x0000000000000000000000000000000000000000") {
  const existing = await publicClient.readContract({
    address: currentResolver, abi: resolverAbi, functionName: "text", args: [NODE, PAYOUT_RECORD_KEY],
  });
  const decoded = decodePayoutRecord(existing);
  console.log(`   current payout record    ${existing ? JSON.stringify(existing) : "(empty - not set)"}`);
  if (decoded.error && existing) console.log(`     -> unusable: ${decoded.error}`);
}
console.log();

/* -------------------------------------------------------- stage: register */

if (STAGES.register) {
  console.log(THIN);
  console.log("REGISTER (commit -> wait -> register)");
  console.log(THIN);
  if (!available) {
    console.log(`   ${NAME} is NOT available. Nothing to do.`);
  } else {
    const walletClient = walletFor(account);
    const minAge = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "minCommitmentAge", args: [],
    });
    const maxAge = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "maxCommitmentAge", args: [],
    });

    // The secret is what binds the commitment to this registration. Losing it
    // between the two transactions loses the commit fee, so it is printed and
    // can be supplied again with --secret to resume.
    const secret = RESUME_SECRET ?? bytesToHex0x(crypto.getRandomValues(new Uint8Array(32)));
    if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) {
      console.error(`   --secret must be 32 bytes of hex, got "${secret}"`);
      process.exit(2);
    }

    // Set the payout record in the SAME transaction as the registration: one
    // fee, and the name is never live without the record the protocol needs.
    const setTextData = encodeFunctionData({
      abi: resolverAbi,
      functionName: "setText",
      args: [NODE, PAYOUT_RECORD_KEY, payout.record],
    });
    const registerArgs = [
      LABEL,
      account.address,
      DURATION,
      secret,
      ENS_PUBLIC_RESOLVER,
      [setTextData],
      WANT_REVERSE,
      0,
    ];

    const commitment = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "makeCommitment", args: registerArgs,
    });
    console.log(`   secret       ${secret}`);
    console.log(`     KEEP THIS. Re-run with --secret <that value> to resume after the commit.`);
    console.log(`   commitment   ${commitment}`);
    console.log(`   reverse rec  ${WANT_REVERSE}`);
    console.log(`   embedded     setText(${PAYOUT_RECORD_KEY}) in the registration tx`);
    console.log();

    const existingCommit = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "commitments", args: [commitment],
    });

    if (existingCommit === 0n) {
      const commitParams = {
        account, address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi,
        functionName: "commit", args: [commitment],
      };
      await quote("tx 1 of 2 - commit(commitment)", commitParams);
      if (!(await confirm("Send the commit transaction?"))) {
        console.log("   aborted, nothing sent.");
        process.exit(0);
      }
      await sendAndWait(walletClient, commitParams, "commit");
    } else {
      console.log(`   commitment already on chain at timestamp ${existingCommit} - skipping commit`);
    }

    // The controller enforces minCommitmentAge; a few seconds of slack absorbs
    // block-timestamp jitter, and maxCommitmentAge is the deadline on the far
    // side of the wait.
    const waitSeconds = Number(minAge) + 15;
    console.log(`   waiting ${waitSeconds}s for minCommitmentAge (${minAge}s, max ${maxAge}s)...`);
    await sleep(waitSeconds * 1000);

    // Re-price: the premium decays, so quote again rather than trusting the
    // number printed a minute ago. 10% buffer, refunded by the controller.
    const freshPrice = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi, functionName: "rentPrice", args: [LABEL, DURATION],
    });
    const valueWei = ((freshPrice.base + freshPrice.premium) * 110n) / 100n;

    const registerParams = {
      account, address: ETH_REGISTRAR_CONTROLLER, abi: controllerAbi,
      functionName: "register", args: registerArgs, value: valueWei,
    };
    await quote("tx 2 of 2 - register(...)", registerParams, valueWei);
    if (!(await confirm(`Register ${NAME} for ${YEARS} year(s)?`))) {
      console.log("   aborted. The commitment stays valid until maxCommitmentAge; resume with --secret.");
      process.exit(0);
    }
    await sendAndWait(walletClient, registerParams, "register");
    console.log(`   ${NAME} registered to ${account.address}`);
  }
  console.log();
}

/* -------------------------------------------------------- stage: set-text */

if (STAGES.setText) {
  console.log(THIN);
  console.log("SET-TEXT");
  console.log(THIN);
  const resolverNow = await publicClient.readContract({
    address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [NODE],
  });
  if (resolverNow === "0x0000000000000000000000000000000000000000") {
    console.error(`   ${NAME} has no resolver set. Register it first, or set a resolver in the ENS app.`);
    process.exit(1);
  }
  console.log(`   resolver     ${resolverNow}`);
  console.log(`   key          ${PAYOUT_RECORD_KEY}`);
  console.log(`   value        ${payout.record}`);

  const params = {
    account, address: resolverNow, abi: resolverAbi,
    functionName: "setText", args: [NODE, PAYOUT_RECORD_KEY, payout.record],
  };
  await quote("setText(node, key, value)", params);
  if (!(await confirm("Write the payout key to the resolver?"))) {
    console.log("   aborted, nothing sent.");
    process.exit(0);
  }
  await sendAndWait(walletFor(account), params, "setText");
  console.log();
}

/* ---------------------------------------------------------- stage: verify */

if (STAGES.verify || STAGES.register || STAGES.setText) {
  console.log(THIN);
  console.log("VERIFY - read the record back with a direct text() call");
  console.log(THIN);
  const resolverNow = await publicClient.readContract({
    address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [NODE],
  });
  if (resolverNow === "0x0000000000000000000000000000000000000000") {
    console.log(`   FAIL  ${NAME} has no resolver on ${ENS_CHAIN.name}`);
    process.exit(1);
  }
  const readBack = await publicClient.readContract({
    address: resolverNow, abi: resolverAbi, functionName: "text", args: [NODE, PAYOUT_RECORD_KEY],
  });
  const decoded = decodePayoutRecord(readBack);
  const block = await publicClient.getBlockNumber();

  console.log(`   block        ${block}`);
  console.log(`   name         ${NAME}`);
  console.log(`   node         ${NODE}`);
  console.log(`   resolver     ${resolverNow}`);
  console.log(`   key          ${PAYOUT_RECORD_KEY}`);
  console.log(`   value        ${readBack ? JSON.stringify(readBack) : "(empty)"}`);

  if (decoded.error) {
    console.log(`   ROUND TRIP: FAIL - ${decoded.error}`);
    process.exit(1);
  }
  const matchesLocal = payout ? bytesToHex0x(decoded.publicKey) === bytesToHex0x(payout.keypair.publicKey) : null;
  console.log(`   decoded key  ${bytesToHex0x(decoded.publicKey)}`);
  if (matchesLocal === false) {
    console.log("   ROUND TRIP: FAIL - the on-chain key is NOT the one this wallet derives.");
    process.exit(1);
  }
  console.log(
    `   ROUND TRIP: PASS${matchesLocal ? " - the on-chain key matches the one derived from this wallet's signature" : ""}`,
  );
  console.log();
  console.log("   The ENS manager app will not display this key. That read above -");
  console.log("   node, resolver, key, raw value - is the evidence.");
}

console.log(RULE);
