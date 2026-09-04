/**
 * ============================================================================
 * BORROWER-ONLY MODULE.
 *
 * Importable only by files under `frontend/src/borrower/` and by
 * `components/BorrowerView.tsx`. It holds a private key: the X25519 viewing
 * scalar that recovers every one-time payout address derived for this
 * identity. `App.tsx` lazy-loads the borrower view, so this module is absent
 * from the lender bundle by construction.
 * ============================================================================
 *
 * The ENS name is the applicant's IDENTITY. The Solana address in
 * `witnessStore` is where their PORTFOLIO was read. The two are never
 * conflated: the subject commitment at public signal [3] is
 * `Poseidon2(utf8ToField(ensName), blindingFactor)`, and the payout address is
 * derived from the key published under the name.
 *
 * ONE KEY SOURCE. The lender derives against the X25519 key it reads out of
 * the name's `privatecredit.payout-key[501]` text record on Sepolia. There is
 * no fallback: if the record is not there, this store publishes it from the
 * connected wallet with a real `setText`, and until that is mined the
 * applicant cannot list a request.
 *
 * The viewing key is derived, never stored: HKDF over a `personal_sign` of a
 * fixed message, so the same wallet reproduces it on any device.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Address, Hex } from "viem";

import {
  PAYOUT_KEY_SIGN_MESSAGE,
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
import {
  connectEthereum,
  describeWalletError,
  personalSign,
  setEnsTextRecord,
  waitForSepoliaReceipt,
} from "../shared/wallets";

export type EnsStatus = "empty" | "resolving" | "resolved" | "error";
export type WalletStatus = "disconnected" | "connecting" | "signing" | "connected";
export type PublishStatus = "idle" | "sending" | "confirming";

export type EnsIdentityStore = {
  /** The connected Ethereum account, on Sepolia. */
  wallet: Address | null;
  walletStatus: WalletStatus;
  walletError: string | null;
  /** Which injected wallet the account came from ("MetaMask", "Phantom"). */
  walletName: string | null;
  /** Connect, sign the viewing-key message, and look up the wallet's primary name. */
  connectWallet: (walletId?: string) => Promise<void>;
  /** Re-sign the viewing-key message with the connected wallet. */
  signViewingKey: () => Promise<void>;

  /** Lowercased, trimmed. The identity that goes into the subject commitment. */
  name: string;
  setName: (next: string) => void;
  status: EnsStatus;
  error: string | null;
  resolution: ResolvedName | null;
  reverse: ReverseNameRead | null;
  /** The raw `text(node, key)` read, including a value of `""`. */
  payoutRecord: PayoutRecordRead | null;
  /** Non-null only when the chain read succeeded AND the value parsed. */
  onChainPayoutKey: Uint8Array | null;
  resolve: (target?: string) => Promise<void>;

  viewing: ViewingKeypair | null;
  /** The published record is this wallet's key. */
  keysAgree: boolean;
  /** The key the lender will derive against. Only ever the ENS record. */
  effectiveKey: { publicKey: Uint8Array; source: PayoutKeySource } | null;
  /** `pcv1:sol:x25519:0x…` — what `setText` writes. */
  recordValue: string | null;

  publishStatus: PublishStatus;
  publishError: string | null;
  publishTx: Hex | null;
  /** Send `setText` from the connected wallet and wait for the receipt. */
  publishRecord: () => Promise<void>;

  /** Name resolved, record published, and this tab holds the matching scalar. */
  ready: boolean;
  clear: () => void;
};

const EnsIdentityContext = createContext<EnsIdentityStore | null>(null);

/**
 * Wallet address and name survive a reload of this tab. The viewing SCALAR
 * does not: it is re-derived with one signature, which is cheaper than the
 * risk of a private key sitting in storage.
 */
const STORAGE_KEY = "pc.identity.v1";

function readPersistedIdentity(): { wallet: Address | null; walletName: string | null; name: string } {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { wallet: null, walletName: null, name: "" };
    const parsed = JSON.parse(raw) as { wallet?: string; walletName?: string; name?: string };
    return {
      wallet: parsed.wallet && /^0x[0-9a-fA-F]{40}$/.test(parsed.wallet) ? (parsed.wallet as Address) : null,
      walletName: typeof parsed.walletName === "string" ? parsed.walletName : null,
      name: typeof parsed.name === "string" ? parsed.name : "",
    };
  } catch {
    return { wallet: null, walletName: null, name: "" };
  }
}

/** Shape only. ENS's own normalisation is ENSIP-15 and we do not implement it. */
const DOTTED_NAME = /^[^\s.]+(\.[^\s.]+)+$/;

export function isLikelyEnsName(value: string): boolean {
  return DOTTED_NAME.test(value.trim().toLowerCase());
}

export function EnsIdentityProvider({ children }: { children: ReactNode }) {
  const [restored] = useState(() => readPersistedIdentity());
  const [wallet, setWallet] = useState<Address | null>(restored.wallet);
  const [walletName, setWalletName] = useState<string | null>(restored.walletName);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>(
    restored.wallet ? "connected" : "disconnected",
  );
  const [walletError, setWalletError] = useState<string | null>(null);

  const [name, setNameState] = useState(restored.name);
  const [status, setStatus] = useState<EnsStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ResolvedName | null>(null);
  const [reverse, setReverse] = useState<ReverseNameRead | null>(null);
  const [payoutRecord, setPayoutRecord] = useState<PayoutRecordRead | null>(null);

  const [viewing, setViewing] = useState<ViewingKeypair | null>(null);

  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishTx, setPublishTx] = useState<Hex | null>(null);

  // The latest successful resolution, readable from inside async callbacks
  // without waiting for a render.
  const latestResolution = useRef<ResolvedName | null>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ wallet, walletName, name }));
    } catch {
      // Storage unavailable: identity simply does not survive a reload.
    }
  }, [wallet, walletName, name]);

  const setName = useCallback((next: string) => {
    setNameState(next);
    // A resolution belongs to the name it was made for.
    setStatus("empty");
    setError(null);
    setResolution(null);
    latestResolution.current = null;
    setReverse(null);
    setPayoutRecord(null);
    setPublishTx(null);
    setPublishError(null);
  }, []);

  const resolve = useCallback(
    async (override?: string) => {
      const target = (override ?? name).trim().toLowerCase();
      if (!isLikelyEnsName(target)) {
        setStatus("error");
        setError(`"${target}" is not a dotted name. Expect something like yourname.eth.`);
        return;
      }
      if (override !== undefined) setNameState(target);

      setStatus("resolving");
      setError(null);

      const resolved = await resolveName(target);
      if (!resolved.ok) {
        setStatus("error");
        setError(resolved.error);
        return;
      }
      setResolution(resolved);
      latestResolution.current = resolved;

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
        setPayoutRecord(null);
        setStatus("resolved");
        setError(record.error);
      }
    },
    [name],
  );

  const signViewingKey = useCallback(async () => {
    if (!wallet) return;
    setWalletStatus("signing");
    setWalletError(null);
    try {
      const signature = await personalSign(PAYOUT_KEY_SIGN_MESSAGE, wallet);
      setViewing(deriveViewingKeypair(signature));
    } catch (cause) {
      setWalletError(describeWalletError(cause));
    } finally {
      setWalletStatus("connected");
    }
  }, [wallet]);

  const connectWallet = useCallback(async (walletId?: string) => {
    setWalletStatus("connecting");
    setWalletError(null);
    let account: Address;
    try {
      const connected = await connectEthereum(walletId);
      account = connected.account;
      setWalletName(connected.walletName);
    } catch (cause) {
      setWalletStatus(wallet ? "connected" : "disconnected");
      setWalletError(describeWalletError(cause));
      return;
    }
    // A different account is a different identity: drop the old key.
    if (wallet && wallet.toLowerCase() !== account.toLowerCase()) setViewing(null);
    setWallet(account);

    // The viewing key first: one prompt, right away.
    setWalletStatus("signing");
    try {
      const signature = await personalSign(PAYOUT_KEY_SIGN_MESSAGE, account);
      setViewing(deriveViewingKeypair(signature));
    } catch (cause) {
      setWalletError(describeWalletError(cause));
    }
    setWalletStatus("connected");

    // Then the wallet's primary name, if it has one. Any reverse record is
    // prefilled; the forward check is shown, not assumed.
    const back = await reverseName(account);
    if (back.ok && back.name) {
      await resolve(back.name);
    }
  }, [resolve, wallet]);

  const publishRecord = useCallback(async () => {
    setPublishError(null);
    if (!wallet) {
      setPublishError("Connect the wallet that owns the name first.");
      return;
    }
    if (!viewing) {
      setPublishError("Sign the viewing-key message first, so there is a key to publish.");
      return;
    }
    let current = latestResolution.current;
    if (!current || current.name !== name.trim().toLowerCase()) {
      await resolve();
      current = latestResolution.current;
    }
    if (!current) {
      setPublishError("The name could not be resolved.");
      return;
    }
    if (!current.owner && current.registry !== "ensv2") {
      setPublishError(`${current.name} is not registered on Sepolia. Register it first.`);
      return;
    }
    if (!current.resolver) {
      setPublishError(
        `${current.name} has no resolver set. Set a resolver for it in the ENS app, then publish again.`,
      );
      return;
    }

    setPublishStatus("sending");
    try {
      const hash = await setEnsTextRecord({
        account: wallet,
        resolver: current.resolver,
        node: current.node,
        key: PAYOUT_RECORD_KEY,
        value: encodePayoutRecord(viewing.publicKey),
      });
      setPublishTx(hash);
      setPublishStatus("confirming");
      const receipt = await waitForSepoliaReceipt(hash);
      if (!receipt.ok) {
        throw new Error("The transaction was mined but reverted.");
      }
      await resolve(current.name);
    } catch (cause) {
      setPublishError(describeWalletError(cause));
    } finally {
      setPublishStatus("idle");
    }
  }, [name, resolve, viewing, wallet]);

  // After a reload the name is known but nothing about it is: read it again
  // (read-only) so the record status is on screen before the user acts.
  const restoredOnce = useRef(false);
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    if (restored.name && isLikelyEnsName(restored.name)) void resolve(restored.name);
  }, [restored.name, resolve]);

  const clear = useCallback(() => {
    setNameState("");
    setStatus("empty");
    setError(null);
    setResolution(null);
    latestResolution.current = null;
    setReverse(null);
    setPayoutRecord(null);
    setViewing(null);
    setPublishTx(null);
    setPublishError(null);
  }, []);

  const value = useMemo<EnsIdentityStore>(() => {
    const onChainPayoutKey = payoutRecord?.publicKey ?? null;
    const keysAgree =
      onChainPayoutKey !== null &&
      viewing !== null &&
      bytesToHex0x(onChainPayoutKey) === bytesToHex0x(viewing.publicKey);
    const effectiveKey: EnsIdentityStore["effectiveKey"] = onChainPayoutKey
      ? { publicKey: onChainPayoutKey, source: "ens-text-record" }
      : null;

    return {
      wallet,
      walletStatus,
      walletError,
      walletName,
      connectWallet,
      signViewingKey,
      name: name.trim().toLowerCase(),
      setName,
      status,
      error,
      resolution,
      reverse,
      payoutRecord,
      onChainPayoutKey,
      resolve,
      viewing,
      keysAgree,
      effectiveKey,
      recordValue: viewing ? encodePayoutRecord(viewing.publicKey) : null,
      publishStatus,
      publishError,
      publishTx,
      publishRecord,
      ready: name.trim().length > 0 && effectiveKey !== null && keysAgree,
      clear,
    };
  }, [
    wallet,
    walletStatus,
    walletError,
    walletName,
    connectWallet,
    signViewingKey,
    name,
    setName,
    status,
    error,
    resolution,
    reverse,
    payoutRecord,
    resolve,
    viewing,
    publishStatus,
    publishError,
    publishTx,
    publishRecord,
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
