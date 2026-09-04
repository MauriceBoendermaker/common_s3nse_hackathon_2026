// GENERATED FILE — do not edit.
// Mirror of backend/src/protocol/types.ts. Regenerate with `npm run sync:types`.

/**
 * Canonical protocol contract.
 *
 * This file is the single source of truth for every object that crosses the
 * borrower <-> backend <-> lender boundary. It is mirrored verbatim into
 * `frontend/src/shared/protocol-types.ts` by `npm run sync:types` — edit this
 * file, never the mirror.
 *
 * Two hard rules encoded here:
 *
 *  1. No TypeScript `enum`. Node 22's native type-stripping refuses `enum`
 *     (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) and `node --watch src/index.ts` dies
 *     on it. Every closed set is a string union.
 *
 *  2. No witness type exists on the wire. The raw portfolio snapshot
 *     (`assets`, `collateralQuality`, `historyMonths`, `restrictedExposure`)
 *     is returned by `GET /api/passport/:address` to the borrower and is never
 *     accepted by, or stored in, any other endpoint. The lender's projection of
 *     the shared state is therefore structurally incapable of containing it.
 */

/* ------------------------------------------------------------------ roles */

export type Role = "borrower" | "lender";

export type Party = {
  sessionId: string;
  role: Role;
  label: string;
  createdAt: number;
};

/* ------------------------------------------------------------- the witness */

/**
 * The private snapshot. Lives in exactly two places: the response body of
 * `GET /api/passport/:address`, and the borrower browser's memory. It is never
 * persisted by the backend and never appears in `GET /api/state`.
 */
export type Witness = {
  /** Whole USD, allowlisted mints only. */
  assets: number;
  /** Percent 0-100 of `assets` held in allowlisted stables + liquid staking tokens. */
  collateralQuality: number;
  /** Whole months of on-chain history, or null when the bounded scan could not establish it. */
  historyMonths: number | null;
  /** True when any denylisted mint is held with a non-zero balance. */
  restrictedExposure: boolean;
};

export type HistoryConfidence =
  /** A page returned < pageSize: the first signature was reached, value is exact. */
  | "exact"
  /** Oldest signature seen already predates the horizon: value is a floor. */
  | "lower_bound"
  /** Page cap hit without either condition. `historyMonths` is null. Fail closed. */
  | "indeterminate";

export type HoldingBreakdown = {
  symbol: string;
  mint: string;
  /** Human-readable token amount. */
  amount: number;
  usdValue: number;
  /** Counts toward `collateralQuality` (stablecoin or liquid staking token). */
  qualityAsset: boolean;
  priceUsd: number;
  liquidityUsd: number;
};

export type ProvenanceSource = {
  name: string;
  endpoint: string;
  /** Milliseconds the call took, for the on-screen provenance strip. */
  latencyMs: number;
  ok: boolean;
  detail: string;
};

/**
 * Everything needed to render the provenance strip that answers "how do I know
 * this isn't hard-coded?". Carried alongside every passport response and copied
 * (minus the witness) onto the published request.
 */
export type PassportProvenance = {
  address: string;
  /** Where balances were read. Deliberately mainnet while settlement is devnet. */
  readCluster: string;
  settleCluster: string;
  fetchedAt: string;
  sources: ProvenanceSource[];
  allowlist: Array<{ symbol: string; mint: string; qualityAsset: boolean }>;
  denylist: Array<{ symbol: string; mint: string }>;
  history: {
    confidence: HistoryConfidence;
    pagesScanned: number;
    pageCap: number;
    signaturesSeen: number;
    horizonMonths: number;
    oldestBlockTime: string | null;
  };
  /** Non-fatal problems worth showing: thin liquidity, unpriced mint, etc. */
  warnings: string[];
};

export type PassportResponse = {
  witness: Witness;
  holdings: HoldingBreakdown[];
  /** Total USD of allowlisted holdings that were ignored for quality purposes. */
  ignoredTokenAccounts: number;
  provenance: PassportProvenance;
};

/* -------------------------------------------------------------- the policy */

/**
 * The four underwriting comparisons. `minimumCollateralQuality` replaces the
 * old `maximumDebtRatio`: real borrow positions cannot be honestly sourced from
 * Solana RPC in the time available, and inventing them is the exact thing that
 * disqualifies the project. Collateral quality is measurable from the same
 * balances we already read. The circuit shape is unchanged — still four
 * comparisons, still LessEqThan/GreaterEqThan.
 */
export type LendingPolicy = {
  minimumAssets: number;
  minimumCollateralQuality: number;
  minimumHistoryMonths: number;
  screenRestrictedExposure: boolean;
};

export type PolicyResultKey = "assets" | "quality" | "history" | "exposure";

export type PolicyResult = {
  key: PolicyResultKey;
  label: string;
  passed: boolean;
  requirement: string;
};

/* ------------------------------------------------------------ the entities */

export type RequestStatus =
  | "open"
  | "challenged"
  | "proven"
  | "funded"
  | "accepted"
  | "withdrawn";

export type CreditRequest = {
  id: string;
  borrowerSessionId: string;
  borrowerLabel: string;
  amount: number;
  collateral: number;
  termDays: number;
  /** Poseidon(assets, collateralQuality, historyMonths, restrictedExposure, salt). */
  passportCommitment: string;
  /** Provenance only. Contains no portfolio values. */
  provenance: PassportProvenance;
  /**
   * The applicant's ENS identity, lowercased. This is the ONLY public
   * identifier of the applicant: the Solana address in `provenance.address` is
   * where the portfolio was read, not who the applicant is.
   *
   * The lender's client cannot pay without resolving it: the X25519 payout key
   * lives in that name's `privatecredit.payout-key[501]` text record, and the
   * one-time payout address is derived from that key. There is no other key
   * source. A request without a published record cannot be listed.
   */
  ensName: string;
  status: RequestStatus;
  createdAt: number;
};

/**
 * Where the X25519 payout key the lender derived against came from. There is
 * exactly one source: a direct `text(node, key)` call against the resolver the
 * ENS registry names for the applicant's name.
 */
export type PayoutKeySource = "ens-text-record";

export type ChallengeStatus = "pending" | "answered" | "withdrawn";

export type PolicyChallenge = {
  id: string;
  requestId: string;
  lenderSessionId: string;
  lenderLabel: string;
  policy: LendingPolicy;
  /** Poseidon over the four thresholds. Recomputed server-side; client is trusted for nothing. */
  policyHash: string;
  /** Binds the proof to this verifier so it cannot be replayed elsewhere. */
  verifierCommitment: string;
  nonce: string;
  expiresAt: number;
  status: ChallengeStatus;
  createdAt: number;
};

/**
 * The public signal layout, fixed here so circuit, program and both clients
 * agree. Index order matches BACKEND_PLAN.md section 3.2.
 */
/**
 * The seven public signals of `zk/circuits/credit_policy.circom`, in wire
 * order. This declaration is one of four copies of the same contract — the
 * others are the circuit's header comment, the generated
 * `frontend/src/shared/signalLayout.ts`, and the Solana program's `VK_*`
 * constants in `zk/build/vk_data.rs`.
 *
 * `zk/build.mjs` re-derives the order from the COMPILED circuit (the `.r1cs`
 * header plus the `.sym` symbol table) and fails the build if it stops
 * matching. Do not renumber these by hand.
 */
export type PublicSignals = {
  /** [0] */ passportCommitment: string;
  /** [1] */ eligible: boolean;
  /** [2] */ policyHash: string;
  /** [3] Poseidon(subjectId, blindingFactor) — never a raw namehash. */
  subjectCommitment: string;
  /** [4] unix seconds */ expiry: number;
  /** [5] Poseidon(salt, policyHash, verifierCommitment) — seeds the replay guard. */
  nullifier: string;
  /**
   * [6] Poseidon(lenderLabel, lenderSessionId) — the verifier this proof was
   * issued to.
   *
   * PUBLIC on purpose. It is an input to the nullifier at [5], and if it were
   * private the prover could compute that nullifier against a verifier of
   * their own choosing: the binding would still typecheck and would mean
   * nothing. Public, the circuit forces the nullifier to be derived from the
   * verifier commitment the lender actually published, so a receipt issued to
   * lender A cannot be presented to lender B.
   */
  verifierCommitment: string;
};

/**
 * `groth16-bn254` is the live proof system: a real BN254 Groth16 proof of
 * `zk/circuits/credit_policy.circom`, produced in the borrower's browser by a
 * Web Worker and verified server-side with `snarkjs.groth16.verify` against
 * `zk/build/verification_key.json`.
 *
 * `policy-eval-v0` was the pre-circuit stand-in: the borrower's client
 * evaluated the four comparisons locally and sent only the pass/fail bits. It
 * remains in this union for the migration and for the store's self-test, but
 * `POST /api/proofs` REFUSES it whenever a verifying key is loaded — a receipt
 * that merely asserts four booleans is strictly weaker than one the server can
 * check, and silently falling back to it is how a demo ends up claiming
 * "verified" about nothing.
 */
export type ProofSystem = "groth16-bn254" | "policy-eval-v0";

export type VerificationStatus = "pending" | "verified" | "rejected";

export type ProofSubmission = {
  id: string;
  requestId: string;
  challengeId: string;
  proofSystem: ProofSystem;
  publicSignals: PublicSignals;
  /** Per-check outcomes. Pass/fail only — never the values that caused them. */
  results: PolicyResult[];
  /**
   * The Groth16 proof, as JSON:
   * `{"proof": <snarkjs groth16 proof>, "publicSignals": [<decimal strings>]}`
   * — about 1.2 KB. Null only for a legacy `policy-eval-v0` receipt.
   *
   * The ORDERED `publicSignals` array travels with the proof on purpose. It is
   * what `snarkjs.groth16.verify` actually checks, so keeping it next to the
   * named `publicSignals` object above lets the server require the two to
   * agree, slot for slot, in the order derived from the compiled circuit. A
   * client cannot renumber the statement it is proving.
   */
  proof: string | null;
  verification: {
    status: VerificationStatus;
    checkedAt: number | null;
    /** Every binding the backend actually re-checked, and what it concluded. */
    checks: Array<{ name: string; passed: boolean; detail: string }>;
    reason: string | null;
  };
  createdAt: number;
};

export type OfferStatus = "open" | "accepted" | "declined" | "withdrawn";

export type Offer = {
  id: string;
  requestId: string;
  proofId: string;
  lenderSessionId: string;
  lenderLabel: string;
  apr: number;
  fee: number;
  deposit: number;
  note: string;
  status: OfferStatus;
  createdAt: number;
};

/* -------------------------------------------------- the ENS payout leg (D) */

/**
 * One derived one-time Solana payout address, published by the LENDER.
 *
 * The lender resolves the borrower's ENS name, reads the X25519 key out of the
 * `privatecredit.payout-key[501]` text record, draws a fresh ephemeral scalar
 * `r`, and computes
 *
 *   ss     = X25519(r, X)
 *   seed   = HKDF-SHA256(ss, salt = requestId, info = "privatecredit/v1/sol-payout")
 *   payout = ed25519 public key of `seed`, base58 -> a Solana address
 *
 * What has to be published for the borrower to recover it is `R = r*G` and the
 * one-byte view tag. Neither reveals the address to a third party: without the
 * borrower's viewing scalar `x`, `R` is an unrelated curve point and the view
 * tag is one byte of a hash only the two parties can compute.
 *
 * ONE ANNOUNCEMENT PER DRAW. Two announcements on the same request carry two
 * different `R` values and therefore two unlinkable payout addresses — that
 * rotation is the point, and the UI renders every announcement so it can be
 * seen rather than asserted.
 *
 * NOTHING HERE MOVES MONEY. There is no Solana program, no SPL escrow and no
 * transfer: a derived address is an address nobody has funded. See
 * BACKEND_PLAN.md workstream E.
 */
export type PayoutAnnouncement = {
  id: string;
  requestId: string;
  offerId: string;
  lenderSessionId: string;
  lenderLabel: string;
  /** The ENS name the lender resolved to obtain the key. */
  ensName: string;
  /** `R = r*G`, 0x + 64 hex. The borrower needs it to recompute the secret. */
  ephemeralPublicKey: string;
  /** 0-255. A scan filter, never a security boundary. */
  viewTag: number;
  /** Base58 ed25519 public key — an ordinary Solana address. */
  payoutAddress: string;
  /** Where the X25519 key came from. Always the ENS text record. */
  keySource: PayoutKeySource;
  /** Block number of the ENS read, when one happened. Evidence, not decoration. */
  ensBlockNumber: string | null;
  /** Exactly what `text(node, key)` returned, verbatim. Empty string is a value. */
  ensRecordValue: string | null;
  createdAt: number;
};

export type LoanStatus =
  | "funded"
  | "active"
  | "repayment_due"
  | "default_risk"
  | "repaid";

export type Loan = {
  id: string;
  offerId: string;
  requestId: string;
  status: LoanStatus;
  principal: number;
  apr: number;
  fee: number;
  termDays: number;
  drawnAt: number | null;
  dueAt: number | null;
  repaidAt: number | null;
  createdAt: number;
};

/* ------------------------------------------------------- the wire envelope */

/**
 * What `GET /api/state` returns. Identical shape for both roles; the *contents*
 * are role-projected by the server. Note the absence of any witness field —
 * that is the trust boundary, expressed in the type system.
 */
/* --------------------------------------------- the Solana settlement leg (E) */

/**
 * One instruction sent to the `private_credit` program, and what came back.
 *
 * Every row here is a real transaction with a real signature on a real
 * cluster. `skipped` exists because the sequence is idempotent: publishing a
 * policy that already exists on chain is not a failure, it is a no-op, and
 * saying so is more honest than re-sending it to make the list look busier.
 */
export type SettlementStepName =
  | "publish_policy"
  | "publish_request"
  | "fund_escrow"
  | "create_payout_account"
  | "present_and_fund"
  | "draw"
  | "repay"
  | "replay_attempt";

export type SettlementStep = {
  name: SettlementStepName;
  label: string;
  /** What this instruction is actually for, in one sentence. */
  detail: string;
  signature: string | null;
  slot: number | null;
  /** The account already existed on chain, so nothing was sent. */
  skipped: boolean;
  /** Compute units the runtime reported. The Groth16 verify dominates. */
  computeUnits: number | null;
  explorerUrl: string | null;
  /** Set only when the instruction failed. Program errors land here verbatim. */
  error: string | null;
};

/** A PDA the settlement created or touched, with an explorer link. */
export type SettlementAccount = {
  name: string;
  role: string;
  address: string;
  explorerUrl: string;
};

export type SettlementStatus = "settled" | "failed";

/**
 * The on-chain half of one loan.
 *
 * Deliberately part of the SHARED state rather than a lender-private object:
 * the whole point of settling on a public chain is that the borrower can check
 * it without asking the lender. Nothing in here is secret — the payout address
 * is unlinkable to the borrower's identity by construction, not by being
 * hidden.
 */
export type Settlement = {
  id: string;
  requestId: string;
  offerId: string;
  /** The backend loan row this settled, when one exists. */
  loanId: string | null;
  cluster: string;
  rpcUrl: string;
  programId: string;
  mint: string;
  mintSymbol: string;
  mintDecimals: number;
  /** The one-time address derived from the borrower's ENS payout key. */
  payoutAddress: string;
  /** Principal in the mint's base units, as a decimal string. */
  principalBaseUnits: string;
  steps: SettlementStep[];
  accounts: SettlementAccount[];
  status: SettlementStatus;
  error: string | null;
  createdAt: number;
};

/**
 * What the backend knows about its own settlement leg, surfaced so the UI can
 * say "devnet, this program id, this mint" instead of asserting it.
 */
export type SettlementConfig = {
  enabled: boolean;
  cluster: string;
  rpcUrl: string;
  programId: string | null;
  mint: string | null;
  mintSymbol: string;
  mintDecimals: number;
  /** SHA-256 of the verifying key the deployed program was built against. */
  vkHash: string | null;
  /** Whether that hash matches the vkey this backend loaded. */
  vkMatches: boolean;
  lender: string | null;
  borrower: string | null;
  lenderSol: number | null;
  /** Present when the program or the config account could not be read. */
  problem: string | null;
  explorerBase: string;
};

export type ProtocolState = {
  version: number;
  serverTime: number;
  requests: CreditRequest[];
  challenges: PolicyChallenge[];
  proofs: ProofSubmission[];
  offers: Offer[];
  loans: Loan[];
  /** One row per derived one-time payout address. See `PayoutAnnouncement`. */
  payouts: PayoutAnnouncement[];
  /** One row per on-chain settlement. See `Settlement`. */
  settlements: Settlement[];
};

export type SessionResponse = {
  sessionId: string;
  role: Role;
  label: string;
};

export type ApiError = {
  error: string;
  detail?: string;
};

/* --------------------------------------------------------- the passport read */

/**
 * `POST /api/passport`. The applicant proves control of the Solana address the
 * passport is read for by signing a fixed message with that address's key.
 * The backend rebuilds the message from `address` + `issuedAt`, verifies the
 * ed25519 signature, and only then reads the chain. Nobody can build a
 * passport over an address they do not hold.
 */
export type PassportRequestBody = {
  address: string;
  /** ISO-8601 timestamp embedded in the signed message. Must be recent. */
  issuedAt: string;
  /** 64-byte ed25519 signature over the message, base58 encoded. */
  signature: string;
};

/* ---------------------------------------------------------- the marketplace */

/**
 * One row on the public marketplace board (`GET /api/market`). Everything
 * here is already public in `ProtocolState`; this is the same data condensed
 * to what a visitor scanning the market needs. No session is required.
 */
export type MarketListing = {
  requestId: string;
  borrowerLabel: string;
  ensName: string;
  amount: number;
  collateral: number;
  termDays: number;
  status: RequestStatus;
  createdAt: number;
  /** Open policy challenges, i.e. lenders currently underwriting. */
  underwriting: number;
  /** Verified-and-eligible receipts on this request. */
  verifiedReceipts: number;
  /** Open + accepted offers. */
  offers: number;
  bestApr: number | null;
  loanStatus: LoanStatus | null;
  settled: boolean;
};

export type MarketBoard = {
  serverTime: number;
  version: number;
  listings: MarketListing[];
  totals: {
    open: number;
    funded: number;
    settled: number;
    requestedUsd: number;
    lenders: number;
  };
};

/* ----------------------------------------------------------- request bodies */

export type PublishRequestBody = {
  sessionId: string;
  amount: number;
  collateral: number;
  termDays: number;
  passportCommitment: string;
  provenance: PassportProvenance;
  /** The applicant's ENS identity. Required: it is the only way to be paid. */
  ensName: string;
};

export type CreateChallengeBody = {
  sessionId: string;
  requestId: string;
  policy: LendingPolicy;
  /** Minutes until the proof receipt expires. */
  validityMinutes?: number;
};

export type SubmitProofBody = {
  sessionId: string;
  requestId: string;
  challengeId: string;
  proofSystem: ProofSystem;
  publicSignals: PublicSignals;
  results: PolicyResult[];
  proof?: string | null;
};

export type CreateOfferBody = {
  sessionId: string;
  requestId: string;
  proofId: string;
  apr: number;
  fee: number;
  deposit: number;
  note?: string;
};

/**
 * LENDER-ONLY. Publishes one derived payout address so the borrower can
 * recover the key for it.
 *
 * The server stores what it is told and re-derives nothing: it holds neither
 * the borrower's viewing scalar nor the lender's ephemeral scalar, so it
 * cannot check that `payoutAddress` really is the address `R` implies. The
 * party that CAN check is the borrower, and does — `PayoutRecovery` in the
 * applicant's tab recomputes the address from `R` and shows the comparison.
 * A lender who announces a wrong address is detected there, immediately.
 */
export type CreatePayoutBody = {
  sessionId: string;
  requestId: string;
  offerId: string;
  ensName: string;
  ephemeralPublicKey: string;
  viewTag: number;
  payoutAddress: string;
  keySource: PayoutKeySource;
  ensBlockNumber?: string | null;
  ensRecordValue?: string | null;
};

/**
 * LENDER-ONLY. Settles one accepted, proven, payout-announced offer on Solana.
 *
 * Takes ids rather than values on purpose: every number that reaches the chain
 * is read from the store's own rows, so a client cannot settle a different
 * amount than the offer it points at.
 */
export type CreateSettlementBody = {
  sessionId: string;
  requestId: string;
  offerId: string;
  proofId: string;
  payoutId: string;
};

/**
 * LENDER-ONLY. Re-sends the SAME `present_and_fund` instruction that already
 * succeeded, to demonstrate that the nullifier PDA makes it impossible twice.
 *
 * The expected outcome is a failure, and the failure is the point: the Solana
 * runtime refuses to create an account that already exists, so the replay
 * never reaches a line of our program. Nothing here is simulated — it is a
 * real transaction that is really rejected.
 */
export type ReplaySettlementBody = {
  sessionId: string;
  settlementId: string;
};
