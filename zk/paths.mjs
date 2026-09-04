// Path resolution shared by every script in this workspace.
//
// The scripts must work whether they are launched as `node zk/build.mjs` from
// the repo root or as `npm run build -w zk` from inside the workspace, so
// nothing here may depend on process.cwd(). Every path is derived from
// import.meta.url instead.
//
// npm workspaces hoist `snarkjs` and `circomlib` to the ROOT node_modules, but
// a lockfile conflict can just as easily leave them in `zk/node_modules`. Look
// in both rather than guessing.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ZK_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(ZK_DIR, "..");
export const BUILD_DIR = path.join(ZK_DIR, "build");
export const CIRCUITS_DIR = path.join(ZK_DIR, "circuits");
export const BIN_DIR = path.join(ZK_DIR, "bin");

export const CIRCUIT = "credit_policy";

export const CIRCOM_BIN = path.join(
  BIN_DIR,
  process.platform === "win32" ? "circom.exe" : "circom",
);

/** Frontend artifact destination — served statically, fetched by the prover worker. */
export const FRONTEND_PUBLIC_ZK = path.join(REPO_ROOT, "frontend", "public", "zk");
/** Generated TypeScript mirror of the derived public-signal layout. */
export const FRONTEND_SHARED = path.join(REPO_ROOT, "frontend", "src", "shared");

/** Resolve a path inside an installed package, hoisted or not. */
export function resolvePackagePath(relative) {
  for (const base of [path.join(ZK_DIR, "node_modules"), path.join(REPO_ROOT, "node_modules")]) {
    const candidate = path.join(base, relative);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `cannot find node_modules/${relative} — run \`npm install\` at the repo root ` +
      "(the zk workspace must be listed in the root package.json \"workspaces\" array)",
  );
}

export const SNARKJS_CLI = () => resolvePackagePath("snarkjs/build/cli.cjs");
export const CIRCOMLIB_CIRCUITS = () => resolvePackagePath("circomlib/circuits");

export const b = (...parts) => path.join(BUILD_DIR, ...parts);
