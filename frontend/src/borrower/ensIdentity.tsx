/**
 * ============================================================================
 * BORROWER-ONLY MODULE.
 *
 * Importable only by files under `frontend/src/borrower/` and by
 * `components/BorrowerView.tsx`. Nothing under `frontend/src/lender/` may
 * reach it, because it holds a private key: the X25519 viewing scalar that
 * recovers every one-time payout address derived for this identity. That
 * scalar is the borrower's spending ability (see the compartmentalisation note
 * in `shared/ensPayout.ts`) and it is the second private value in the app,
 * alongside the portfolio witness.
 * ============================================================================
 *
 * The ENS name is the applicant's IDENTITY. The Solana address in
 * `witnessStore` is where their PORTFOLIO was read. The two are different
 * facts about different things and this app never conflates them:
 *
 *   - the subject commitment at public signal [3] is
 *     `Poseidon2(utf8ToField(ensName), blindingFactor)` — the identity, blinded;
 *   - the Solana address travels in the provenance strip so a lender can
 *     re-read the same account themselves;
 *   - the payout address is derived from the ENS name and is unrelated to
 *     either.
 *
 * WHAT THIS MODULE READS FROM CHAIN, and what it refuses to fake. `resolve()`
 * makes four real Sepolia calls: registry `owner(node)`, registry
 * `resolver(node)`, resolver `addr(node)`, and resolver
 * `text(node, "privatecredit.payout-key[501]")`. Every one of them can come
 * back "not set", and every one of them is rendered as what it actually
 * returned. There is no code path here that renders a verified badge for a
 * check that did not run.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  PAYOUT_RECORD_KEY,
  bytesToHex0x,
  deriveViewingKeypair,
  encodePayoutRecord,
  type ViewingKeypair,
} from "../shared/ensPayout";
import {
  readPayoutRecord,
  resolveName,
  reverseName,
  type PayoutRecordRead,
  type ResolvedName,
  type ReverseNameRead,
} from "../shared/ensClient";
import type { PayoutKeySource } from "../shared/protocol-types";

export type EnsStatus = "empty" | "resolving" | "resolved" | "error";

/**
 * Where the viewing key came from.
 *
 * `signature` is the real path: a `personal_sign` over
 * `PAYOUT_KEY_SIGN_MESSAGE`, deterministic per wallet under RFC 6979, so the
 * same wallet reproduces the same key anywhere with nothing stored.
 *
 * `local-demo` is 65 random bytes generated in this tab and fed through the
 * identical derivation. It exists because this demo has no wallet connector,
 * and it is labelled as demo material everywhere it appears. It is NOT
 * reproducible on another device and nothing on chain attests it.
 */
export type ViewingKeySource = "signature" | "local-demo";

export type EnsIdentityStore = {
  /** Lowercased, trimmed. The identity that goes into the subject commitment. */
  name: string;
  setName: (next: string) => void;

  status: EnsStatus;
  error: string | null;
  /** Registry owner/resolver + `addr()`. Null until a resolve has succeeded. */
  resolution: ResolvedName | null;
  /** Reverse record, only attempted when `addr()` returned something. */
  reverse: ReverseNameRead | null;
  /** The raw `text(node, key)` read, including a value of `""`. */
  payoutRecord: PayoutRecordRead | null;
  /** Non-null only when the chain read succeeded AND the value parsed. */
  onChainPayoutKey: Uint8Array | null;

  viewing: ViewingKeypair | null;
  viewingSource: ViewingKeySource | null;
  viewingError: string | null;
  deriveFromSignature: (signatureHex: string) => void;
  generateDemoKey: () => void;

  /**
   * The key the LENDER will actually derive against, and where it came from.
   *
   * `ens-text-record` whenever the chain read produced a usable key — that is
   * the real protocol. `local-demo` only when it did not and this tab has a
   * viewing key of its own, in which case the public half travels with the
   * request and every surface that shows it says so.
   */
  effectiveKey: { publicKey: Uint8Array; source: PayoutKeySource } | null;
  /** `pcv1:sol:x25519:0x…` — exactly what `--set-text` would write. */
  recordValue: string | null;

  resolve: () => Promise<void>;
  clear: () => void;
};

const EnsIdentityContext = createContext<EnsIdentityStore | null>(null);

/** Shape only. ENS's own normalisation is ENSIP-15 and we do not implement it. */
const DOTTED_NAME = /^[^\s.]+(\.[^\s.]+)+$/;

export function isLikelyEnsName(value: string): boolean {
  return DOTTED_NAME.test(value.trim().toLowerCase());
}

/**
 * The exact shell command that would publish this tab's payout key.
 *
 * Printed verbatim in the UI when the record is missing, because "set the
 * record" is not actionable and a screenshot of the ENS manager app would show
 * nothing: the manager does not render a custom key like
 * `privatecredit.payout-key[501]`.
 */
export function setupCommand(name: string, registered: boolean): string {
  return registered
    ? `SEPOLIA_PRIVATE_KEY=0x… npm run ens:setup -- --set-text --name ${name} --yes`
    : `SEPOLIA_PRIVATE_KEY=0x… npm run ens:setup -- --register --name ${name} --yes`;
}

export function EnsIdentityProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState("");
  const [status, setStatus] = useState<EnsStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ResolvedName | null>(null);
  const [reverse, setReverse] = useState<ReverseNameRead | null>(null);
  const [payoutRecord, setPayoutRecord] = useState<PayoutRecordRead | null>(null);
  const [viewing, setViewing] = useState<ViewingKeypair | null>(null);
  const [viewingSource, setViewingSource] = useState<ViewingKeySource | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);

  const setName = useCallback((next: string) => {
    setNameState(next);
    // A resolution belongs to the name it was made for. Keeping it on screen
    // while the field says something else is how a UI ends up showing a green
    // check for a different name.
    setStatus("empty");
    setError(null);
    setResolution(null);
    setReverse(null);
    setPayoutRecord(null);
  }, []);

  const resolve = useCallback(async () => {
    const target = name.trim().toLowerCase();
    if (!isLikelyEnsName(target)) {
      setStatus("error");
      setError(`"${target}" is not a dotted name. Expect something like privatecredit.eth.`);
      return;
    }

    setStatus("resolving");
    setError(null);

    const resolved = await resolveName(target);
    if (!resolved.ok) {
      setStatus("error");
      setError(resolved.error);
      return;
    }
    setResolution(resolved);

    // Reverse resolution is only meaningful once there is an address to
    // reverse. `addr()` unset is the ordinary case for a name that exists but
    // has never pointed anywhere, and it is not a failure.
    if (resolved.address) {
      const back = await reverseName(resolved.address);
      setReverse(back.ok ? back : null);
    } else {
      setReverse(null);
    }

    const record = await readPayoutRecord(target);
    if (record.ok) {
      setPayoutRecord(record);
      setStatus("resolved");
      setError(null);
    } else {
      // The name has no resolver, or the RPC failed. Either way the record read
      // did not happen, and saying "no record" would misattribute that.
      setPayoutRecord(null);
      setStatus("resolved");
      setError(record.error);
    }
  }, [name]);

  const deriveFromSignature = useCallback((signatureHex: string) => {
    try {
      setViewing(deriveViewingKeypair(signatureHex));
      setViewingSource("signature");
      setViewingError(null);
    } catch (cause) {
      setViewing(null);
      setViewingSource(null);
      setViewingError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const generateDemoKey = useCallback(() => {
    // 65 bytes: the length of a `personal_sign` output, so this exercises the
    // identical derivation path rather than a shortcut around it.
    const material = new Uint8Array(65);
    crypto.getRandomValues(material);
    try {
      setViewing(deriveViewingKeypair(bytesToHex0x(material)));
      setViewingSource("local-demo");
      setViewingError(null);
    } catch (cause) {
      setViewing(null);
      setViewingSource(null);
      setViewingError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const clear = useCallback(() => {
    setNameState("");
    setStatus("empty");
    setError(null);
    setResolution(null);
    setReverse(null);
    setPayoutRecord(null);
    setViewing(null);
    setViewingSource(null);
    setViewingError(null);
  }, []);

  const value = useMemo<EnsIdentityStore>(() => {
    const onChainPayoutKey = payoutRecord?.publicKey ?? null;
    const effectiveKey: EnsIdentityStore["effectiveKey"] = onChainPayoutKey
      ? { publicKey: onChainPayoutKey, source: "ens-text-record" }
      : viewing
        ? { publicKey: viewing.publicKey, source: "local-demo" }
        : null;

    return {
      name: name.trim().toLowerCase(),
      setName,
      status,
      error,
      resolution,
      reverse,
      payoutRecord,
      onChainPayoutKey,
      viewing,
      viewingSource,
      viewingError,
      deriveFromSignature,
      generateDemoKey,
      effectiveKey,
      recordValue: viewing ? encodePayoutRecord(viewing.publicKey) : null,
      resolve,
      clear,
    };
  }, [
    name,
    setName,
    status,
    error,
    resolution,
    reverse,
    payoutRecord,
    viewing,
    viewingSource,
    viewingError,
    deriveFromSignature,
    generateDemoKey,
    resolve,
    clear,
  ]);

  return <EnsIdentityContext.Provider value={value}>{children}</EnsIdentityContext.Provider>;
}

export function useEnsIdentity(): EnsIdentityStore {
  const store = useContext(EnsIdentityContext);
  if (!store) {
    throw new Error("useEnsIdentity must be used inside <EnsIdentityProvider>");
  }
  return store;
}

export { PAYOUT_RECORD_KEY };
