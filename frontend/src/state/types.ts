/**
 * Local UI types. This file replaces the old `state/demo.ts`.
 *
 * What is NOT here, deliberately: any protocol state. `DemoState` used to hold
 * the borrower's witness, the lender's policy and every lifecycle flag in one
 * object that `App.tsx` passed — with its setter — to both parties. That single
 * object is why every privacy claim in the old UI was decorative.
 *
 * Protocol state now lives on the server and reaches each party through
 * `useProtocolState(role)`. The borrower's witness lives in
 * `borrower/witnessStore.tsx` and nowhere else. All that is left here is the
 * route union and one arithmetic helper that both parties compute identically
 * from the same public loan terms.
 */

/** The three application routes. `config/navigation.ts` widens this. */
export type AppView = "overview" | "borrower" | "lender";

/**
 * Simple interest to maturity, plus the origination fee.
 *
 * Both parties compute this from the SAME public numbers — principal, APR,
 * term and fee are all fields of `Loan`/`Offer`, none of which is private — so
 * agreeing on the figure requires no trust and discloses nothing.
 */
export function getTotalRepayment(
  principal: number,
  apr: number,
  termDays: number,
  fee: number,
): number {
  return principal + principal * (apr / 100) * (termDays / 365) + fee;
}
