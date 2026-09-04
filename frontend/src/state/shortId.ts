/**
 * Display-only truncation of a hex value or an opaque id.
 *
 * Deliberately NOT `shortHash` from `shared/policy`. Two components that render
 * in the entry bundle every visitor downloads — the header and the privacy
 * boundary panel on the home page — need to shorten a string for the eye. If
 * they imported the policy mirror for it, Rollup would pull `evaluatePolicy`
 * and `passportCommitment` (the two functions whose source mentions the witness
 * field names) into that entry chunk, purely to truncate text.
 *
 * Keeping this here means the bundle a visitor loads before choosing a party
 * contains nothing witness-shaped at all, and the policy mirror stays in the
 * two lazily-loaded party chunks where it does real work. Identical output to
 * `shortHash`; no protocol dependency.
 */
export function shortId(value: string): string {
  const hasPrefix = value.startsWith("0x") || value.startsWith("0X");
  const body = hasPrefix ? value.slice(2) : value;
  const prefix = hasPrefix ? "0x" : "";
  if (body.length <= 10) return prefix + body;
  return prefix + body.slice(0, 6) + "\u2026" + body.slice(-4);
}
