// zk/getcircom.mjs — put a working circom 2.2.3 binary in zk/bin/.
//
// circom is a Rust program, but iden3 publish prebuilt binaries, so nothing
// here needs a Rust toolchain.
//
// This machine already has a verified-working circom 2.2.3 recovered from an
// earlier session. Copying it is faster and strictly more reliable than a
// GitHub release download (which is the one network call in the whole zk
// pipeline that can fail), so we prefer the local copy and only download when
// no local copy exists.
//
// Whichever path we take, the binary is then RUN and its version asserted.
// A truncated download produces a file of plausible size that fails later,
// deep inside the compile step, with a useless error.

import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { BIN_DIR, CIRCOM_BIN, REPO_ROOT } from "./paths.mjs";

const VERSION = "2.2.3";
const ASSET = {
  win32: "circom-windows-amd64.exe",
  linux: "circom-linux-amd64",
  darwin: "circom-macos-amd64",
}[process.platform];

/** Local copies verified working on this machine, in preference order. */
const LOCAL_CANDIDATES =
  process.platform === "win32"
    ? [
        path.join(REPO_ROOT, ".recovered", "zk", "bin", "circom.exe"),
        path.join(REPO_ROOT, ".recovered", "zktest", "circom.exe"),
      ]
    : [];

function assertVersion() {
  let out;
  try {
    out = execFileSync(CIRCOM_BIN, ["--version"], { encoding: "utf8" }).trim();
  } catch (cause) {
    throw new Error(`circom at ${CIRCOM_BIN} would not run: ${cause.message}`);
  }
  if (!out.includes(VERSION)) {
    throw new Error(`expected circom ${VERSION}, got "${out}" — delete ${CIRCOM_BIN} and re-run`);
  }
  console.log(`  version: ${out}  (${statSync(CIRCOM_BIN).size} bytes)`);
}

mkdirSync(BIN_DIR, { recursive: true });

if (existsSync(CIRCOM_BIN)) {
  console.log(`circom already present: ${CIRCOM_BIN}`);
  assertVersion();
  process.exit(0);
}

const local = LOCAL_CANDIDATES.find((candidate) => existsSync(candidate));

if (local) {
  console.log(`copying verified local circom: ${local}`);
  copyFileSync(local, CIRCOM_BIN);
} else {
  if (!ASSET) throw new Error(`no circom release asset for platform ${process.platform}`);
  const url = `https://github.com/iden3/circom/releases/download/v${VERSION}/${ASSET}`;
  console.log(`no local copy found; downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(CIRCOM_BIN));
}

if (process.platform !== "win32") chmodSync(CIRCOM_BIN, 0o755);
console.log(`wrote ${CIRCOM_BIN}`);
assertVersion();
