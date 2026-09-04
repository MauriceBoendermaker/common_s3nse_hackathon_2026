/**
 * Jupiter price/v3 adapter — keyless, no account, no API key.
 *
 * Shape of the upstream response (verified live):
 *   { "<mint>": { usdPrice, decimals, liquidity, priceChange24h, blockId, createdAt } }
 * Mints with no price are simply absent from the object rather than null, so
 * "absent" is the only "unpriced" signal there is.
 *
 * Two rules this file exists to enforce:
 *   1. It never invents a price. If Jupiter is unreachable it throws and lets
 *      the caller decide whether the whole passport fails.
 *   2. It returns liquidity alongside price so the caller can drop illiquid
 *      mints *by name* in a warning, instead of this module silently hiding
 *      them.
 */

export const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";

/** Holdings thinner than this are dropped by the portfolio builder. */
export const MIN_LIQUIDITY_USD = 250_000;

/** Jupiter accepts a comma-joined id list; keep each URL comfortably short. */
const CHUNK_SIZE = 50;

const CACHE_TTL_MS = 60_000;

const DEFAULT_TIMEOUT_MS = 10_000;

export type PriceRecord = {
  usdPrice: number;
  decimals: number;
  liquidity: number;
};

export type PriceLookup = {
  prices: Map<string, PriceRecord>;
  /** ISO time of this lookup. */
  fetchedAt: string;
  /** Wall-clock ms spent on network calls; 0 when everything was cached. */
  latencyMs: number;
  endpoint: string;
  /** Mints answered from the 60 s in-process cache, i.e. not re-fetched. */
  cachedMints: string[];
  /** Mints that required a network round trip on this call. */
  fetchedMints: string[];
  /** Number of HTTP requests actually issued (0 on a full cache hit). */
  requestCount: number;
  /** Mints that were asked for and that Jupiter had no price for. */
  missingMints: string[];
};

export class PriceError extends Error {
  status: number;
  detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "PriceError";
    this.status = 502;
    this.detail = detail;
  }
}

type CacheEntry = {
  record: PriceRecord;
  expiresAt: number;
};

/**
 * Process-local, keyed by mint. A miss is a miss per mint, so two callers
 * asking for overlapping sets share whatever is still warm.
 */
const cache: Map<string, CacheEntry> = new Map();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Exposed for tests and for the probe script; clears the 60 s cache. */
export function resetPriceCache(): void {
  cache.clear();
}

export async function getPrices(mints: string[]): Promise<PriceLookup> {
  const unique = Array.from(new Set(mints.filter((mint) => mint.length > 0)));
  const now = Date.now();

  const prices: Map<string, PriceRecord> = new Map();
  const cachedMints: string[] = [];
  const misses: string[] = [];

  for (const mint of unique) {
    const hit = cache.get(mint);
    if (hit && hit.expiresAt > now) {
      prices.set(mint, hit.record);
      cachedMints.push(mint);
    } else {
      misses.push(mint);
    }
  }

  let latencyMs = 0;
  let requestCount = 0;
  const fetchedMints: string[] = [];

  for (const group of chunk(misses, CHUNK_SIZE)) {
    const url = `${JUPITER_PRICE_URL}?ids=${group.join(",")}`;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PriceError(
        "Jupiter price/v3 is unreachable, so no USD values can be established.",
        (error as Error).message,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PriceError(
        `Jupiter price/v3 returned HTTP ${response.status}.`,
        body.slice(0, 300),
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new PriceError("Jupiter price/v3 returned malformed JSON.", (error as Error).message);
    }

    requestCount += 1;
    latencyMs += Date.now() - startedAt;

    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const mint of group) {
      const raw = payload[mint] as
        | { usdPrice?: unknown; decimals?: unknown; liquidity?: unknown }
        | undefined;
      // Absent means "no price". Never substitute one.
      if (!raw || raw.usdPrice === undefined || raw.usdPrice === null) continue;
      const record: PriceRecord = {
        usdPrice: toNumber(raw.usdPrice),
        decimals: toNumber(raw.decimals),
        liquidity: toNumber(raw.liquidity),
      };
      prices.set(mint, record);
      cache.set(mint, { record, expiresAt });
      fetchedMints.push(mint);
    }
  }

  const missingMints = unique.filter((mint) => !prices.has(mint));

  return {
    prices,
    fetchedAt: new Date().toISOString(),
    latencyMs,
    endpoint: JUPITER_PRICE_URL,
    cachedMints,
    fetchedMints,
    requestCount,
    missingMints,
  };
}
