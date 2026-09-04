/**
 * BORROWER-ONLY. Owns the one prover worker and everything the UI knows about
 * it.
 *
 * ONE WORKER, CREATED AT WORKSPACE MOUNT, REUSED FOR EVERY PROOF. A fresh
 * worker per proof costs 650-750 ms of pure startup — module evaluation, the
 * 4.6 MB artifact fetch, wasm instantiation, ffjavascript's thread pool —
 * before any proving begins. Paying that once, in the background, while the
 * applicant is still reading their passport, is the difference between "press
 * the button, wait half a second" and "press the button, wait two seconds and
 * wonder if it worked".
 *
 * REACT 19 STRICTMODE. Effects mount, unmount and mount again in development.
 * A naive `new Worker(...)` in a `useEffect` therefore creates two workers and
 * leaks one, doubling the artifact fetch and the memory. The worker here lives
 * in a module-level singleton behind a reference count, and releasing the last
 * reference schedules termination on a short grace timer that StrictMode's
 * immediate remount cancels. The result: exactly one worker, no leak, and the
 * same code path in development and production.
 *
 * The worker is created lazily on first retain rather than at module scope, so
 * merely importing this file (which `BorrowerView` does) never spawns anything
 * on a page that is not the applicant's workspace.
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { CircuitInput, ProverRequest, ProverResponse } from "./proverWorker";
import { buildWarmupInput } from "./buildProofInput";

export type ProverStatus = "loading" | "ready" | "proving" | "error";

export type ProverWarmup = {
  /** Total warmup wall clock, including the throwaway proof. */
  ms: number;
  /** How long fetching /zk/credit_policy.{wasm,zkey} took. */
  fetchMs: number;
  /** The throwaway proof, or null if it was skipped. */
  proveMs: number | null;
  wasmBytes: number;
  zkeyBytes: number;
};

export type ProofResult = {
  proof: unknown;
  /** Decimal strings in the circuit's wire order. */
  publicSignals: string[];
  /** `groth16.fullProve` wall clock, measured inside the worker. */
  ms: number;
};

export type Prover = {
  status: ProverStatus;
  prove: (input: CircuitInput) => Promise<ProofResult>;
  /** Null until the warmup completes. */
  warmup: ProverWarmup | null;
  /** Convenience: `warmup?.ms`. Null while warming. */
  warmupMs: number | null;
  error: string | null;
};

/* =========================================================== the singleton */

type ClientState = {
  status: ProverStatus;
  warmup: ProverWarmup | null;
  error: string | null;
};

type Pending = {
  resolve: (result: ProofResult) => void;
  reject: (cause: Error) => void;
};

/**
 * How long a released worker survives before it is terminated. Long enough to
 * cover StrictMode's unmount/remount, short enough that navigating away from
 * the applicant workspace actually frees the 4.6 MB of artifacts.
 */
const TEARDOWN_GRACE_MS = 4_000;

class ProverClient {
  readonly worker: Worker;
  #state: ClientState = { status: "loading", warmup: null, error: null };
  readonly #pending = new Map<string, Pending>();
  readonly #listeners = new Set<() => void>();
  #warmupStarted = false;

  constructor() {
    // Vite compiles this to a separate worker chunk at build time. The
    // `new URL(..., import.meta.url)` form is required — a bare string would
    // be left as a runtime path Vite cannot rewrite.
    this.worker = new Worker(new URL("./proverWorker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.addEventListener("message", (event: MessageEvent) => {
      this.#receive(event.data as ProverResponse);
    });

    // A worker that fails to construct or throws during module evaluation
    // reports here and nowhere else; without this the UI would sit on
    // "loading" forever with no explanation.
    this.worker.addEventListener("error", (event: ErrorEvent) => {
      this.#fail(event.message || "the prover worker failed to start");
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = (): ClientState => this.#state;

  #set(next: Partial<ClientState>): void {
    this.#state = { ...this.#state, ...next };
    for (const listener of this.#listeners) listener();
  }

  #fail(message: string): void {
    this.#set({ status: "error", error: message });
    for (const [, pending] of this.#pending) {
      pending.reject(new Error(message));
    }
    this.#pending.clear();
  }

  #post(message: ProverRequest): void {
    this.worker.postMessage(message);
  }

  #receive(message: ProverResponse): void {
    switch (message.type) {
      case "ready":
        // The module evaluated. Artifacts are not loaded yet — `warm` is what
        // says the prover is actually usable — so the status stays "loading".
        void this.warmUp();
        return;

      case "warm":
        this.#set({
          status: this.#pending.size > 0 ? "proving" : "ready",
          warmup: {
            ms: message.ms,
            fetchMs: message.fetchMs,
            proveMs: message.proveMs,
            wasmBytes: message.wasmBytes,
            zkeyBytes: message.zkeyBytes,
          },
          error: null,
        });
        return;

      case "proved": {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (pending) {
          pending.resolve({
            proof: message.proof,
            publicSignals: message.publicSignals,
            ms: message.ms,
          });
        }
        if (this.#pending.size === 0 && this.#state.status === "proving") {
          this.#set({ status: "ready" });
        }
        return;
      }

      case "error": {
        if (message.id === null) {
          // A warmup failure. Do not reject in-flight proofs over it: the
          // artifacts may still arrive on the retry the next prove triggers.
          this.#set({ status: "error", error: message.message });
          return;
        }
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        pending?.reject(new Error(message.message));
        this.#set({
          status: this.#pending.size > 0 ? "proving" : "ready",
          error: message.message,
        });
        return;
      }
    }
  }

  /**
   * Fetch the artifacts and run one throwaway proof, so the first real proof
   * pays only for proving. Runs once per worker.
   */
  async warmUp(): Promise<void> {
    if (this.#warmupStarted) return;
    this.#warmupStarted = true;
    try {
      const { input } = await buildWarmupInput();
      this.#post({ type: "warmup", input });
    } catch (cause) {
      // Building the synthetic input failed (crypto.subtle unavailable on an
      // insecure origin, say). Still fetch the artifacts — that is most of the
      // win — and let the real proof surface the underlying problem.
      this.#post({ type: "warmup" });
      this.#set({
        error:
          "warmup proof skipped: " + (cause instanceof Error ? cause.message : String(cause)),
      });
    }
  }

  prove(input: CircuitInput): Promise<ProofResult> {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + String(Math.random());

    return new Promise<ProofResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#set({ status: "proving", error: null });
      this.#post({ type: "prove", id, input });
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.#fail("the prover worker was terminated");
  }
}

let shared: ProverClient | null = null;
let refs = 0;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTeardown(): void {
  if (teardownTimer !== null) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
}

/**
 * Terminate on a grace timer rather than synchronously.
 *
 * StrictMode unmounts and remounts in the same tick; a synchronous teardown
 * would throw away the worker we are about to need again — including its
 * artifact cache — and the remount would re-download 4.6 MB. `retain()`
 * cancels the timer, so in StrictMode the worker is never actually torn down.
 */
function scheduleTeardown(): void {
  cancelTeardown();
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    if (refs === 0 && shared) {
      shared.terminate();
      shared = null;
    }
  }, TEARDOWN_GRACE_MS);
}

/**
 * Get the worker for a RENDER, without taking a reference.
 *
 * Render can run without the component ever mounting (a discarded render, a
 * suspended tree), so this must not increment the count — but a client created
 * by a render that never mounts would then live forever, so a teardown is armed
 * as a safety net. The mount effect's `retain()` disarms it.
 */
function acquireProver(): ProverClient {
  cancelTeardown();
  if (!shared) {
    shared = new ProverClient();
  }
  if (refs === 0) {
    scheduleTeardown();
  }
  return shared;
}

function retainProver(): ProverClient {
  cancelTeardown();
  if (!shared) {
    shared = new ProverClient();
  }
  refs += 1;
  return shared;
}

function releaseProver(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    scheduleTeardown();
  }
}

/* =============================================================== the hook */

const ProverContext = createContext<ProverClient | null>(null);

const OFFLINE: ClientState = {
  status: "error",
  warmup: null,
  error: "useProver must be used inside <ProverProvider>",
};

/** Stable identities: `useSyncExternalStore` resubscribes on a changed one. */
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_STATE = (): ClientState => OFFLINE;

/**
 * Mount once, at the top of the applicant workspace. Creating the worker here
 * rather than inside the component that proves means the artifacts are already
 * in memory by the time a policy challenge arrives.
 */
export function ProverProvider({ children }: { children: ReactNode }) {
  const held = useRef<ProverClient | null>(null);
  if (held.current === null) {
    held.current = acquireProver();
  }

  useEffect(() => {
    // Re-reads the singleton rather than closing over `held.current`, so the
    // reference count always tracks the worker that is actually shared.
    held.current = retainProver();
    return releaseProver;
  }, []);

  return createElement(ProverContext.Provider, { value: held.current }, children);
}

export function useProver(): Prover {
  const client = useContext(ProverContext);

  const state = useSyncExternalStore(
    client ? client.subscribe : NO_SUBSCRIBE,
    client ? client.getState : NO_STATE,
    client ? client.getState : NO_STATE,
  );

  return {
    status: state.status,
    warmup: state.warmup,
    warmupMs: state.warmup ? state.warmup.ms : null,
    error: state.error,
    prove: (input: CircuitInput) => {
      if (!client) return Promise.reject(new Error(OFFLINE.error ?? "no prover"));
      return client.prove(input);
    },
  };
}
