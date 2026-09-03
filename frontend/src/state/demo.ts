import { DEMO_WITNESS, PRODUCT_CONFIG } from "../config/product";

export type AppView = "overview" | "borrower" | "lender";
export type ProofStatus = "idle" | "generating" | "ready";
export type VerificationStatus = "idle" | "verifying" | "eligible" | "ineligible";
export type OfferStatus = "none" | "sent" | "accepted";

export type LendingPolicy = {
  minimumAssets: number;
  maximumDebtRatio: number;
  minimumHistoryMonths: number;
  screenRestrictedExposure: boolean;
};

export type DemoState = {
  walletConnected: boolean;
  termsConfirmed: boolean;
  proofStatus: ProofStatus;
  requestPublished: boolean;
  verificationStatus: VerificationStatus;
  offerStatus: OfferStatus;
  amount: number;
  collateral: number;
  termDays: number;
  offerApr: number;
  policy: LendingPolicy;
};

export const INITIAL_DEMO_STATE: DemoState = {
  walletConnected: false,
  termsConfirmed: false,
  proofStatus: "idle",
  requestPublished: false,
  verificationStatus: "idle",
  offerStatus: "none",
  amount: PRODUCT_CONFIG.request.amount,
  collateral: PRODUCT_CONFIG.request.collateral,
  termDays: PRODUCT_CONFIG.request.termDays,
  offerApr: PRODUCT_CONFIG.request.suggestedApr,
  policy: {
    minimumAssets: 100_000,
    maximumDebtRatio: 40,
    minimumHistoryMonths: 12,
    screenRestrictedExposure: true,
  },
};

export type PolicyResult = {
  key: "assets" | "debt" | "history" | "exposure";
  label: string;
  passed: boolean;
  requirement: string;
};

export function evaluatePolicy(policy: LendingPolicy): PolicyResult[] {
  return [
    {
      key: "assets",
      label: "Asset threshold",
      passed: DEMO_WITNESS.assets >= policy.minimumAssets,
      requirement: `At least $${Math.round(policy.minimumAssets / 1000)}k`,
    },
    {
      key: "debt",
      label: "Debt ratio",
      passed: DEMO_WITNESS.debtRatio <= policy.maximumDebtRatio,
      requirement: `No more than ${policy.maximumDebtRatio}%`,
    },
    {
      key: "history",
      label: "Account history",
      passed: DEMO_WITNESS.historyMonths >= policy.minimumHistoryMonths,
      requirement: `${policy.minimumHistoryMonths}+ months`,
    },
    {
      key: "exposure",
      label: "Restricted exposure",
      passed:
        !policy.screenRestrictedExposure || !DEMO_WITNESS.hasRestrictedExposure,
      requirement: policy.screenRestrictedExposure ? "Clean proof required" : "Not required",
    },
  ];
}
