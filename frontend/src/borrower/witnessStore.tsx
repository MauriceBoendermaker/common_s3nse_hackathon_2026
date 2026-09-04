/**
 * ============================================================================
 * BORROWER-ONLY MODULE.
 *
 * This file may be imported ONLY by files under `frontend/src/borrower/` and by
 * `frontend/src/components/BorrowerView.tsx`. Nothing under
 * `frontend/src/lender/`, and `frontend/src/components/LenderView.tsx`, may
 * import it — directly or transitively.
 *
 * That is not a convention anyone has to remember. `App.tsx` lazy-loads the two
 * views, so Rollup emits them as separate chunks: the witness reaches the
 * borrower chunk and cannot reach the lender chunk.
 *
 * HOW TO CHECK IT, AND WHAT A HONEST CHECK WILL FIND:
 *
 *   grep -c 'witnessStore\|collateralQuality' frontend/dist/assets/LenderView-*.js
 *
 * is 0, and so is a grep for `useProver`, `buildProofInput`, `proverWorker`,
 * `passportSalt` and `blindingFactor`.
 *
 * One nuance, stated here rather than discovered by a sceptic: BOTH lazy views
 * render `components/LoanLifecycle.tsx`, so Rollup gives them a shared chunk,
 * and `shared/policy.ts` lands in it. That chunk therefore does contain the
 * STRING "collateralQuality" — inside `passportCommitment(witness, salt)`,
 * a pure Poseidon helper over values you hand it. It is a hash function, not a
 * reader: it has no network call, no storage, and no way to obtain a portfolio.
 * The lender's tab never receives one, because `GET /api/state` has no field
 * that could carry it (check that with curl, which is the stronger test).
 * ============================================================================
 *
 * What lives here is the only copy of the private snapshot in the whole app:
 * the `Witness` returned by `GET /api/passport/:address`, plus the salt that
 * hides it inside the published commitment. Neither ever leaves this module.
 * What leaves is `commitment` (a Poseidon hash) and `provenance` (which by its
 * type carries no portfolio value at all).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, fetchPassport } from "../shared/apiClient";
import { passportCommitment, randomFieldElement } from "../shared/policy";
import type { PassportRequestBody, PassportResponse } from "../shared/protocol-types";

export type WitnessStatus = "empty" | "loading" | "ready" | "error";

export type WitnessStore = {
  /** The Solana mainnet address the user typed. Public by definition. */
  address: string;
  /** The private snapshot. Never serialised into any request body. */
  passport: PassportResponse | null;
  /** Fresh per passport. Makes the commitment hiding. Never published. */
  salt: string | null;
  /** Fresh per passport. Blinds the subject commitment. Never published. */
  blindingFactor: string | null;
  /** Poseidon(assets, quality, history, exposure, salt). Safe to publish. */
  commitment: string | null;
  status: WitnessStatus;
  error: string | null;
  /** Real network work: 1-4 seconds of Solana RPC + Jupiter pricing. */
  load: (auth: PassportRequestBody) => Promise<void>;
  clear: () => void;
};

const WitnessContext = createContext<WitnessStore | null>(null);

/**
 * The snapshot survives a reload of THIS TAB and nothing else. `sessionStorage`
 * is per tab and dies with it; the values never reach the server, the lender
 * tab, or another tab. Without this, a dev-server reload between listing and
 * proving strands a listed request whose salt no longer exists anywhere.
 */
const STORAGE_KEY = "pc.witness.v1";

type Persisted = {
  address: string;
  passport: PassportResponse;
  salt: string;
  blindingFactor: string;
  commitment: string;
};

function readPersisted(): Persisted | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed.address || !parsed.passport || !parsed.salt || !parsed.blindingFactor || !parsed.commitment) {
      return null;
    }
    return parsed as Persisted;
  } catch {
    return null;
  }
}

function writePersisted(value: Persisted | null): void {
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage available: the snapshot simply does not survive a reload.
  }
}

/**
 * Solana addresses are base58-encoded 32-byte public keys: 32-44 characters
 * from the base58 alphabet (no 0, O, I or l). Checked client-side purely to
 * avoid a pointless round trip — the backend validates for real.
 */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isLikelySolanaAddress(value: string): boolean {
  return BASE58_ADDRESS.test(value.trim());
}

export function WitnessProvider({ children }: { children: ReactNode }) {
  const [restored] = useState(() => readPersisted());
  const [address, setAddress] = useState(restored?.address ?? "");
  const [passport, setPassport] = useState<PassportResponse | null>(restored?.passport ?? null);
  const [salt, setSalt] = useState<string | null>(restored?.salt ?? null);
  const [blindingFactor, setBlindingFactor] = useState<string | null>(restored?.blindingFactor ?? null);
  const [commitment, setCommitment] = useState<string | null>(restored?.commitment ?? null);
  const [status, setStatus] = useState<WitnessStatus>(restored ? "ready" : "empty");
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setAddress("");
    setPassport(null);
    setSalt(null);
    setBlindingFactor(null);
    setCommitment(null);
    setStatus("empty");
    setError(null);
    writePersisted(null);
  }, []);

  const load = useCallback(async (auth: PassportRequestBody) => {
    const trimmed = auth.address.trim();
    setAddress(trimmed);
    setStatus("loading");
    setError(null);
    setPassport(null);
    setCommitment(null);

    try {
      const response = await fetchPassport({ ...auth, address: trimmed });

      // One salt per passport, generated the moment the snapshot exists and
      // never regenerated for it. Re-salting after a challenge arrived would
      // let the borrower re-commit to different numbers, which is exactly the
      // attack the commitment ordering exists to stop.
      const nextSalt = randomFieldElement();
      const nextBlinding = randomFieldElement();

      const nextCommitment = passportCommitment(response.witness, nextSalt);
      setPassport(response);
      setSalt(nextSalt);
      setBlindingFactor(nextBlinding);
      setCommitment(nextCommitment);
      setStatus("ready");
      writePersisted({
        address: trimmed,
        passport: response,
        salt: nextSalt,
        blindingFactor: nextBlinding,
        commitment: nextCommitment,
      });
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.status === 0
            ? `${cause.message}. Is the backend running?`
            : cause.detail
              ? `${cause.message} — ${cause.detail}`
              : cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause);
      setPassport(null);
      setSalt(null);
      setBlindingFactor(null);
      setCommitment(null);
      setStatus("error");
      setError(message);
      writePersisted(null);
    }
  }, []);

  const value = useMemo<WitnessStore>(
    () => ({
      address,
      passport,
      salt,
      blindingFactor,
      commitment,
      status,
      error,
      load,
      clear,
    }),
    [address, passport, salt, blindingFactor, commitment, status, error, load, clear],
  );

  return <WitnessContext.Provider value={value}>{children}</WitnessContext.Provider>;
}

export function useWitness(): WitnessStore {
  const store = useContext(WitnessContext);
  if (!store) {
    throw new Error("useWitness must be used inside <WitnessProvider>");
  }
  return store;
}
