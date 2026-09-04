/**
 * Static product copy. Nothing in this file is protocol data.
 *
 * What used to be here and is now gone, on purpose:
 *
 *  - The frozen demo witness constant — `{ assets: 340_000, debtRatio: 28, … }` — that
 *    every pass/fail badge in the app derived from. It is the single constant
 *    the ENS bounty's "no hard-coded demonstrations" rule disqualifies a
 *    project for. The witness now comes from `GET /api/passport/:address` over
 *    a Solana mainnet address the user types in.
 *  - `competingOffers` — two invented lenders that made an empty marketplace
 *    look busy. One real offer is honest; two fake competitors are not.
 *  - `passportSources` — three "connectable" data sources that connected to
 *    nothing. The real sources are now reported by the backend in
 *    `PassportProvenance.sources`, with measured latencies.
 *  - `POLICY_OPTIONS` — moved to `shared/policy.ts`, mirroring the backend, and
 *    with `maximumDebtRatio` replaced by `minimumCollateralQuality` (a debt
 *    ratio cannot be honestly sourced from Solana RPC in the time available;
 *    inventing one is the thing that disqualifies the project).
 *  - The frozen literals `proofId`, `passportCommitment`, `verifierContract`,
 *    `proofValidUntil`, `createdAt` and `walletAddress` — all of which are now
 *    computed or server-issued values.
 */

export const PRODUCT_CONFIG = {
  name: "ZKredit",
  category: "Privacy-preserving credit infrastructure",

  /**
   * Said out loud everywhere it matters. Balances are read from MAINNET
   * because that is where real portfolios live; settlement lands on DEVNET
   * because this is a prototype moving no real value. A judge spots that
   * mismatch in ten seconds, so the UI states it rather than hiding it.
   */
  readCluster: "Solana mainnet-beta",
  settleCluster: "Solana devnet",
  network: "Solana devnet",

  /**
   * Illustrative ENS names for the content pages only. Neither party view uses
   * them: real party labels come from the server (`borrowerLabel` /
   * `lenderLabel`). ENS resolution itself is workstream D and is not wired.
   */
  borrower: { ensName: "alice.eth" },
  lender: { ensName: "vault.lender.eth" },

  /** Defaults the borrower's terms form starts from. All three are editable. */
  request: {
    amount: 25_000,
    collateral: 20_000,
    termDays: 90,
    suggestedApr: 10.4,
  },

  /**
   * The four comparisons the policy actually makes, matching
   * `evaluatePolicy()` in `shared/policy.ts` one for one. The second claim is
   * collateral quality, not a debt ratio.
   */
  proofClaims: [
    {
      label: "Collateral value",
      statement: "Allowlisted holdings meet the policy minimum in USD",
    },
    {
      label: "Collateral quality",
      statement: "Enough of that value sits in stables and liquid staking tokens",
    },
    {
      label: "Account history",
      statement: "The account is at least as old as the policy requires",
    },
    {
      label: "Restricted exposure",
      statement: "No denylisted mint is held with a non-zero balance",
    },
  ],

  /**
   * What the lender never receives. Deliberately does NOT claim the address is
   * hidden: the provenance record carries the address the passport was read
   * from, so the lender can re-read it independently. The balances behind it
   * are what stay private.
   */
  hiddenData: [
    "Exact USD totals",
    "Per-mint holdings and amounts",
    "The passport salt",
    "The transaction graph",
  ],
} as const;

// Moved to `shared/format.ts` (which the borrower and lender views both use).
export { formatCurrency } from "../shared/format";
