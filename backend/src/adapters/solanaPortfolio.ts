/**
 * buildWitness() — the borrower's portfolio snapshot, read from Solana mainnet
 * at request time.
 *
 * This module is the reason there is no DEMO_WITNESS constant in this repo.
 * Every number it returns is derived from a network call made while the request
 * was in flight: balances and token accounts from Solana JSON-RPC, USD prices
 * and liquidity from Jupiter price/v3, account age from a bounded
 * getSignaturesForAddress walk. Nothing is seeded, nothing is fixtured, and
 * there is no code path that returns a constant portfolio.
 *
 * Two honesty constraints are load-bearing:
 *
 *  - Balances are read from Solana MAINNET while settlement happens on DEVNET.
 *    That mismatch is deliberate (real portfolios, disposable money) and is
 *    carried in `provenance.readCluster` / `provenance.settleCluster` so the UI
 *    can say it out loud.
 *  - Account age FAILS CLOSED. If the bounded scan cannot establish it,
 *    `historyMonths` is null and the policy evaluator treats null as a failure.
 *    Nothing here extrapolates, guesses, or rounds an unknown into a number.
 *
 * This module is borrower-side only. Nothing under the lender's routes imports
 * it, and the witness it produces is never handed to the backend store.
 */

import type {
  HistoryConfidence,
  HoldingBreakdown,
  PassportProvenance,
  PassportResponse,
  ProvenanceSource,
  Witness,
} from "../protocol/types.ts";
import {
  ALLOWLIST,
  ALLOWLIST_BY_MINT,
  DENYLIST,
  DENYLIST_BY_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./mints.ts";
import { MIN_LIQUIDITY_USD, getPrices } from "./prices.ts";
import { isLikelySolanaAddress, rpcTimed } from "./solanaRpc.ts";

/** Where balances are read. */
export const READ_CLUSTER = "solana-mainnet-beta";
/** Where the loan will settle once workstream E lands. Deliberately different. */
export const SETTLE_CLUSTER = "solana-devnet";

/** getSignaturesForAddress maxes out at 1000 entries per page. */
const SIGNATURE_PAGE_SIZE = 1000;
/** Hard ceiling on pages. A busy wallet can burn 1000 signatures in an hour. */
const PAGE_CAP = 10;
/** Beyond this a floor is enough, because every policy check is a threshold. */
const HISTORY_HORIZON_MONTHS = 24;

/**
 * Solana mainnet-beta genesis, 2020-03-16T00:00:00Z. No signature can honestly
 * carry a blockTime before this.
 *
 * This is not defensive padding — it is a real defect observed live.
 * `solana-rpc.publicnode.com` returned `blockTime: 0` for 97 of the 1000
 * entries on page 4 of a busy wallet, where `api.mainnet-beta.solana.com`
 * returned a correct timestamp for the very same slot range. Trusting a 0 makes
 * the oldest signature look like 1970-01-01, which instantly satisfies the
 * horizon test and reports a brand-new wallet as `lower_bound` 24 months —
 * the single worst failure this file could have. Any blockTime below genesis is
 * therefore treated exactly like `null`: unusable, counted, and surfaced.
 */
const SOLANA_GENESIS_UNIX = 1_584_316_800;

const LAMPORTS_PER_SOL = 1_000_000_000;

export class PassportError extends Error {
  status: number;
  detail: string;

  constructor(message: string, status = 400, detail = "") {
    super(message);
    this.name = "PassportError";
    this.status = status;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------ RPC shapes */

type TokenAccountEntry = {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number | null;
            uiAmountString: string;
          };
        };
      };
    };
  };
};

type SignatureEntry = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  confirmationStatus?: string;
};

/* --------------------------------------------------------------- helpers */

function wholeMonthsBetween(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function monthsAgo(nowMs: number, months: number): number {
  const date = new Date(nowMs);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.getTime();
}

/* ------------------------------------------------------- the history scan */

type HistoryScan = {
  confidence: HistoryConfidence;
  historyMonths: number | null;
  pagesScanned: number;
  signaturesSeen: number;
  oldestBlockTime: string | null;
  sources: ProvenanceSource[];
  warnings: string[];
};

/**
 * Page getSignaturesForAddress backwards until one of three things is true:
 * we reached the account's first signature (exact), we walked past the horizon
 * (a lower bound is sufficient for a threshold policy), or we hit the page cap
 * (indeterminate — fail closed, do not guess).
 */
async function scanHistory(address: string, nowMs: number): Promise<HistoryScan> {
  const sources: ProvenanceSource[] = [];
  const warnings: string[] = [];
  const horizonMs = monthsAgo(nowMs, HISTORY_HORIZON_MONTHS);

  let before: string | undefined;
  let pagesScanned = 0;
  let signaturesSeen = 0;
  let oldestSeconds: number | null = null;
  let unusableBlockTimes = 0;

  const finish = (
    confidence: HistoryConfidence,
    historyMonths: number | null,
  ): HistoryScan => {
    if (unusableBlockTimes > 0) {
      warnings.push(
        unusableBlockTimes +
          " of " +
          signaturesSeen +
          " signatures came back with a missing or pre-genesis blockTime and were excluded from the age calculation. They were not treated as old.",
      );
    }
    return {
      confidence,
      historyMonths,
      pagesScanned,
      signaturesSeen,
      oldestBlockTime:
        oldestSeconds === null ? null : new Date(oldestSeconds * 1000).toISOString(),
      sources,
      warnings,
    };
  };

  while (pagesScanned < PAGE_CAP) {
    const params: unknown[] = before
      ? [address, { limit: SIGNATURE_PAGE_SIZE, before }]
      : [address, { limit: SIGNATURE_PAGE_SIZE }];

    const timed = await rpcTimed<SignatureEntry[]>("getSignaturesForAddress", params, {
      timeoutMs: 20_000,
    });
    pagesScanned += 1;

    const page = Array.isArray(timed.result) ? timed.result : [];
    signaturesSeen += page.length;

    for (const entry of page) {
      // blockTime can be null on old or pruned entries, and at least one public
      // endpoint returns a bogus 0 (see SOLANA_GENESIS_UNIX). Both are skipped
      // when computing the oldest time, but they are still counted and the last
      // entry of the page is still used as the cursor.
      if (typeof entry.blockTime !== "number" || entry.blockTime < SOLANA_GENESIS_UNIX) {
        unusableBlockTimes += 1;
        continue;
      }
      if (oldestSeconds === null || entry.blockTime < oldestSeconds) {
        oldestSeconds = entry.blockTime;
      }
    }

    sources.push({
      name: "getSignaturesForAddress (page " + pagesScanned + ")",
      endpoint: timed.endpoint,
      latencyMs: timed.latencyMs,
      ok: true,
      detail:
        page.length +
        " signatures" +
        (before ? ", before " + before.slice(0, 8) + "..." : ""),
    });

    if (page.length === 0 && pagesScanned === 1) {
      // The address has never appeared in a transaction.
      return finish("exact", 0);
    }

    if (page.length < SIGNATURE_PAGE_SIZE) {
      // A short page means we reached the account's first signature.
      if (oldestSeconds === null) {
        warnings.push(
          "Reached the account's first signature, but no entry carried a usable blockTime, so account age could not be computed. Failing closed.",
        );
        return finish("indeterminate", null);
      }
      return finish("exact", wholeMonthsBetween(oldestSeconds * 1000, nowMs));
    }

    if (oldestSeconds !== null && oldestSeconds * 1000 <= horizonMs) {
      // Already older than the horizon; a floor satisfies any threshold policy.
      return finish("lower_bound", HISTORY_HORIZON_MONTHS);
    }

    const last = page[page.length - 1];
    if (!last) return finish("indeterminate", null);
    before = last.signature;
  }

  warnings.push(
    "Account age could not be established: " +
      PAGE_CAP +
      " pages of " +
      SIGNATURE_PAGE_SIZE +
      " signatures were scanned without reaching the account's first signature or the " +
      HISTORY_HORIZON_MONTHS +
      "-month horizon. Reported as unknown rather than estimated.",
  );
  return finish("indeterminate", null);
}

/* ------------------------------------------------------------ the builder */

export async function buildWitness(address: string): Promise<PassportResponse> {
  if (!isLikelySolanaAddress(address)) {
    throw new PassportError(
      "Not a valid Solana address.",
      400,
      "An address must be base58 and decode to exactly 32 bytes.",
    );
  }

  const startedAtMs = Date.now();
  const sources: ProvenanceSource[] = [];
  const warnings: string[] = [];

  /* 1. native SOL */
  const balance = await rpcTimed<{ context: unknown; value: number }>(
    "getBalance",
    [address, { commitment: "confirmed" }],
    { timeoutMs: 15_000 },
  );
  const lamports = balance.result?.value ?? 0;
  const nativeSol = lamports / LAMPORTS_PER_SOL;
  sources.push({
    name: "getBalance",
    endpoint: balance.endpoint,
    latencyMs: balance.latencyMs,
    ok: true,
    detail: lamports + " lamports (" + nativeSol.toFixed(6) + " SOL)",
  });

  /* 2. token accounts, both token programs */
  const programs: Array<{ label: string; programId: string }> = [
    { label: "getTokenAccountsByOwner (SPL Token)", programId: TOKEN_PROGRAM_ID },
    { label: "getTokenAccountsByOwner (Token-2022)", programId: TOKEN_2022_PROGRAM_ID },
  ];

  /** Every token account the wallet owns, counted before any filtering. */
  let tokenAccountsSeen = 0;
  let allowlistedAccounts = 0;
  const amountByMint: Map<string, number> = new Map();
  const denylistHits: Map<string, number> = new Map();

  for (const program of programs) {
    const timed = await rpcTimed<{ context: unknown; value: TokenAccountEntry[] }>(
      "getTokenAccountsByOwner",
      [
        address,
        { programId: program.programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
      { timeoutMs: 30_000 },
    );

    const accounts = Array.isArray(timed.result?.value) ? timed.result.value : [];
    tokenAccountsSeen += accounts.length;

    let matched = 0;
    for (const account of accounts) {
      const info = account?.account?.data?.parsed?.info;
      if (!info) continue;
      const mint = info.mint;
      const amount = info.tokenAmount?.uiAmount ?? 0;

      // Denylist screening runs BEFORE the allowlist filter, on purpose:
      // restricted exposure is about what the wallet holds, not about what
      // counts as collateral.
      if (amount > 0 && DENYLIST_BY_MINT.has(mint)) {
        denylistHits.set(mint, (denylistHits.get(mint) ?? 0) + amount);
      }

      if (!ALLOWLIST_BY_MINT.has(mint)) continue;
      matched += 1;
      // A wallet can hold several token accounts for the same mint.
      amountByMint.set(mint, (amountByMint.get(mint) ?? 0) + amount);
    }

    allowlistedAccounts += matched;
    sources.push({
      name: program.label,
      endpoint: timed.endpoint,
      latencyMs: timed.latencyMs,
      ok: true,
      detail:
        accounts.length +
        " accounts returned, " +
        matched +
        " matched the allowlist",
    });
  }

  /* 3. prices — held allowlisted mints plus wSOL, which prices native SOL */
  const mintsToPrice: Set<string> = new Set(amountByMint.keys());
  if (nativeSol > 0) mintsToPrice.add(WSOL_MINT);

  type PriceLookup = Awaited<ReturnType<typeof getPrices>>;
  let priceLookup: PriceLookup | null = null;

  if (mintsToPrice.size > 0) {
    priceLookup = await getPrices(Array.from(mintsToPrice));
    const cacheNote =
      priceLookup.requestCount === 0
        ? "all " +
          priceLookup.cachedMints.length +
          " mints served from the 60s cache, no network call"
        : priceLookup.requestCount +
          " request(s): " +
          priceLookup.fetchedMints.length +
          " mints fetched, " +
          priceLookup.cachedMints.length +
          " from cache";
    sources.push({
      name: "Jupiter price/v3",
      endpoint: priceLookup.endpoint,
      latencyMs: priceLookup.latencyMs,
      ok: true,
      detail: cacheNote,
    });
    for (const mint of priceLookup.missingMints) {
      const info = ALLOWLIST_BY_MINT.get(mint);
      warnings.push(
        "No Jupiter price for " +
          (info ? info.symbol : mint) +
          " (" +
          mint +
          "); excluded from assets rather than valued at a guess.",
      );
    }
  }

  /* 4. holdings, liquidity floor, totals */
  const holdings: HoldingBreakdown[] = [];
  let assetsUsd = 0;
  let qualityUsd = 0;

  const addHolding = (
    symbol: string,
    mint: string,
    amount: number,
    qualityAsset: boolean,
  ): void => {
    const price = priceLookup ? priceLookup.prices.get(mint) : undefined;
    if (!price) return;
    if (price.liquidity < MIN_LIQUIDITY_USD) {
      warnings.push(
        "Dropped " +
          symbol +
          " (" +
          mint +
          "): Jupiter reports $" +
          Math.round(price.liquidity).toLocaleString("en-US") +
          " of liquidity, below the $" +
          MIN_LIQUIDITY_USD.toLocaleString("en-US") +
          " floor.",
      );
      return;
    }
    const usdValue = amount * price.usdPrice;
    holdings.push({
      symbol,
      mint,
      amount,
      usdValue,
      qualityAsset,
      priceUsd: price.usdPrice,
      liquidityUsd: price.liquidity,
    });
    assetsUsd += usdValue;
    if (qualityAsset) qualityUsd += usdValue;
  };

  if (nativeSol > 0) {
    // Native SOL is priced through wSOL and treated exactly like wSOL: real
    // collateral, but volatile, so it does not count toward quality.
    addHolding("SOL", WSOL_MINT, nativeSol, false);
  }
  for (const [mint, amount] of amountByMint) {
    if (amount <= 0) continue;
    const info = ALLOWLIST_BY_MINT.get(mint);
    if (!info) continue;
    addHolding(info.symbol, mint, amount, info.qualityAsset);
  }

  holdings.sort((a, b) => b.usdValue - a.usdValue);

  const assets = Math.round(assetsUsd);
  const collateralQuality =
    assetsUsd <= 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((100 * qualityUsd) / assetsUsd)));

  /* 5. restricted exposure */
  const restrictedExposure = denylistHits.size > 0;
  for (const [mint] of denylistHits) {
    const entry = DENYLIST_BY_MINT.get(mint);
    warnings.push(
      (
        "Restricted exposure: the wallet holds a non-zero balance of " +
        (entry ? entry.symbol : mint) +
        ". " +
        (entry ? entry.reason : "")
      ).trim(),
    );
  }

  /* 6. the bounded history scan */
  const history = await scanHistory(address, startedAtMs);
  for (const source of history.sources) sources.push(source);
  for (const warning of history.warnings) warnings.push(warning);

  if (tokenAccountsSeen > 0) {
    warnings.push(
      tokenAccountsSeen +
        " token accounts were read from this wallet and " +
        allowlistedAccounts +
        " matched the committed allowlist. Everything else was ignored: an unfiltered sum would not be a collateral figure.",
    );
  }

  const witness: Witness = {
    assets,
    collateralQuality,
    historyMonths: history.historyMonths,
    restrictedExposure,
  };

  const provenance: PassportProvenance = {
    address,
    readCluster: READ_CLUSTER,
    settleCluster: SETTLE_CLUSTER,
    fetchedAt: new Date(startedAtMs).toISOString(),
    sources,
    allowlist: ALLOWLIST.map((entry) => ({
      symbol: entry.symbol,
      mint: entry.mint,
      qualityAsset: entry.qualityAsset,
    })),
    denylist: DENYLIST.map((entry) => ({ symbol: entry.symbol, mint: entry.mint })),
    history: {
      confidence: history.confidence,
      pagesScanned: history.pagesScanned,
      pageCap: PAGE_CAP,
      signaturesSeen: history.signaturesSeen,
      horizonMonths: HISTORY_HORIZON_MONTHS,
      oldestBlockTime: history.oldestBlockTime,
    },
    warnings,
  };

  return {
    witness,
    holdings,
    // The number of token accounts this wallet owns, counted before the
    // allowlist filter. On a busy wallet this is in the thousands against a
    // handful of priced holdings, which is the clearest available evidence
    // that the allowlist is doing real work.
    ignoredTokenAccounts: tokenAccountsSeen,
    provenance,
  };
}
