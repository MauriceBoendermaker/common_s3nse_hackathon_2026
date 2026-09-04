/**
 * ============================================================================
 * THE PROVER. Runs in a Web Worker, in the applicant's browser, and nowhere
 * else.
 *
 * BORROWER-ONLY MODULE. Nothing under `frontend/src/lender/` may import it,
 * directly or transitively. `App.tsx` lazy-loads the two workspaces, so Rollup
 * emits them as separate chunks and this worker is emitted as a third; a judge
 * can grep `frontend/dist/assets/` and find the prover in neither the main
 * bundle nor the lender chunk.
 * ============================================================================
 *
 * This is what replaced `policy-eval-v0`. The old flow evaluated the four
 * comparisons in JavaScript and posted four booleans — honest, but not zero
 * knowledge. This one computes a real BN254 Groth16 proof of
 * `zk/circuits/credit_policy.circom` over the same private snapshot, and the
 * snapshot still never leaves the tab: what leaves is a ~1.2 KB proof and seven
 * public field elements.
 *
 * WHY A WORKER, AND WHY A REUSED ONE. `groth16.fullProve` blocks its thread for
 * roughly half a second; on the main thread that is a visibly frozen UI. A
 * fresh worker per proof, meanwhile, costs 650-750 ms of pure startup — module
 * evaluation, wasm instantiation, ffjavascript's own thread pool — before any
 * proving happens. So exactly one worker is created at workspace mount and
 * reused for every proof (`useProver.ts`), and the 4.6 MB of artifacts is
 * fetched once and kept in this worker's memory.
 *
 * CSP NOTE. If a Content-Security-Policy is ever added to the served app it
 * MUST allow `worker-src blob:` (and `child-src blob:` for older engines).
 * ffjavascript spawns its own internal workers from blob URLs for the
 * multi-exponentiation; without that directive they fail to construct and
 * proving breaks with an error that points nowhere near the CSP. `script-src`
 * must also allow the wasm the witness calculator instantiates
 * (`'wasm-unsafe-eval'`).
 *
 * TYPING NOTE. There is deliberately no `/// <reference lib="webworker" />`
 * here. The rest of the app compiles against the DOM lib, and pulling the
 * WebWorker lib into one file of the same program collides on `self`,
 * `postMessage` and friends. The two casts below are narrower and cost less
 * than the fight.
 */

import * as snarkjs from "snarkjs";

/* ------------------------------------------------------- message protocol */

/** The 16 named circuit inputs, as decimal strings. See `buildProofInput.ts`. */
export type CircuitInput = Record<string, string>;

/** Main thread -> worker. */
export type ProverRequest =
  /**
   * Fetch and cache the artifacts. When `input` is present, also run one
   * throwaway proof, which is what actually pays the cost of instantiating the
   * witness-calculator wasm and building ffjavascript's BN254 thread pool. The
   * input is built on the main thread from the real protocol helpers so this
   * file holds no copy of the protocol's hashing.
   */
  | { type: "warmup"; input?: CircuitInput }
  | { type: "prove"; id: string; input: CircuitInput };

/** Worker -> main thread. */
export type ProverResponse =
  /** Posted once, as soon as the module has evaluated. */
  | { type: "ready" }
  | {
      type: "warm";
      /** Total warmup wall clock. */
      ms: number;
      /** Time spent fetching /zk/*.wasm and /zk/*.zkey. */
      fetchMs: number;
      /** Time spent on the throwaway proof, or null when none was requested. */
      proveMs: number | null;
      wasmBytes: number;
      zkeyBytes: number;
    }
  | {
      type: "proved";
      id: string;
      proof: unknown;
      /** Decimal strings in the circuit's wire order. The order is the claim. */
      publicSignals: string[];
      ms: number;
    }
  | { type: "error"; id: string | null; message: string };

/* ---------------------------------------------------------------- plumbing */

const scope = self as unknown as {
  postMessage: (message: ProverResponse) => void;
  addEventListener: (type: "message", handler: (event: { data: unknown }) => void) => void;
};

const post = (message: ProverResponse): void => {
  scope.postMessage(message);
};

/**
 * Vite rewrites `import.meta.env.BASE_URL` at build time. Read through a cast
 * so this file compiles whether or not `vite/client` types are wired into
 * tsconfig — the same convention `shared/apiClient.ts` uses.
 */
const BASE: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.BASE_URL ?? "/";

const WASM_URL = BASE + "zk/credit_policy.wasm";
const ZKEY_URL = BASE + "zk/credit_policy.zkey";

/* --------------------------------------------------------------- artifacts */

type Artifacts = { wasm: Uint8Array; zkey: Uint8Array; fetchMs: number };

/**
 * The single copy of the proving artifacts, fetched once and reused.
 *
 * Held as a PROMISE rather than a value so that two `prove` messages arriving
 * before the first fetch resolves share one download instead of racing into
 * two 4.6 MB requests. A failed fetch clears the field, so a retry after a
 * dropped connection actually retries.
 */
let artifacts: Promise<Artifacts> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      "could not fetch " +
        url +
        " (HTTP " +
        response.status +
        "). The prover artifacts are served from frontend/public/zk/ — run `npm run zk:build` if they are missing.",
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function loadArtifacts(): Promise<Artifacts> {
  if (!artifacts) {
    artifacts = (async () => {
      const startedAt = performance.now();
      const [wasm, zkey] = await Promise.all([fetchBytes(WASM_URL), fetchBytes(ZKEY_URL)]);
      return { wasm, zkey, fetchMs: Math.round(performance.now() - startedAt) };
    })().catch((cause: unknown) => {
      artifacts = null;
      throw cause;
    });
  }
  return artifacts;
}

/* ------------------------------------------------------------------ proving */

async function prove(
  input: CircuitInput,
): Promise<{ proof: unknown; publicSignals: string[]; ms: number }> {
  const { wasm, zkey } = await loadArtifacts();
  const startedAt = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { proof, publicSignals, ms: Math.round(performance.now() - startedAt) };
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

scope.addEventListener("message", (event) => {
  const message = event.data as ProverRequest;

  if (!message || typeof message !== "object") return;

  if (message.type === "warmup") {
    void (async () => {
      const startedAt = performance.now();
      try {
        const loaded = await loadArtifacts();
        let proveMs: number | null = null;
        if (message.input) {
          const result = await prove(message.input);
          proveMs = result.ms;
        }
        post({
          type: "warm",
          ms: Math.round(performance.now() - startedAt),
          fetchMs: loaded.fetchMs,
          proveMs,
          wasmBytes: loaded.wasm.byteLength,
          zkeyBytes: loaded.zkey.byteLength,
        });
      } catch (cause) {
        post({ type: "error", id: null, message: describe(cause) });
      }
    })();
    return;
  }

  if (message.type === "prove") {
    void (async () => {
      try {
        const { proof, publicSignals, ms } = await prove(message.input);
        post({ type: "proved", id: message.id, proof, publicSignals, ms });
      } catch (cause) {
        post({ type: "error", id: message.id, message: describe(cause) });
      }
    })();
  }
});

post({ type: "ready" });
