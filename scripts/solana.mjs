/**
 * scripts/solana.mjs — the Docker wrapper around the Anchor toolchain.
 *
 * NOTHING RUST IS INSTALLED ON THIS MACHINE, and that is deliberate: the
 * Solana toolchain on Windows means either WSL or an afternoon. The
 * `solanafoundation/anchor:v1.0.2` image has anchor-cli 1.0.2, solana-cli
 * 3.1.10 and rustc 1.95, and a cold `anchor build` of this program takes about
 * four minutes in it.
 *
 * Commands:
 *   build      anchor build          -> solana/target/deploy/private_credit.so + the IDL
 *   validator  start a local test validator on :8899 (container `pc-validator`)
 *   deploy     deploy the .so to whichever cluster is configured
 *   up         validator + deploy + setup, from nothing to a working chain
 *   down       stop and remove the validator container
 *
 * Two container flags below are load-bearing and were both found the hard way:
 *
 *   --security-opt seccomp=unconfined
 *       agave 3.1's accounts-db asserts `io_uring_supported()` at startup, and
 *       Docker's default seccomp profile blocks io_uring. Without this the
 *       validator panics before it opens a socket.
 *
 *   --bind-address $(hostname -i)
 *       `--bind-address 0.0.0.0` panics in gossip with `UnspecifiedIpAddr`,
 *       and the default (127.0.0.1) is unreachable from the host even with
 *       `-p 8899:8899`. The container's own bridge IP is the one address that
 *       satisfies both.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const solanaDir = path.join(root, "solana");

const IMAGE = "solanafoundation/anchor:v1.0.2";
const CONTAINER = "pc-validator";
const REGISTRY_VOLUME = "pc-cargo-registry";

const argv = process.argv.slice(2);
const command = argv[0] ?? "build";
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    // MSYS on Windows rewrites anything that looks like a POSIX path inside an
    // argument, which mangles the `-v C:\...:/work` volume spec.
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args[0]} failed (exit ${result.status})`);
  }
  return (result.stdout ?? "").trim();
}

function ensureVolume() {
  docker(["volume", "create", REGISTRY_VOLUME], { capture: true, allowFailure: true });
}

function anchorRun(shellCommand) {
  ensureVolume();
  docker([
    "run",
    "--rm",
    "-v",
    `${solanaDir}:/work`,
    "-v",
    `${REGISTRY_VOLUME}:/root/.cargo/registry`,
    "-w",
    "/work",
    IMAGE,
    "sh",
    "-c",
    shellCommand,
  ]);
}

function containerRunning() {
  const out = docker(
    ["ps", "--filter", `name=${CONTAINER}`, "--filter", "status=running", "--format", "{{.Names}}"],
    { capture: true, allowFailure: true },
  );
  return out.split("\n").includes(CONTAINER);
}

async function rpcReady(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVersion" }),
      });
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

/* ------------------------------------------------------------------ build */

function build() {
  // The verifying key the program compiles in must always be regenerated from
  // the current zkey. Doing it here rather than trusting a stale vk.rs is the
  // difference between "the proof is invalid" and a build failure that names
  // the problem.
  execFileSync(process.execPath, [path.join(root, "zk", "emit-program-vk.mjs")], {
    stdio: "inherit",
  });
  anchorRun("anchor build");
  const so = path.join(solanaDir, "target", "deploy", "private_credit.so");
  if (!fs.existsSync(so)) throw new Error("anchor build produced no .so");
  console.log(`\n${path.relative(root, so)} — ${fs.statSync(so).size} bytes`);
}

/* -------------------------------------------------------------- validator */

async function validator() {
  if (containerRunning()) {
    console.log(`${CONTAINER} is already running on http://localhost:8899`);
    return;
  }
  docker(["rm", "-f", CONTAINER], { capture: true, allowFailure: true });
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--security-opt",
    "seccomp=unconfined",
    "-p",
    "8899:8899",
    "-p",
    "8900:8900",
    "-w",
    "/tmp",
    IMAGE,
    "sh",
    "-c",
    "solana-keygen new --no-bip39-passphrase -s -o /root/.config/solana/id.json >/dev/null 2>&1; " +
      "exec solana-test-validator --ledger /tmp/ledger --bind-address $(hostname -i) --rpc-port 8899",
  ]);

  const version = await rpcReady("http://127.0.0.1:8899");
  if (!version) {
    docker(["logs", "--tail", "40", CONTAINER], { allowFailure: true });
    throw new Error("the validator did not come up on http://localhost:8899");
  }
  console.log(`validator up — solana-core ${version.result["solana-core"]} on http://localhost:8899`);
}

/* ----------------------------------------------------------------- deploy */

function deploy() {
  const cluster = flag("cluster", process.env.SOLANA_SETTLE_CLUSTER ?? "localnet");
  const so = path.join(solanaDir, "target", "deploy", "private_credit.so");
  const keypair = path.join(solanaDir, "target", "deploy", "private_credit-keypair.json");
  const deployer = path.join(root, ".solana", "deployer.json");

  for (const file of [so, keypair, deployer]) {
    if (!fs.existsSync(file)) {
      throw new Error(`missing ${path.relative(root, file)} — run \`npm run solana:build\` and \`npm run solana:keys\``);
    }
  }

  if (cluster === "localnet") {
    // Deploy from inside the validator container: the solana CLI is already
    // there and the RPC is on its own loopback, so no networking to arrange.
    if (!containerRunning()) throw new Error("no local validator — run `npm run solana:validator`");
    docker(["cp", so, `${CONTAINER}:/tmp/pc.so`]);
    docker(["cp", keypair, `${CONTAINER}:/tmp/pc-keypair.json`]);
    docker(["cp", deployer, `${CONTAINER}:/tmp/deployer.json`]);
    docker([
      "exec",
      CONTAINER,
      "sh",
      "-c",
      "IP=$(hostname -i); solana config set -u http://$IP:8899 -k /tmp/deployer.json >/dev/null; " +
        "solana airdrop 100 >/dev/null 2>&1; solana balance; " +
        "solana program deploy /tmp/pc.so --program-id /tmp/pc-keypair.json",
    ]);
    return;
  }

  const url =
    flag("rpc", null) ??
    (cluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.testnet.solana.com");

  // `.solana/` is mounted read-write because `solana program deploy` writes a
  // buffer-recovery file next to the keypair when a deploy is interrupted, and
  // losing that means losing the SOL parked in the buffer.
  docker([
    "run",
    "--rm",
    "-v",
    `${solanaDir}:/work`,
    "-v",
    `${path.join(root, ".solana")}:/keys`,
    "-w",
    "/work",
    IMAGE,
    "sh",
    "-c",
    `solana program deploy target/deploy/private_credit.so ` +
      `--program-id target/deploy/private_credit-keypair.json ` +
      `-u ${url} -k /keys/deployer.json`,
  ]);
}

/* --------------------------------------------------------------------- up */

async function up() {
  await validator();
  deploy();
  execFileSync(process.execPath, [path.join(here, "solana-setup.mjs")], { stdio: "inherit" });
}

function down() {
  docker(["rm", "-f", CONTAINER], { capture: true, allowFailure: true });
  console.log(`${CONTAINER} removed`);
}

/* -------------------------------------------------------------------- run */

switch (command) {
  case "build":
    build();
    break;
  case "validator":
    await validator();
    break;
  case "deploy":
    deploy();
    break;
  case "up":
    await up();
    break;
  case "down":
    down();
    break;
  default:
    console.error(`unknown command "${command}". Try: build | validator | deploy | up | down`);
    process.exit(1);
}
