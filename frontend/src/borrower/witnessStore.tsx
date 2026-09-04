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
import type { PassportResponse } from "../shared/protocol-types";

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
  load: (address: string) => Promise<void>;
  clear: () => void;
};

const WitnessContext = createContext<WitnessStore | null>(null);

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
  const [address, setAddress] = useState("");
  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [salt, setSalt] = useState<string | null>(null);
  const [blindingFactor, setBlindingFactor] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [status, setStatus] = useState<WitnessStatus>("empty");
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setAddress("");
    setPassport(null);
    setSalt(null);
    setBlindingFactor(null);
    setCommitment(null);
    setStatus("empty");
    setError(null);
  }, []);

  const load = useCallback(async (next: string) => {
    const trimmed = next.trim();
    setAddress(trimmed);
    setStatus("loading");
    setError(null);
    setPassport(null);
    setCommitment(null);

    try {
      const response = await fetchPassport(trimmed);

      // One salt per passport, generated the moment the snapshot exists and
      // never regenerated for it. Re-salting after a challenge arrived would
      // let the borrower re-commit to different numbers, which is exactly the
      // attack the commitment ordering exists to stop.
      const nextSalt = randomFieldElement();
      const nextBlinding = randomFieldElement();

      setPassport(response);
      setSalt(nextSalt);
      setBlindingFactor(nextBlinding);
      setCommitment(passportCommitment(response.witness, nextSalt));
      setStatus("ready");
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
