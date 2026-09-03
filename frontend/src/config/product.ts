export const PRODUCT_CONFIG = {
  name: "Private Credit",
  network: "Sepolia",
  category: "Zero-knowledge credit infrastructure",
  borrower: {
    ensName: "alice.eth",
    walletAddress: "0x71F3…33A2",
    proofValidUntil: "02 Oct 2026",
    proofId: "0x74e9…82c1",
  },
  lender: {
    ensName: "vault.lender.eth",
  },
  request: {
    amount: 25_000,
    collateral: 20_000,
    termDays: 90,
    suggestedApr: 10.4,
  },
  proofClaims: [
    {
      label: "Asset threshold",
      statement: "Portfolio meets the lender minimum",
    },
    {
      label: "Debt ratio",
      statement: "Leverage remains below the policy maximum",
    },
    {
      label: "Account history",
      statement: "Required financial history is satisfied",
    },
    {
      label: "Restricted exposure",
      statement: "Counterparty screening requirement is satisfied",
    },
  ],
  hiddenData: [
    "Exact balances",
    "Wallet addresses",
    "Positions and protocols",
    "Transaction graph",
  ],
} as const;

export const POLICY_OPTIONS = {
  minimumAssets: [50_000, 100_000, 250_000, 500_000],
  maximumDebtRatio: [30, 40, 50],
  minimumHistoryMonths: [6, 12, 18],
} as const;

export const DEMO_WITNESS = {
  assets: 340_000,
  debtRatio: 28,
  historyMonths: 14,
  hasRestrictedExposure: false,
} as const;

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
