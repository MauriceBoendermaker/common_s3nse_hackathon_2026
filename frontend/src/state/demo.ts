import { DEMO_WITNESS, PRODUCT_CONFIG } from "../config/product";

export type AppView = "overview" | "borrower" | "lender";
export type SourceId = "wallets" | "lending" | "exchange";
export type ProofStatus = "idle" | "generating" | "ready" | "expired" | "failed";
export type VerificationStatus = "idle" | "verifying" | "eligible" | "ineligible" | "expired";
export type OfferStatus = "none" | "funded" | "accepted";
export type LoanStatus = "none" | "funded" | "active" | "repayment_due" | "default_risk" | "repaid";
export type WalletNetwork = "wrong" | "sepolia";
export type WalletActionKind =
  | "connect-applicant"
  | "connect-provider"
  | "publish-request"
  | "fund-offer"
  | "accept-offer"
  | "draw-loan"
  | "repay-loan";
export type WalletActionStatus =
  | "wrong_network"
  | "awaiting_signature"
  | "confirming"
  | "confirmed"
  | "rejected"
  | "failed";

export type WalletActionState = {
  kind: WalletActionKind;
  status: WalletActionStatus;
};

export type LendingPolicy = {
  minimumAssets: number;
  maximumDebtRatio: number;
  minimumHistoryMonths: number;
  screenRestrictedExposure: boolean;
};

export type DemoState = {
  applicantWalletConnected: boolean;
  providerWalletConnected: boolean;
  walletNetwork: WalletNetwork;
  ensVerified: boolean;
  identityConfirmed: boolean;
  connectedSources: SourceId[];
  sourceUnavailable: boolean;
  passportReady: boolean;
  proofStatus: ProofStatus;
  requestPublished: boolean;
  challengePolicy: LendingPolicy | null;
  verificationStatus: VerificationStatus;
  offerStatus: OfferStatus;
  offersAvailable: boolean;
  noQualifyingOffers: boolean;
  selectedOfferId: string;
  loanStatus: LoanStatus;
  amount: number;
  collateral: number;
  termDays: number;
  offerApr: number;
  policy: LendingPolicy;
};

export const INITIAL_DEMO_STATE: DemoState = {
  applicantWalletConnected: false,
  providerWalletConnected: false,
  walletNetwork: "wrong",
  ensVerified: false,
  identityConfirmed: false,
  connectedSources: [],
  sourceUnavailable: false,
  passportReady: false,
  proofStatus: "idle",
  requestPublished: false,
  challengePolicy: null,
  verificationStatus: "idle",
  offerStatus: "none",
  offersAvailable: false,
  noQualifyingOffers: false,
  selectedOfferId: "vault",
  loanStatus: "none",
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

export type CapitalOffer = {
  id: string;
  lender: string;
  apr: number;
  deposit: number;
  fee: number;
  note: string;
  isDemoCompetitor: boolean;
};

export function getCapitalOffers(demo: DemoState): CapitalOffer[] {
  return [
    {
      id: "vault",
      lender: PRODUCT_CONFIG.lender.ensName,
      apr: demo.offerApr,
      deposit: demo.collateral,
      fee: 125,
      note: "Policy creator · funded offer",
      isDemoCompetitor: false,
    },
    ...PRODUCT_CONFIG.competingOffers.map((offer) => ({
      ...offer,
      isDemoCompetitor: true,
    })),
  ];
}

export function getTotalRepayment(
  amount: number,
  apr: number,
  termDays: number,
  fee: number,
) {
  return amount + amount * (apr / 100) * (termDays / 365) + fee;
}

export function getPolicyFingerprint(policy: LendingPolicy | null) {
  if (!policy) return "Not issued";
  const seed =
    policy.minimumAssets * 17 +
    policy.maximumDebtRatio * 101 +
    policy.minimumHistoryMonths * 1009 +
    (policy.screenRestrictedExposure ? 7919 : 0);
  const first = (seed >>> 0).toString(16).padStart(8, "0");
  const second = ((seed * 2654435761) >>> 0).toString(16).padStart(8, "0");
  return `0x${first}…${second}`;
}

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
