export const PRODUCT_CONFIG = {
  name: "Private Credit",
  network: "Sepolia",
  category: "Zero-knowledge credit infrastructure",
  borrower: {
    ensName: "alice.eth",
    walletAddress: "0x71F3…33A2",
    proofValidUntil: "02 Oct 2026",
    proofId: "0x74e9…82c1",
    passportCommitment: "0x91ca…0f42",
  },
  lender: {
    ensName: "vault.lender.eth",
    walletAddress: "0x28C4…91B7",
  },
  proof: {
    circuit: "credit-policy-v1.3",
    verifierContract: "0x8E2A…71C0",
    createdAt: "03 Sep 2026 · 16:24 CEST",
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
      statement: "Portfolio meets the policy minimum",
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
  passportSources: [
    {
      id: "wallets",
      name: "Onchain wallets",
      provider: "Wallet signatures",
      chains: ["Ethereum", "Base", "Arbitrum"],
      permission: "Read balances, debt and protocol positions",
      required: true,
    },
    {
      id: "lending",
      name: "Lending history",
      provider: "Aave data adapter",
      chains: ["Ethereum", "Base"],
      permission: "Read health factor and liquidation events",
      required: true,
    },
    {
      id: "exchange",
      name: "Exchange attestation",
      provider: "Threshold attestation",
      chains: ["Optional"],
      permission: "Verify reserves above a threshold only",
      required: false,
    },
  ],
  competingOffers: [
    {
      id: "atlas",
      lender: "atlas.pool.eth",
      apr: 9.9,
      deposit: 25_000,
      fee: 300,
      note: "Lower rate, higher first-loss deposit",
    },
    {
      id: "harbor",
      lender: "harbor.credit.eth",
      apr: 11.1,
      deposit: 15_000,
      fee: 0,
      note: "Lowest deposit and no origination fee",
    },
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
