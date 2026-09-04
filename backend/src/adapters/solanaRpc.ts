/**
 * A very small keyless Solana JSON-RPC client built on global `fetch`.
 *
 * No @solana/web3.js: the four methods this project needs (getBalance,
 * getTokenAccountsByOwner, getSignaturesForAddress, getAccountInfo) are three
 * lines of JSON each, and the SDK would drag in a dependency tree we would then
 * have to justify.
 *
 * Failover policy, deliberately narrow:
 *   - transport failures (network error, HTTP 429, HTTP 5xx) roll over to the
 *     next endpoint, because a different node may well answer;
 *   - a JSON-RPC `error` object is a real answer from a healthy node, so it is
 *     thrown immediately — retrying it elsewhere just burns a second and fails
 *     the same way.
 */

/** Default public endpoints, both verified reachable (getHealth -> "ok"). */
const DEFAULT_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

function readEndpoints(): string[] {
  const override = process.env.SOLANA_RPC_URL;
  if (!override) return DEFAULT_ENDPOINTS;
  const parsed = override
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ENDPOINTS;
}

export const RPC_ENDPOINTS: string[] = readEndpoints();

export const DEFAULT_RPC_TIMEOUT_MS = 15_000;

export class RpcError extends Error {
  /** HTTP-ish status for the route layer: 502 transport, 400 bad request. */
  status: number;
  detail: string;
  method: string;

  constructor(message: string, options: { status?: number; detail?: string; method?: string } = {}) {
    super(message);
    this.name = "RpcError";
    this.status = options.status ?? 502;
    this.detail = options.detail ?? "";
    this.method = options.method ?? "";
  }
}

export type RpcTimed<T> = {
  result: T;
  /** The endpoint that actually answered — for the provenance strip. */
  endpoint: string;
  /** True wall-clock milliseconds for the call that answered. */
  latencyMs: number;
};

export type RpcOptions = {
  timeoutMs?: number;
};

/** Remembered so a healthy fallback keeps being used instead of re-failing. */
let preferredIndex = 0;
let requestId = 0;

/**
 * The canonical entry point: returns the result together with the endpoint that
 * served it and the measured latency, so callers can build honest provenance
 * without guessing. `rpc()` is a thin wrapper for when you only want the value.
 */
export async function rpcTimed<T>(
  method: string,
  params: unknown[],
  opts: RpcOptions = {},
): Promise<RpcTimed<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const endpoints = RPC_ENDPOINTS;
  const failures: string[] = [];

  for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
    const index = (preferredIndex + attempt) % endpoints.length;
    const endpoint = endpoints[index]!;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (requestId += 1),
          method,
          params,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      failures.push(`${endpoint}: ${(error as Error).message}`);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      failures.push(`${endpoint}: HTTP ${response.status}`);
      continue;
    }

    if (!response.ok) {
      // Any other non-2xx: try the next endpoint rather than giving up.
      //
      // This used to throw immediately, on the reasoning that a 4xx which is
      // not rate limiting means "our request is wrong, not the node". That
      // reasoning is false for this endpoint set, and the failure it produced
      // was a demo-killer. Observed live, 2026-09-03:
      //
      //   solana-rpc.publicnode.com does not serve getTokenAccountsByOwner at
      //   all. It answers HTTP 403 with {"code":-32602,"message":"Request
      //   blocked"} — while api.mainnet-beta.solana.com answers the identical
      //   request correctly.
      //
      // Combined with the sticky `preferredIndex` below, that meant a SINGLE
      // transient 429 on mainnet-beta moved every later call to publicnode
      // permanently, and from that moment every passport read failed 502 for
      // the life of the process. Failing over here makes it self-healing: the
      // next successful call moves `preferredIndex` back.
      const body = await response.text().catch(() => "");
      failures.push(`${endpoint}: HTTP ${response.status} ${body.slice(0, 160)}`);
      continue;
    }

    let payload: { result?: T; error?: { code?: number; message?: string } };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      failures.push(`${endpoint}: malformed JSON (${(error as Error).message})`);
      continue;
    }

    if (payload.error) {
      // A real answer. Do not fail over.
      throw new RpcError(`Solana RPC error on ${method}: ${payload.error.message ?? "unknown"}`, {
        status: 502,
        detail: `code ${payload.error.code ?? "?"} from ${endpoint}`,
        method,
      });
    }

    if (payload.result === undefined) {
      failures.push(`${endpoint}: response had neither result nor error`);
      continue;
    }

    preferredIndex = index;
    return { result: payload.result, endpoint, latencyMs: Date.now() - startedAt };
  }

  throw new RpcError(`All Solana RPC endpoints failed for ${method}`, {
    status: 502,
    detail: failures.join(" | "),
    method,
  });
}

export async function rpc<T>(method: string, params: unknown[], opts: RpcOptions = {}): Promise<T> {
  const timed = await rpcTimed<T>(method, params, opts);
  return timed.result;
}

/* ------------------------------------------------------------- base58 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_INDEX: Map<string, number> = new Map(
  BASE58_ALPHABET.split("").map((character, index) => [character, index]),
);

/**
 * Decode base58 (Bitcoin alphabet) to bytes, or null if any character is
 * outside the alphabet. Hand-rolled: it is fifteen lines and saves a dependency.
 */
export function base58Decode(value: string): Uint8Array | null {
  if (value.length === 0) return null;
  const bytes: number[] = [];
  for (const character of value) {
    let carry = BASE58_INDEX.get(character);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Every leading '1' is a leading zero byte.
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/**
 * Input validation for `GET /api/passport/:address`. A Solana address is a
 * 32-byte ed25519 public key, so this actually decodes rather than trusting a
 * regex: `1111111111111111111111111111111` is valid base58 and the right
 * length-ish, but decodes to the wrong number of bytes.
 */
export function isLikelySolanaAddress(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length < 32 || value.length > 44) return false;
  const decoded = base58Decode(value);
  return decoded !== null && decoded.length === 32;
}
