/**
 * The channel that replaces the shared `useState`.
 *
 * Before workstream A, "borrower" and "lender" were two render branches of one
 * component reading one object in one browser tab — which is why the demo could
 * not honestly claim a trust boundary. This hook is the replacement: each tab
 * holds its own session, and the only thing it knows about the other party is
 * what the server chooses to project into `ProtocolState`.
 *
 * There is no `setInterval` here. The server long-polls: it holds
 * `GET /api/state?since=<version>` open for ~25s and answers the instant the
 * version moves. So the loop is await -> setState -> await again. Every state
 * transition in the UI is a real HTTP round trip, never a timer pretending.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, createSession, fetchState } from "./apiClient";
import type { ProtocolState, Role, SessionResponse } from "./protocol-types";
import { clearSession, getSessionId, setSessionId } from "./session";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "error";

export type UseProtocolState = {
  state: ProtocolState | null;
  session: SessionResponse | null;
  connection: ConnectionStatus;
  error: string | null;
  /** Abort the in-flight long-poll so the next state lands immediately. */
  refresh: () => void;
};

/** 1s -> 2s -> 4s -> 8s, then flat. Long enough to be polite, short enough to feel alive. */
const BACKOFF_START_MS = 1_000;
const BACKOFF_CAP_MS = 8_000;

/** Consecutive failures before the banner stops saying "reconnecting". Retrying never stops. */
const FAILURES_BEFORE_ERROR = 5;

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

/**
 * Has the session this tab holds ceased to exist on the server?
 *
 * The marketplace store is in memory, so restarting the backend — which happens
 * constantly while developing and at least once during any long demo — throws
 * away every session. The tab's id is then permanently unusable, and retrying
 * the long-poll with it can never succeed no matter how patient the backoff is.
 * `requireParty` answers 410 Gone for exactly this case; 404 is kept because a
 * future route could answer that for a session-scoped resource.
 */
function sessionIsGone(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 404 || cause.status === 410);
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.detail ? `${cause.message} (${cause.detail})` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function useProtocolState(role: Role): UseProtocolState {
  const [state, setState] = useState<ProtocolState | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  // Set by the effect, replaced whenever the effect re-runs. Holding the abort
  // behind a ref (rather than the controller itself) means a StrictMode double
  // mount cannot have the first pass abort the second pass's request: each
  // effect closure owns its own controller variable.
  const abortInFlight = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Two independent guards, both needed. `cancelled` stops the async loop
    // between awaits; the controller stops the request that is already open.
    // React 19 StrictMode mounts, unmounts and remounts every effect in dev, so
    // without both a discarded pass keeps polling forever behind the live one.
    let cancelled = false;
    let inFlight: AbortController | null = null;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;

    abortInFlight.current = () => inFlight?.abort();

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        backoffTimer = setTimeout(resolve, ms);
      });

    let failures = 0;
    let backoff = BACKOFF_START_MS;

    const noteFailure = (cause: unknown) => {
      failures += 1;
      setConnection(failures >= FAILURES_BEFORE_ERROR ? "error" : "reconnecting");
      setError(describe(cause));
    };

    const noteSuccess = () => {
      failures = 0;
      backoff = BACKOFF_START_MS;
      setError(null);
    };

    /**
     * Claim a session, then poll with it — and if the server ever says that
     * session is gone, come back here and claim another. The outer loop is the
     * whole point: without it, a backend restart left the tab retrying a dead
     * id forever behind an ever-growing backoff, showing "reconnecting" and
     * never recovering.
     */
    const run = async () => {
      while (!cancelled) {
        // ---- 1. claim a session for this tab, retrying forever -----------
        let party: SessionResponse | null = null;
        while (!cancelled && party === null) {
          try {
            const existing = getSessionId(role);
            const next = await createSession(role, existing ?? undefined);
            if (cancelled) return;
            setSessionId(role, next.sessionId);
            party = next;
            setSession(next);
            noteSuccess();
          } catch (cause) {
            if (cancelled) return;
            if (isAbort(cause)) return;
            // A session id left over from a store that has since been reset
            // would otherwise wedge this tab. Drop it and re-ask clean.
            if (sessionIsGone(cause)) clearSession(role);
            noteFailure(cause);
            await sleep(backoff);
            backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
          }
        }
        if (cancelled || party === null) return;

        // ---- 2. long-poll the shared state until the session dies --------
        let since = 0;
        let reclaim = false;
        while (!cancelled && !reclaim) {
          const controller = new AbortController();
          inFlight = controller;
          try {
            const next = await fetchState({
              role,
              sessionId: party.sessionId,
              since,
              signal: controller.signal,
            });
            if (cancelled) return;
            since = next.version;
            setState(next);
            setConnection("live");
            noteSuccess();
          } catch (cause) {
            if (cancelled) return;
            if (isAbort(cause)) {
              // refresh() cut the long-poll on purpose after a mutation. Not a
              // failure: no backoff, no error banner, just ask again at once.
              continue;
            }
            if (sessionIsGone(cause)) {
              // The backend restarted (or was reset) and this id no longer
              // resolves. Forget it, drop the stale projection so the UI does
              // not keep rendering rows that are gone, and go claim a new one.
              clearSession(role);
              setSession(null);
              setState(null);
              reclaim = true;
            }
            noteFailure(cause);
            await sleep(backoff);
            backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
          } finally {
            if (inFlight === controller) inFlight = null;
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      inFlight?.abort();
      inFlight = null;
      if (backoffTimer !== null) clearTimeout(backoffTimer);
      abortInFlight.current = null;
    };
  }, [role]);

  const refresh = useCallback(() => {
    abortInFlight.current?.();
  }, []);

  return { state, session, connection, error, refresh };
}
