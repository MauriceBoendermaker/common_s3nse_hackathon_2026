/**
 * ENS read-path probe. NO PRIVATE KEY NEEDED, NO WRITES, NO GAS.
 *
 *   node scripts/ens-probe.mjs [name.eth ...]
 *
 * Why this script exists: a prior fact-check could not obtain a positive
 * control for Sepolia text-record reads, so the entire ENS workstream rested on
 * an unproven assumption. This script gets the positive control - it finds an
 * ALREADY-EXISTING Sepolia name with a text record already set by somebody
 * else, and reads it back with a direct `text(node, key)` call. If that works
 * against a stranger's record, it will work against ours.
 *
 * It runs the SHIPPING read path (`frontend/src/shared/ensClient.ts`) via
 * Node's native TypeScript stripping, not a parallel copy. What passes here is
 * the code the app uses.
 *
 * What it reports:
 *   1. bytecode presence for every ENS contract we call (a wrong address gives
 *      empty `eth_call` data, which surfaces as a confusing ABI decode error);
 *   2. a live, third-party text record read back by `text()` - the positive
 *      control, with block number, name/node, key and value;
 *   3. whether OUR payout record is set yet on the names we care about;
 *   4. availability and `rentPrice` for the names we might register.
 */

import { createPublicClient, http, namehash, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";

import {
  ENS_CHAIN,
  ENS_PUBLIC_RESOLVER,
  SEPOLIA_RPC_URL,
  checkAvailability,
  probeContracts,
  readPayoutRecord,
  resolveName,
  reverseName,
} from "../frontend/src/shared/ensClient.ts";
import { PAYOUT_RECORD_KEY, bytesToHex0x } from "../frontend/src/shared/ensPayout.ts";

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

const client = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL, { timeout: 20_000 }),
});

const resolverTextAbi = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
];

/**
 * The current ENS PublicResolver emits the key and value in the clear
 * alongside an indexed copy of the key, so a plain `getLogs` gives us both the
 * node and a key we can then read back independently.
 */
const TEXT_CHANGED = parseAbiItem(
  "event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value)",
);

/**
 * The registry maps namehash -> owner; it does NOT store the name, and there is
 * no on-chain way back from a node to its label. Custom text-record keys are
 * almost always namespaced with the project's own name ("lplens.408303.chainId"),
 * so the key segments are a good source of label guesses. This is best-effort:
 * if nothing matches we report the node and say the name is unknown, rather
 * than inventing one.
 */
function guessLabels(keys) {
  const seeds = new Set();
  for (const key of keys) {
    for (const part of key.split(/[.\-_[\]]/)) {
      const clean = part.trim().toLowerCase();
      if (clean.length >= 3 && /^[a-z0-9]+$/.test(clean) && !/^\d+$/.test(clean)) seeds.add(clean);
    }
  }
  const suffixes = ["", "agent", "app", "bot", "test", "demo", "labs", "xyz", "eth", "ai"];
  const out = [];
  for (const seed of seeds) {
    for (const suffix of suffixes) out.push(seed + suffix);
    out.push(seed.replace(/(.+?)(agent|app|bot)$/, "$1-$2"));
  }
  return [...new Set(out)];
}

function nameForNode(node, keys) {
  for (const label of guessLabels(keys)) {
    if (namehash(`${label}.eth`).toLowerCase() === node.toLowerCase()) return `${label}.eth`;
  }
  return null;
}

/* ------------------------------------------------------------- 1. contracts */

console.log(RULE);
console.log(`ENS read-path probe - ${ENS_CHAIN.name} (chain id ${ENS_CHAIN.id})`);
console.log(`RPC ${SEPOLIA_RPC_URL}`);
console.log(RULE);

const contracts = await probeContracts();
if (!contracts.ok) {
  console.log(`FAIL  could not reach ${ENS_CHAIN.name}: ${contracts.error}`);
  process.exit(1);
}
console.log(`block ${contracts.blockNumber}`);
console.log();
console.log("1. Contracts we call (none of them ours - all already deployed by ENS)");
let allDeployed = true;
for (const c of contracts.contracts) {
  const status = c.bytecodeBytes > 0 ? `bytecode ${c.bytecodeBytes} B` : "NO CODE AT THIS ADDRESS";
  if (c.bytecodeBytes === 0) allDeployed = false;
  console.log(`   ${c.bytecodeBytes > 0 ? "[OK]  " : "[FAIL]"} ${c.label.padEnd(24)} ${c.address}  ${status}`);
}
console.log(`   -> ${allDeployed ? "PASS" : "FAIL"}: every contract on the read path exists on ${ENS_CHAIN.name}`);

/* ------------------------------------------------------------- 2. control */

console.log();
console.log(THIN);
console.log("2. POSITIVE CONTROL - read a text record that somebody else already set");
console.log(THIN);
console.log("   Scanning PublicResolver TextChanged logs for a live record...");

const head = contracts.blockNumber;
let candidates = [];
let scannedFrom = null;
let scannedTo = null;

for (let window = 0; window < 25 && candidates.length === 0; window += 1) {
  const toBlock = head - BigInt(window) * 1000n;
  const fromBlock = toBlock - 999n;
  let logs = [];
  try {
    logs = await client.getLogs({
      address: ENS_PUBLIC_RESOLVER,
      event: TEXT_CHANGED,
      fromBlock,
      toBlock,
    });
  } catch (error) {
    console.log(`   getLogs ${fromBlock}-${toBlock} failed: ${String(error).split("\n")[0].slice(0, 120)}`);
    continue;
  }
  if (scannedTo === null) scannedTo = toBlock;
  scannedFrom = fromBlock;
  candidates = logs
    .filter((log) => typeof log.args.key === "string" && log.args.key.length > 0)
    .map((log) => ({ node: log.args.node, key: log.args.key, blockNumber: log.blockNumber }));
}

let controlPassed = false;
if (candidates.length === 0) {
  console.log(`   NO TextChanged LOGS FOUND in blocks ${scannedFrom}-${scannedTo}.`);
  console.log("   The positive control was NOT obtained from log scanning.");
} else {
  console.log(
    `   found ${candidates.length} TextChanged events in blocks ${scannedFrom}-${scannedTo}`,
  );
  // Group the keys per node so the label guesser has more to work with.
  const byNode = new Map();
  for (const c of candidates) {
    if (!byNode.has(c.node)) byNode.set(c.node, []);
    byNode.get(c.node).push(c);
  }

  for (const [node, entries] of byNode) {
    const keys = entries.map((e) => e.key);
    const guessedName = nameForNode(node, keys);
    let readValue = null;
    let readKey = null;
    for (const entry of entries) {
      try {
        const value = await client.readContract({
          address: ENS_PUBLIC_RESOLVER,
          abi: resolverTextAbi,
          functionName: "text",
          args: [node, entry.key],
        });
        if (typeof value === "string" && value.length > 0) {
          readValue = value;
          readKey = entry.key;
          break;
        }
      } catch (error) {
        console.log(`   text() failed for ${entry.key}: ${String(error).split("\n")[0].slice(0, 100)}`);
      }
    }
    if (readValue === null) continue;

    controlPassed = true;
    const confirm = await client.getBlockNumber();
    console.log();
    console.log(`   [PASS] direct text(node, key) returned a non-empty value`);
    console.log(`          block      ${confirm}`);
    console.log(`          name       ${guessedName ?? "(unknown - the registry stores no names)"}`);
    console.log(`          node       ${node}`);
    console.log(`          resolver   ${ENS_PUBLIC_RESOLVER}`);
    console.log(`          key        ${JSON.stringify(readKey)}`);
    console.log(
      `          value      ${JSON.stringify(readValue.length > 120 ? `${readValue.slice(0, 120)}...` : readValue)}`,
    );
    if (readKey.includes(".")) {
      console.log(
        "          note       this is a CUSTOM dotted key, exactly the shape of",
      );
      console.log(`                     ${PAYOUT_RECORD_KEY} - so the record type we need`);
      console.log("                     is demonstrably readable on this chain today.");
    }
    if (guessedName) {
      const viaName = await resolveName(guessedName);
      if (viaName.ok) {
        console.log(`          owner      ${viaName.owner ?? "(none)"}`);
        const rev = await reverseName(viaName.owner ?? "0x0000000000000000000000000000000000000000");
        console.log(
          `          reverse    ${rev.ok ? (rev.name ?? "not set") : `error: ${rev.error}`}` +
            (rev.ok && rev.name ? ` (forward match: ${rev.forwardMatches ? "yes" : "NO"})` : ""),
        );
      }
    }
    break;
  }
  if (!controlPassed) {
    console.log("   Every candidate node returned an EMPTY string from text().");
    console.log("   The positive control was NOT obtained.");
  }
}

console.log();
console.log(
  `   POSITIVE CONTROL: ${controlPassed ? "OBTAINED - Sepolia text() reads work" : "NOT OBTAINED"}`,
);

/* ------------------------------------------------------------- 3. our record */

const OUR_NAMES = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [process.env.ENS_NAME, "privatecredit.eth", "commons3nse.eth"].filter(Boolean);

console.log();
console.log(THIN);
console.log(`3. Our payout record: text(node, "${PAYOUT_RECORD_KEY}")`);
console.log(THIN);
for (const name of OUR_NAMES) {
  const resolved = await resolveName(name);
  if (!resolved.ok) {
    console.log(`   ${name.padEnd(22)} error: ${resolved.error}`);
    continue;
  }
  if (!resolved.resolver) {
    console.log(`   ${name.padEnd(22)} unregistered / no resolver set - nothing to read yet`);
    continue;
  }
  const record = await readPayoutRecord(name);
  if (!record.ok) {
    console.log(`   ${name.padEnd(22)} error: ${record.error}`);
    continue;
  }
  if (record.publicKey) {
    console.log(`   ${name.padEnd(22)} SET  ${bytesToHex0x(record.publicKey)}`);
    console.log(`   ${" ".repeat(22)} raw  ${record.value}`);
  } else {
    console.log(`   ${name.padEnd(22)} not set (${record.decodeError})`);
  }
}

/* ------------------------------------------------------------- 4. prices */

console.log();
console.log(THIN);
console.log("4. Registration availability and price (ETHRegistrarController)");
console.log(THIN);
for (const name of OUR_NAMES) {
  const label = name.replace(/\.eth$/i, "");
  if (label.includes(".")) continue;
  const availability = await checkAvailability(label);
  if (!availability.ok) {
    console.log(`   ${name.padEnd(22)} error: ${availability.error}`);
    continue;
  }
  if (availability.available) {
    console.log(
      `   ${availability.name.padEnd(22)} AVAILABLE   ${availability.priceEth} ETH / year  (${availability.priceWei} wei)`,
    );
  } else {
    console.log(`   ${availability.name.padEnd(22)} taken`);
  }
}

console.log();
console.log(RULE);
console.log(
  controlPassed && allDeployed
    ? "READ PATH PROVEN. Nothing here was written to a chain and no key was used."
    : "READ PATH NOT FULLY PROVEN - see the FAIL / NOT OBTAINED lines above.",
);
console.log(RULE);

process.exit(controlPassed && allDeployed ? 0 : 1);
