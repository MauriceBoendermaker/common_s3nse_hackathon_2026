/**
 * Display formatting. Pure functions, no React, no protocol imports.
 *
 * Everything here is presentation only — none of it is ever fed back into a
 * commitment, a hash or a request body. Round for the eye, never for the field.
 */

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** `$25,000`. Whole dollars — the protocol carries whole USD everywhere. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return usd0.format(value);
}

/**
 * Legacy alias, moved here from `config/product.ts`. Identical to `formatUsd`;
 * kept so existing components keep compiling while the views are rewritten.
 */
export const formatCurrency = formatUsd;

/**
 * `formatPercent(10.4, 1)` -> `10.4%`.
 *
 * The value is already expressed in percentage points (an APR of 10.4 means
 * 10.4%), so this is deliberately NOT `Intl` style `"percent"`, which would
 * multiply by 100 and print `1,040%`.
 */
export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted}%`;
}

/**
 * Token quantities: thousands separators, up to 4 meaningful decimals.
 *
 * Below 1 the fraction window slides so that small balances (0.0000412 WBTC)
 * do not all collapse to `0` — up to 4 significant digits, capped at 8 decimal
 * places so nothing turns into a wall of noise.
 */
export function formatTokenAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  let digits = 4;
  if (magnitude < 1) {
    const leadingZeros = Math.max(0, Math.floor(-Math.log10(magnitude)));
    digits = Math.min(8, leadingZeros + 4);
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `"just now"` / `"12s ago"` / `"4m ago"` / `"3h ago"` / `"2d ago"`.
 * Anything in the future reads `"just now"` rather than a negative age.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const elapsed = now - then;
  if (elapsed < 5 * SECOND) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

/**
 * `"4m 12s"`, `"1h 05m"`, `"2d 3h"`. Negative or sub-second inputs are `"0s"`.
 * Two units at most: a countdown that reads `1h 05m 12s` is noise on a card.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s`;
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    const seconds = Math.floor((ms % MINUTE) / SECOND);
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return `${days}d ${hours}h`;
}

/**
 * Challenge / receipt expiry line: `"expires in 4m 12s"` or `"expired"`.
 *
 * `now` is a required argument so the caller owns the clock — a component that
 * ticks once a second passes its own `Date.now()` and stays deterministic in
 * tests instead of re-reading the wall clock deep inside a formatter.
 */
export function formatCountdown(untilEpochMs: number, now: number): string {
  if (!Number.isFinite(untilEpochMs)) return "—";
  const remaining = untilEpochMs - now;
  if (remaining <= 0) return "expired";
  return `expires in ${formatDuration(remaining)}`;
}
