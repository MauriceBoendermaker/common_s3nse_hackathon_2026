/**
 * Per-tab session identity.
 *
 * `sessionStorage`, deliberately — NOT `localStorage`.
 *
 * The whole point of workstream A is that the borrower and the lender are two
 * independent parties, not two render branches of one component. In the demo
 * that means two browser tabs. `localStorage` is shared across every tab of an
 * origin, so a single stored session id would make both tabs the *same* party
 * again — the trust boundary would be a lie told by the UI. `sessionStorage` is
 * scoped to one tab, so tab A can be the borrower and tab B the lender at the
 * same time, each holding a session id the other cannot see.
 *
 * Keys are namespaced per role (`pc.session.borrower` / `pc.session.lender`) so
 * that a single tab that navigates between the two views does not silently
 * hand the lender the borrower's session.
 */

import type { Role } from "./protocol-types";

const KEY_PREFIX = "pc.session.";

/**
 * Safari private mode (and any browser with site data disabled) throws on the
 * very first `sessionStorage` access rather than returning null. Every access
 * below is wrapped, and falls back to this in-memory map so the app degrades to
 * "session lost on reload" instead of a white screen.
 */
const memoryFallback = new Map<string, string>();

function storageKey(role: Role): string {
  return KEY_PREFIX + role;
}

function readStorage(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // fall through to the in-memory fallback
  }
  return memoryFallback.get(key) ?? null;
}

function writeStorage(key: string, value: string): void {
  memoryFallback.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // in-memory copy above is the fallback
  }
}

function removeStorage(key: string): void {
  memoryFallback.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // nothing else to do — the in-memory copy is already gone
  }
}

/** The session id this tab holds for `role`, or null if it has never had one. */
export function getSessionId(role: Role): string | null {
  const value = readStorage(storageKey(role));
  return value && value.length > 0 ? value : null;
}

/** Remember the session id the backend issued for `role` in THIS tab only. */
export function setSessionId(role: Role, id: string): void {
  if (!id) {
    clearSession(role);
    return;
  }
  writeStorage(storageKey(role), id);
}

/** Forget this tab's session for `role` (used when the server rejects it). */
export function clearSession(role: Role): void {
  removeStorage(storageKey(role));
}
