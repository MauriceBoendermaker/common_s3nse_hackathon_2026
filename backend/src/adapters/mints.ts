/**
 * The committed mint allowlist and denylist.
 *
 * Why an allowlist exists at all: a live mainnet wallet sampled during planning
 * held 3830 SPL token accounts and 450 Token-2022 accounts, nearly all of them
 * airdropped junk. Summing every balance a wallet touches produces a
 * meaningless collateral figure, so `assets` is defined as "USD value of the
 * mints on this list", and the passport reports how many accounts were seen
 * versus how many were allowlisted. Every address below was verified live
 * against Jupiter price/v3 (price, decimals and liquidity all present) and
 * against `getAccountInfo` (all owned by the SPL Token program).
 */

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Native SOL has no mint; it is priced through wSOL and treated as a major. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export type MintKind = "stable" | "lst" | "major";

export type MintInfo = {
  symbol: string;
  mint: string;
  decimals: number;
  /**
   * Counts toward `collateralQuality`. True for stablecoins and liquid staking
   * tokens; false for majors, which are real collateral but volatile.
   */
  qualityAsset: boolean;
  kind: MintKind;
};

export const ALLOWLIST: MintInfo[] = [
  // majors — real collateral, volatile, so NOT quality assets.
  { symbol: "wSOL", mint: WSOL_MINT, decimals: 9, qualityAsset: false, kind: "major" },
  { symbol: "WBTC", mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", decimals: 8, qualityAsset: false, kind: "major" },
  { symbol: "WETH", mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", decimals: 8, qualityAsset: false, kind: "major" },

  // stablecoins — quality assets.
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, qualityAsset: true, kind: "stable" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, qualityAsset: true, kind: "stable" },

  // liquid staking tokens — quality assets.
  { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9, qualityAsset: true, kind: "lst" },
  { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9, qualityAsset: true, kind: "lst" },
  { symbol: "bSOL", mint: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", decimals: 9, qualityAsset: true, kind: "lst" },
  { symbol: "JupSOL", mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", decimals: 9, qualityAsset: true, kind: "lst" },
];

/**
 * ILLUSTRATIVE COMMITTED DENYLIST — read this before quoting it anywhere.
 *
 * This is a short list of mints checked into this repository. It is a *policy
 * choice*, not an oracle, not a sanctions feed, and not a compliance product.
 * Nobody has audited it and it confers no regulatory meaning. What is being
 * demonstrated is the *mechanism*: `restrictedExposure` is computed as
 * (the wallet's token accounts) intersected with (a list committed in this
 * repo), so a lender can read the exact list a borrower was screened against
 * and reproduce the verdict. In production the list would be supplied by, and
 * versioned with, the lender's own risk policy.
 *
 * The entries below are high-volatility memecoins and one protocol token whose
 * issuer suffered a well-publicised exploit — the kind of holding a
 * conservative underwriter plausibly screens for. Every address was verified
 * twice on 2026-09-03: identity (symbol -> mint) via the Jupiter token search
 * API, and existence via `getAccountInfo`, which returned a parsed `mint`
 * account owned by the SPL Token program with the decimals shown. Candidates
 * whose address could not be confirmed that way (Wormhole UST, FTT) were
 * deliberately left out: a short honest list beats a long invented one.
 */
export type DenylistEntry = {
  symbol: string;
  mint: string;
  reason: string;
};

export const DENYLIST: DenylistEntry[] = [
  {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    reason: "High-volatility memecoin; excluded from collateral by policy.",
  },
  {
    symbol: "WIF",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    reason: "High-volatility memecoin; excluded from collateral by policy.",
  },
  {
    symbol: "BOME",
    mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
    reason: "High-volatility memecoin; excluded from collateral by policy.",
  },
  {
    symbol: "SAMO",
    mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    reason: "High-volatility memecoin; excluded from collateral by policy.",
  },
  {
    symbol: "MNGO",
    mint: "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac",
    reason: "Governance token of a protocol that suffered a publicised exploit.",
  },
];

export const ALLOWLIST_BY_MINT: Map<string, MintInfo> = new Map(
  ALLOWLIST.map((entry) => [entry.mint, entry]),
);

export const DENYLIST_BY_MINT: Map<string, DenylistEntry> = new Map(
  DENYLIST.map((entry) => [entry.mint, entry]),
);
