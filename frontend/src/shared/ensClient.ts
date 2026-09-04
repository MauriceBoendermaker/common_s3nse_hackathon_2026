/**
 * ENS reads on Sepolia. READ PATH ONLY.
 *
 * Nothing in this file writes to Ethereum and nothing here needs a private
 * key. The one write the protocol requires - publishing the borrower's payout
 * key as a text record - is done once, by a human, with `scripts/ens-setup.mjs`.
 * Keeping the write out of the app means the shipped bundle can never spend
 * anybody's ETH, and the demo path is pure `eth_call`.
 *
 * -- Why Sepolia --------------------------------------------------------
 *
 * Ethereum MAINNET RPC is unreachable from the network this is built and
 * demoed on, so a mainnet name could not be verified from the desk it is
 * presented at. Sepolia answers in well under 100 ms here and is therefore the
 * only honest choice for a live demo. Every screen that shows an ENS fact must
 * name the chain, so nobody goes looking for the record on mainnet and
 * concludes it does not exist.
 *
 * -- Contracts, none of them ours ---------------------------------------
 *
 * We deploy nothing on Ethereum. These are ENS's own already-deployed Sepolia
 * contracts, and `probeContracts()` below checks each one actually has
 * bytecode before anything relies on it.
 *
 * -- ENSv2 first, ENSv1 second ------------------------------------------
 *
 * ENS Labs runs the ENSv2 beta on Sepolia (app.ens.dev), with a hierarchical
 * registry that is separate from the legacy flat registry, and has retired the
 * legacy manager UI there. Every exported read below therefore asks the ENSv2
 * UniversalResolverV2 first (`findResolver` walks the v2 registry tree) and
 * falls back to the v1 registry only when v2 has no resolver for the name.
 * Each result says which registry answered, so the UI never has to guess.
 *
 * -- No throwing into the render path -----------------------------------
 *
 * Every exported function returns a discriminated result. An RPC that times
 * out, a name that has no resolver, a reverse record that was never set - all
 * of those are ordinary states of the world, not exceptions, and each must be
 * displayable as itself. In particular: when reverse resolution is not set the
 * UI says "not set". It must never render a checkmark for a check that did not
 * run.
 */

import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";

import { PAYOUT_RECORD_KEY, decodePayoutRecord } from "./ensPayout.ts";

/* ------------------------------------------------------------- config */

/**
 * Keyless public Sepolia RPC. Verified reachable from this network; no API key
 * to leak in a client bundle, and no vendor on the demo path.
 */
export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** ENS registry - the same address on every chain ENS is deployed to. */
export const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

/** ENS PublicResolver on Sepolia - the contract that stores text records. */
export const ENS_PUBLIC_RESOLVER: Address = "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD";

/** ETHRegistrarController on Sepolia - `available` / `rentPrice` / registration. */
export const ETH_REGISTRAR_CONTROLLER: Address = "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72";

/** ERC-6538 stealth meta-address registry. Optional, and not on the demo path. */
export const ERC6538_REGISTRY: Address = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538";

/** Chain identity, for anything that has to be shown on screen. */
export const ENS_CHAIN = {
  id: sepolia.id,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/* ------------------------------------------------------------- ENSv2 */

export type EnsRegistry = "ensv2" | "ensv1";

/** ENSv2 beta on Sepolia — docs.ens.domains/learn/deployments#sepolia-ensv2-beta. */
export const ENSV2_UNIVERSAL_RESOLVER: Address = "0x4a1817d13e9cf196f471725176355c1234b63c70";
export const ENSV2_ETH_REGISTRY: Address = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
export const ENSV2_APP = "https://app.ens.dev";

const universalResolverAbi = [
  {
    name: "findResolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }],
    outputs: [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }],
  },
  {
    name: "resolve",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }, { type: "address" }],
  },
  {
    name: "reverse",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "lookupAddress", type: "bytes" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ type: "string" }, { type: "address" }, { type: "address" }],
  },
] as const;

const ethRegistryAbi = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

/* ------------------------------------------------------------- ABIs */

const registryAbi = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const resolverAbi = [
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "string" }],
  },
] as const;

const controllerAbi = [
  {
    name: "available",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "rentPrice",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/* ------------------------------------------------------------- results */

export type EnsResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface ResolvedName {
  name: string;
  node: Hex;
  /** Which registry answered. v2 is tried first. */
  registry: EnsRegistry;
  /** Registry `owner(node)`. `null` when the name is unregistered. */
  owner: Address | null;
  /** Registry `resolver(node)`. `null` when no resolver is set. */
  resolver: Address | null;
  /** `addr(node)`, the classic forward resolution. `null` when unset. */
  address: Address | null;
  blockNumber: bigint;
}

export interface PayoutRecordRead {
  name: string;
  node: Hex;
  registry: EnsRegistry;
  resolver: Address;
  key: string;
  /** Exactly what `text()` returned, including the empty string. */
  value: string;
  /** Parsed key, or `null` with `decodeError` set. */
  publicKey: Uint8Array | null;
  decodeError: string | null;
  blockNumber: bigint;
}

export interface ReverseNameRead {
  address: Address;
  registry: EnsRegistry;
  /**
   * `null` means the reverse record is genuinely NOT SET. Render that as "not
   * set". It is not an error and it is not a pass.
   */
  name: string | null;
  /** True only when the reverse name forward-resolves back to `address`. */
  forwardMatches: boolean;
  blockNumber: bigint;
}

export interface NameAvailability {
  label: string;
  name: string;
  available: boolean;
  /** Wei per `durationSeconds`; `base + premium`. `null` when unavailable. */
  priceWei: bigint | null;
  priceEth: string | null;
  durationSeconds: bigint;
  blockNumber: bigint;
}

export interface ContractProbe {
  label: string;
  address: Address;
  /** Bytecode size in bytes. `0` means nothing is deployed there. */
  bytecodeBytes: number;
}

/* ------------------------------------------------------------- client */

let cachedClient: PublicClient | null = null;

/** One shared client. viem batches `eth_call`s over a single HTTP transport. */
export function sepoliaClient(): PublicClient {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC_URL, { timeout: 15_000 }),
    }) as PublicClient;
  }
  return cachedClient;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // viem errors are multi-paragraph; the first line is the useful sentence.
    return error.message.split("\n")[0]!.slice(0, 240);
  }
  return String(error).slice(0, 240);
}

/**
 * ENS names are case-insensitive but `namehash` is not: it hashes the exact
 * bytes it is given. Lowercasing is the minimum normalisation; full UTS-46
 * would need `viem/ens`'s `normalize`, which pulls in a large IDNA table we do
 * not need for ASCII demo names. Non-ASCII input is rejected rather than
 * silently hashed wrong.
 */
function toNode(name: string): { node: Hex; name: string } | { error: string } {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return { error: "ENS name: empty" };
  if (!trimmed.includes(".")) {
    return { error: `ENS name: "${trimmed}" has no TLD - did you mean "${trimmed}.eth"?` };
  }
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    return {
      error:
        "ENS name: contains non-ASCII characters, which need UTS-46 normalisation this client does not perform",
    };
  }
  try {
    return { node: namehash(trimmed), name: trimmed };
  } catch (error) {
    return { error: `ENS name: ${describe(error)}` };
  }
}

/* ------------------------------------------------------------- probe */

/**
 * Confirm each contract we are about to call actually exists on this chain.
 * A wrong address returns `0x` from `eth_getCode` and then every `eth_call`
 * against it returns empty data, which viem surfaces as a decode error that
 * looks like a bug in our ABI. Checking bytecode first turns that into one
 * clear sentence.
 */
export async function probeContracts(): Promise<EnsResult<{ contracts: ContractProbe[]; blockNumber: bigint }>> {
  const targets: Array<{ label: string; address: Address }> = [
    { label: "ENS registry", address: ENS_REGISTRY },
    { label: "PublicResolver", address: ENS_PUBLIC_RESOLVER },
    { label: "ETHRegistrarController", address: ETH_REGISTRAR_CONTROLLER },
    { label: "ERC-6538 registry", address: ERC6538_REGISTRY },
    { label: "ENSv2 UniversalResolverV2", address: ENSV2_UNIVERSAL_RESOLVER },
    { label: "ENSv2 ETHRegistry", address: ENSV2_ETH_REGISTRY },
  ];
  try {
    const client = sepoliaClient();
    const blockNumber = await client.getBlockNumber();
    const contracts: ContractProbe[] = [];
    for (const target of targets) {
      const code = await client.getCode({ address: target.address });
      contracts.push({
        label: target.label,
        address: target.address,
        bytecodeBytes: code ? (code.length - 2) / 2 : 0,
      });
    }
    return { ok: true, contracts, blockNumber };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/* ------------------------------------------------------------- v2 helpers */

/** RFC 1035 wire format: length-prefixed labels, zero terminated. */
function dnsEncode(name: string): Hex {
  const out: number[] = [];
  for (const label of name.split(".")) {
    const bytes = new TextEncoder().encode(label);
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  return toHex(new Uint8Array(out));
}

/**
 * The ENSv2 resolver for a name, or null when the v2 registry tree has none.
 * `findResolver` walks RootRegistry -> ETHRegistry -> ... via `getSubregistry`
 * and returns the deepest resolver it found. A revert means "no v2 name".
 */
async function findResolverV2(name: string): Promise<Address | null> {
  try {
    const [resolver] = await sepoliaClient().readContract({
      address: ENSV2_UNIVERSAL_RESOLVER,
      abi: universalResolverAbi,
      functionName: "findResolver",
      args: [dnsEncode(name)],
    });
    return resolver === ZERO_ADDRESS ? null : resolver;
  } catch {
    return null;
  }
}

/** One resolver call routed through UniversalResolverV2.resolve. */
async function v2Call(name: string, data: Hex): Promise<Hex> {
  const [result] = await sepoliaClient().readContract({
    address: ENSV2_UNIVERSAL_RESOLVER,
    abi: universalResolverAbi,
    functionName: "resolve",
    args: [dnsEncode(name), data],
  });
  return result;
}

async function v2Address(name: string, node: Hex): Promise<Address | null> {
  try {
    const raw = await v2Call(name, encodeFunctionData({ abi: resolverAbi, functionName: "addr", args: [node] }));
    if (raw === "0x") return null;
    const value = decodeFunctionResult({ abi: resolverAbi, functionName: "addr", data: raw });
    return value === ZERO_ADDRESS ? null : value;
  } catch {
    return null;
  }
}

async function v2Text(name: string, node: Hex, key: string): Promise<string> {
  const raw = await v2Call(
    name,
    encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, key] }),
  );
  if (raw === "0x") return "";
  return decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: raw });
}

/**
 * ERC-1155 owner of a second-level .eth name in the v2 ETHRegistry. The
 * canonical token id is the labelhash with its low 32 version bits zeroed.
 * Deeper names live in subregistries this helper does not walk; they report
 * `null` and the caller treats "has a v2 resolver" as registered.
 */
async function v2Owner(name: string): Promise<Address | null> {
  const labels = name.split(".");
  if (labels.length !== 2 || labels[1] !== "eth") return null;
  try {
    const canonicalId = BigInt(keccak256(stringToBytes(labels[0]!))) & ~0xffffffffn;
    const owner = await sepoliaClient().readContract({
      address: ENSV2_ETH_REGISTRY,
      abi: ethRegistryAbi,
      functionName: "ownerOf",
      args: [canonicalId],
    });
    return owner === ZERO_ADDRESS ? null : owner;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- reads */

/**
 * Forward resolution, v2 first. The v2 resolver is the owner's own
 * Permissioned Resolver proxy, which is exactly the contract `setText` has
 * to be sent to — so the address returned here is the write target too.
 */
export async function resolveName(name: string): Promise<EnsResult<ResolvedName>> {
  const parsed = toNode(name);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolver = await findResolverV2(parsed.name);
  if (resolver) {
    try {
      const blockNumber = await sepoliaClient().getBlockNumber();
      return {
        ok: true,
        name: parsed.name,
        node: parsed.node,
        registry: "ensv2",
        owner: await v2Owner(parsed.name),
        resolver,
        address: await v2Address(parsed.name, parsed.node),
        blockNumber,
      };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  }
  return resolveNameV1(name);
}

/** Text record, v2 first. */
export async function readTextRecord(
  name: string,
  key: string,
): Promise<EnsResult<{ name: string; node: Hex; registry: EnsRegistry; resolver: Address; key: string; value: string; blockNumber: bigint }>> {
  const parsed = toNode(name);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolver = await findResolverV2(parsed.name);
  if (resolver) {
    try {
      const blockNumber = await sepoliaClient().getBlockNumber();
      const value = await v2Text(parsed.name, parsed.node, key);
      return { ok: true, name: parsed.name, node: parsed.node, registry: "ensv2", resolver, key, value, blockNumber };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  }
  return readTextRecordV1(name, key);
}

/**
 * Primary name, v2 first. UniversalResolverV2.reverse verifies the forward
 * resolution on chain and reverts on a mismatch, so a name it returns has
 * already passed the round trip.
 */
export async function reverseName(address: Address): Promise<EnsResult<ReverseNameRead>> {
  try {
    const client = sepoliaClient();
    const [name] = await client.readContract({
      address: ENSV2_UNIVERSAL_RESOLVER,
      abi: universalResolverAbi,
      functionName: "reverse",
      args: [address, 60n],
    });
    if (name) {
      return {
        ok: true,
        address,
        registry: "ensv2",
        name: name.toLowerCase(),
        forwardMatches: true,
        blockNumber: await client.getBlockNumber(),
      };
    }
  } catch {
    // No v2 primary name (or it failed the on-chain round trip): try v1.
  }
  return reverseNameV1(address);
}

/* ------------------------------------------------------------- v1 reads */

/**
 * Registry `owner()` + `resolver()`, and the resolver's `addr()`.
 *
 * `owner()` is read straight off the registry rather than trusted from a
 * resolver, because the registry is the authority on who controls a name. The
 * UI shows all three so a judge can see which contract each claim came from.
 */
async function resolveNameV1(name: string): Promise<EnsResult<ResolvedName>> {
  const parsed = toNode(name);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  try {
    const client = sepoliaClient();
    const blockNumber = await client.getBlockNumber();
    const owner = (await client.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: "owner",
      args: [parsed.node],
    })) as Address;
    const resolver = (await client.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [parsed.node],
    })) as Address;

    let address: Address | null = null;
    if (resolver !== ZERO_ADDRESS) {
      try {
        const value = (await client.readContract({
          address: resolver,
          abi: resolverAbi,
          functionName: "addr",
          args: [parsed.node],
        })) as Address;
        address = value === ZERO_ADDRESS ? null : value;
      } catch {
        // A resolver that does not implement addr() is unusual but legal.
        address = null;
      }
    }

    return {
      ok: true,
      name: parsed.name,
      node: parsed.node,
      registry: "ensv1",
      owner: owner === ZERO_ADDRESS ? null : owner,
      resolver: resolver === ZERO_ADDRESS ? null : resolver,
      address,
      blockNumber,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Read an arbitrary text record with a direct `text(node, key)` call.
 *
 * Deliberately NOT `client.getEnsText()`: that helper routes through the
 * UniversalResolver, which adds CCIP-Read handling and its own failure modes,
 * and which reverts rather than returning "" for some unset records. For
 * evidence on screen we want the plainest possible call against the resolver
 * the registry itself names.
 */
async function readTextRecordV1(
  name: string,
  key: string,
): Promise<EnsResult<{ name: string; node: Hex; registry: EnsRegistry; resolver: Address; key: string; value: string; blockNumber: bigint }>> {
  const parsed = toNode(name);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  try {
    const client = sepoliaClient();
    const blockNumber = await client.getBlockNumber();
    const resolver = (await client.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [parsed.node],
    })) as Address;
    if (resolver === ZERO_ADDRESS) {
      return {
        ok: false,
        error: `${parsed.name} has no resolver set in the ENS registry on ${ENS_CHAIN.name}`,
      };
    }
    const value = (await client.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "text",
      args: [parsed.node, key],
    })) as string;
    return { ok: true, name: parsed.name, node: parsed.node, registry: "ensv1", resolver, key, value, blockNumber };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * The load-bearing read: the borrower's X25519 payout key.
 *
 * The ENS manager app will not render a custom key like
 * `privatecredit.payout-key[501]`, so THIS call - node, resolver, key, raw
 * returned string - is the evidence to put on screen. Showing a screenshot of
 * the manager app would prove nothing, because it shows nothing.
 *
 * A successful read with an unparseable value is reported as `ok: true` with
 * `publicKey: null` and a `decodeError`: the chain read genuinely succeeded,
 * and conflating "the record says something we cannot use" with "we could not
 * reach the chain" would misattribute the failure.
 */
export async function readPayoutRecord(name: string): Promise<EnsResult<PayoutRecordRead>> {
  const read = await readTextRecord(name, PAYOUT_RECORD_KEY);
  if (!read.ok) return read;

  const decoded = decodePayoutRecord(read.value);
  return {
    ok: true,
    name: read.name,
    node: read.node,
    registry: read.registry,
    resolver: read.resolver,
    key: read.key,
    value: read.value,
    publicKey: decoded.publicKey ?? null,
    decodeError: decoded.error ?? null,
    blockNumber: read.blockNumber,
  };
}

/**
 * Reverse resolution: `<address>.addr.reverse` -> name, then the forward check.
 *
 * A reverse record alone proves nothing - anyone can point their reverse node
 * at any name. Only the round trip (reverse says N, and N's `addr()` is this
 * address) is a claim worth rendering. `forwardMatches` is that round trip, and
 * it is false unless it actually held.
 */
async function reverseNameV1(address: Address): Promise<EnsResult<ReverseNameRead>> {
  try {
    const client = sepoliaClient();
    const blockNumber = await client.getBlockNumber();
    const reverseNode = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
    const resolver = (await client.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [reverseNode],
    })) as Address;
    if (resolver === ZERO_ADDRESS) {
      return { ok: true, address, registry: "ensv1", name: null, forwardMatches: false, blockNumber };
    }
    const name = (await client.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "name",
      args: [reverseNode],
    })) as string;
    if (!name) {
      return { ok: true, address, registry: "ensv1", name: null, forwardMatches: false, blockNumber };
    }
    const forward = await resolveName(name);
    const forwardMatches =
      forward.ok && forward.address !== null && forward.address.toLowerCase() === address.toLowerCase();
    return { ok: true, address, registry: "ensv1", name, forwardMatches, blockNumber };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * `available()` + `rentPrice()` on the ETHRegistrarController.
 *
 * @param label the 2LD label WITHOUT the `.eth` suffix - that is what the
 *        controller's ABI takes, and passing "foo.eth" here silently prices a
 *        different, invalid name.
 */
export async function checkAvailability(
  label: string,
  durationSeconds: bigint = 31_536_000n,
): Promise<EnsResult<NameAvailability>> {
  const clean = label.trim().toLowerCase();
  if (clean.includes(".")) {
    return {
      ok: false,
      error: `availability: pass the bare label ("${clean.split(".")[0]}"), not the full name`,
    };
  }
  if (clean.length < 3) {
    return { ok: false, error: "availability: .eth labels must be at least 3 characters" };
  }
  try {
    const client = sepoliaClient();
    const blockNumber = await client.getBlockNumber();
    const available = (await client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: controllerAbi,
      functionName: "available",
      args: [clean],
    })) as boolean;

    let priceWei: bigint | null = null;
    if (available) {
      const price = (await client.readContract({
        address: ETH_REGISTRAR_CONTROLLER,
        abi: controllerAbi,
        functionName: "rentPrice",
        args: [clean, durationSeconds],
      })) as { base: bigint; premium: bigint };
      priceWei = price.base + price.premium;
    }

    return {
      ok: true,
      label: clean,
      name: `${clean}.eth`,
      available,
      priceWei,
      priceEth: priceWei === null ? null : formatEth(priceWei),
      durationSeconds,
      blockNumber,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Wei -> a fixed 6-decimal ETH string. Display only; never re-parsed. */
function formatEth(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}
