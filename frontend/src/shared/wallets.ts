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
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
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

export function getEthereum(): Eip1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
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

/** Connect an EIP-1193 wallet and make sure it is on Sepolia. */
export async function connectEthereum(): Promise<Address> {
  const provider = getEthereum();
  if (!provider) {
    throw new WalletError(
      "No Ethereum wallet found. Install MetaMask (or another EIP-1193 wallet) and reload.",
    );
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new WalletError("The wallet returned no account.");
  await ensureSepolia(provider);
  return account as Address;
}

/** `personal_sign` over a UTF-8 message. Deterministic per wallet (RFC 6979). */
export async function personalSign(message: string, account: Address): Promise<Hex> {
  const provider = getEthereum();
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
  const provider = getEthereum();
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
