/**
 * Browser wallet access. The only file that touches `window.ethereum` or
 * `window.solana`.
 *
 *   - MetaMask (any EIP-1193 provider) on Sepolia: signs the viewing-key
 *     message and sends the one `setText` that publishes the payout key.
 *   - Phantom: proves control of the Solana address the passport is read for.
 *
 * Nothing here is stored. Every call is user-initiated and every signature
 * prompt says what it authorises.
 */

import { createWalletClient, custom, stringToHex, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

import { sepoliaClient } from "./ensClient";

/* ------------------------------------------------------------- types */

type Eip1193Provider = {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  /** Legacy multi-wallet shim some extensions attach to `window.ethereum`. */
  providers?: Eip1193Provider[];
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

/** EIP-6963: every injected wallet announces itself with a stable reverse-DNS id. */
type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

type PhantomPublicKey = { toString(): string };

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  signMessage(
    message: Uint8Array,
    display?: "utf8" | "hex",
  ): Promise<{ signature: Uint8Array; publicKey: PhantomPublicKey }>;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    solana?: PhantomProvider;
    phantom?: { solana?: PhantomProvider };
  }
}

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

/** One readable sentence out of whatever a wallet or viem threw. */
export function describeWalletError(cause: unknown): string {
  if (cause instanceof WalletError) return cause.message;
  if (cause && typeof cause === "object") {
    const { code, message, shortMessage } = cause as {
      code?: number;
      message?: string;
      shortMessage?: string;
    };
    if (code === 4001 || /user rejected|rejected the request/i.test(message ?? "")) {
      return "You rejected the request in the wallet.";
    }
    if (shortMessage) return shortMessage.split("\n")[0]!.slice(0, 240);
    if (message) return message.split("\n")[0]!.slice(0, 240);
  }
  return String(cause).slice(0, 240);
}

/* ------------------------------------------------------------- ethereum */

const announced: Eip6963ProviderDetail[] = [];

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.provider && !announced.some((row) => row.info.uuid === detail.info.uuid)) {
      announced.push(detail);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export type EthereumWalletChoice = { id: string; name: string; provider: Eip1193Provider };

/**
 * Every injected Ethereum wallet the page can see, MetaMask first. Phantom
 * also ships an EVM wallet and by default installs itself as
 * `window.ethereum`, so a machine with both would otherwise always land in
 * Phantom. EIP-6963 announcements identify wallets by reverse-DNS; the legacy
 * `providers` array and the `isPhantom` flag cover older wallets.
 */
export function listEthereumWallets(): EthereumWalletChoice[] {
  if (typeof window === "undefined") return [];
  const out: EthereumWalletChoice[] = announced.map((row) => ({
    id: row.info.rdns,
    name: row.info.name,
    provider: row.provider,
  }));
  const root = window.ethereum;
  if (root) {
    for (const provider of root.providers ?? [root]) {
      if (out.some((row) => row.provider === provider)) continue;
      out.push({
        id: provider.isPhantom ? "app.phantom" : provider.isMetaMask ? "io.metamask" : "injected",
        name: provider.isPhantom ? "Phantom" : provider.isMetaMask ? "MetaMask" : "Ethereum wallet",
        provider,
      });
    }
  }
  const rank = (row: EthereumWalletChoice) =>
    row.id === "io.metamask" ? 0 : row.id === "app.phantom" ? 2 : 1;
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The wallet to use: an explicit choice, else MetaMask, else whatever exists. */
export function getEthereum(walletId?: string | null): Eip1193Provider | null {
  const wallets = listEthereumWallets();
  if (walletId) {
    const chosen = wallets.find((row) => row.id === walletId);
    if (chosen) return chosen.provider;
  }
  return wallets[0]?.provider ?? null;
}

/**
 * The wallet that currently holds `account` among its connected accounts.
 * `eth_accounts` never prompts, so this is safe to call on every render path;
 * it is how a reloaded tab signs again with the same wallet it used before,
 * instead of whichever wallet happens to be first in the list.
 */
export async function providerForAccount(account: Address): Promise<Eip1193Provider | null> {
  const wanted = account.toLowerCase();
  for (const wallet of listEthereumWallets()) {
    try {
      const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as string[];
      if (accounts.some((row) => row.toLowerCase() === wanted)) return wallet.provider;
    } catch {
      // A wallet that refuses eth_accounts is simply not the one.
    }
  }
  return null;
}

/** Human name for the wallet a provider belongs to, for the UI chip. */
export function ethereumWalletName(provider: Eip1193Provider | null): string {
  if (!provider) return "Ethereum wallet";
  return listEthereumWallets().find((row) => row.provider === provider)?.name ?? "Ethereum wallet";
}

const SEPOLIA_HEX = "0xaa36a7";

async function ensureSepolia(provider: Eip1193Provider): Promise<void> {
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId.toLowerCase() === SEPOLIA_HEX) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX }],
    });
  } catch (cause) {
    const code = (cause as { code?: number }).code;
    if (code !== 4902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_HEX,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }
}

/** Connect the chosen EIP-1193 wallet and make sure it is on Sepolia. */
export async function connectEthereum(
  walletId?: string | null,
): Promise<{ account: Address; walletName: string }> {
  const provider = getEthereum(walletId);
  if (!provider) {
    throw new WalletError(
      "No Ethereum wallet found. Install MetaMask (or another EIP-1193 wallet) and reload.",
    );
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new WalletError("The wallet returned no account.");
  await ensureSepolia(provider);
  return { account: account as Address, walletName: ethereumWalletName(provider) };
}

/**
 * `personal_sign` over a UTF-8 message, by the wallet that holds `account`.
 * Deterministic per wallet (RFC 6979), so the same account always yields the
 * same viewing key — which is only true if the SAME wallet signs.
 */
export async function personalSign(message: string, account: Address): Promise<Hex> {
  const provider = (await providerForAccount(account)) ?? getEthereum();
  if (!provider) throw new WalletError("No Ethereum wallet found.");
  const signature = (await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), account],
  })) as Hex;
  return signature;
}

const setTextAbi = [
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

/**
 * Publish one ENS text record from the connected wallet. Returns the
 * transaction hash as soon as the wallet has sent it; call
 * `waitForSepoliaReceipt` to block until it is mined.
 */
export async function setEnsTextRecord(input: {
  account: Address;
  resolver: Address;
  node: Hex;
  key: string;
  value: string;
}): Promise<Hex> {
  const provider = (await providerForAccount(input.account)) ?? getEthereum();
  if (!provider) throw new WalletError("No Ethereum wallet found.");
  await ensureSepolia(provider);
  const wallet = createWalletClient({
    account: input.account,
    chain: sepolia,
    transport: custom(provider),
  });
  return wallet.writeContract({
    address: input.resolver,
    abi: setTextAbi,
    functionName: "setText",
    args: [input.node, input.key, input.value],
  });
}

export async function waitForSepoliaReceipt(
  hash: Hex,
): Promise<{ blockNumber: bigint; ok: boolean }> {
  const receipt = await sepoliaClient().waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { blockNumber: receipt.blockNumber, ok: receipt.status === "success" };
}

/* ------------------------------------------------------------- solana */

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

/** Connect Phantom and return the base58 public key. */
export async function connectPhantom(): Promise<string> {
  const provider = getPhantom();
  if (!provider) {
    throw new WalletError("No Solana wallet found. Install Phantom and reload.");
  }
  const { publicKey } = await provider.connect();
  return publicKey.toString();
}

/** Sign a UTF-8 message with the connected Phantom account. */
export async function signWithPhantom(message: string): Promise<Uint8Array> {
  const provider = getPhantom();
  if (!provider) throw new WalletError("No Solana wallet found.");
  const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  return signature;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `0x1234…abcd` / `7xKX…gAsU`. */
export function shortAddress(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}
