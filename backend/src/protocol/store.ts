/**
 * The in-memory marketplace store.
 *
 * A `Map` per entity plus a monotonic `version`. No database, no filesystem,
 * no cache layer -- the whole point of this module is that the shared state
 * between the two browsers is small, explicit and inspectable. Restarting the
 * backend wipes it, which is correct for a demo and honest about what it is.
 *
 * THE TRUST BOUNDARY LIVES HERE, and it is structural rather than
 * conventional:
 *
 *   There is no field on any object in this file that can hold a `Witness`.
 *   `assets`, `collateralQuality`, `historyMonths` and `restrictedExposure`
 *   are not stored, not accepted by any method, and not present in
 *   `ProtocolState`. The lender cannot read the borrower's portfolio from this
 *   store because there is nothing in it to read -- not because a projection
 *   remembered to filter it out. `store.ts` does not import `Witness`, and it
 *   could not usefully do so.
 *
 * Node 22 runs this file directly under native type stripping: no `enum`, no
 * `namespace`, no constructor parameter properties, and every relative import
 * carries its `.ts` extension.
 */

import { randomUUID } from "node:crypto";

import { randomFieldElement } from "./hashing.ts";
import type {
  CreateChallengeBody,
  CreateOfferBody,
  CreatePayoutBody,
  CreditRequest,
  LendingPolicy,
  Loan,
  Offer,
  Party,
  PassportProvenance,
  PayoutAnnouncement,
  PayoutKeySource,
  PolicyChallenge,
  PolicyResult,
  ProofSubmission,
  ProtocolState,
  PublicSignals,
  PublishRequestBody,
  Role,
  SubmitProofBody,
} from "./types.ts";

/* ------------------------------------------------------------------ errors */

/**
 * Every rejection in this module throws one of these. Routes translate
 * `status` into an HTTP code and `{ error, detail }` into an `ApiError` body,
 * so error handling is one `catch` in one place rather than scattered
 * `res.status(...)` calls.
 *
 * `status` is a plain number: a TypeScript `enum` would crash Node's type
 * stripping at startup.
 */
export class ProtocolError extends Error {
  status: number;
  detail: string | undefined;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "ProtocolError";
    this.status = status;
    this.detail = detail;
  }
}

/* -------------------------------------------------------------- validation */

const HEX_FIELD = /^0x[0-9a-fA-F]{1,64}$/;

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Throws 403 unless `party` exists and holds `role`. Returns it narrowed. */
export function assertRole(party: Party | undefined, role: Role): Party {
  if (!party) {
    throw new ProtocolError(403, "Unknown session", "Create a session before calling this endpoint.");
  }
  if (party.role !== role) {
    throw new ProtocolError(
      403,
      "Wrong role for this action",
      `This endpoint is ${role}-only; the session ${party.sessionId} is a ${party.role}.`,
    );
  }
  return party;
}

/** Throws 400 unless `value` is a finite number inside `[min, max]`. */
export function assertFiniteNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError(400, `${name} must be a finite number`, `Received: ${String(value)}`);
  }
  if (value < min || value > max) {
    throw new ProtocolError(
      400,
      `${name} is out of range`,
      `Expected ${min} to ${max}, received ${value}.`,
    );
  }
  return value;
}

/**
 * Throws 400 unless `value` is `0x`-prefixed hex of at most 64 digits whose
 * numeric value is below the BN254 modulus.
 *
 * The range check is not decoration: an out-of-field "commitment" can never be
 * reproduced by the circuit or by the on-chain recompute, so accepting one
 * would mean storing a value that is guaranteed to fail verification later,
 * for reasons that would look random.
 *
 * Returns the value lowercased, so that hex which differs only in case cannot
 * produce two distinct nullifier keys and defeat the replay guard.
 */
export function assertHexField(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new ProtocolError(400, `${name} must be a hex string`, `Received: ${typeof value}`);
  }
  const text = value.trim();
  if (!HEX_FIELD.test(text)) {
    throw new ProtocolError(
      400,
      `${name} is not a field element`,
      "Expected 0x-prefixed hex, 1-64 digits.",
    );
  }
  if (BigInt(text) >= FIELD_MODULUS) {
    throw new ProtocolError(
      400,
      `${name} is not reduced into the BN254 field`,
      "Reduce mod r before sending; an unreduced value can never verify.",
    );
  }
  return text.toLowerCase();
}

/**
 * Fixed-width hex, NOT reduced into the BN254 field.
 *
 * An X25519 public key is 32 bytes of curve point, not a field element; about
 * one in seven of them exceeds the BN254 modulus, so running one through
 * `assertHexField` would reject perfectly valid keys roughly 14% of the time
 * — the kind of intermittent failure that costs an afternoon.
 */
function assertHexBytes(value: unknown, name: string, byteLength: number): string {
  if (typeof value !== "string") {
    throw new ProtocolError(400, `${name} must be a hex string`, `Received: ${typeof value}`);
  }
  const text = value.trim().toLowerCase();
  const expected = 2 + byteLength * 2;
  if (!/^0x[0-9a-f]+$/.test(text) || text.length !== expected) {
    throw new ProtocolError(
      400,
      `${name} is not ${byteLength} bytes of hex`,
      `Expected a 0x-prefixed string of exactly ${expected} characters, got ${text.length}.`,
    );
  }
  return text;
}

/**
 * A `.eth` name, lowercased. Deliberately permissive about labels (ENS itself
 * normalises with ENSIP-15, which this store does not implement and must not
 * pretend to) and strict about shape, so that what is stored is at least
 * something `namehash` can be run over.
 */
function assertEnsName(value: unknown, name: string): string {
  const text = assertString(value, name, 255).trim().toLowerCase();
  // Shape only: at least two dot-separated, non-empty, whitespace-free labels.
  // ENS's own normalisation is ENSIP-15, which this store does not implement
  // and therefore must not claim to enforce.
  if (!/^[^\s.]+(\.[^\s.]+)+$/.test(text)) {
    throw new ProtocolError(
      400,
      `${name} is not a dotted ENS name`,
      `Received: "${text}". Expected something like "privatecredit.eth".`,
    );
  }
  return text;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function assertBase58Address(value: unknown, name: string): string {
  const text = assertString(value, name, 64).trim();
  if (!BASE58.test(text)) {
    throw new ProtocolError(
      400,
      `${name} is not a Solana address`,
      "Expected 32-44 base58 characters (no 0, O, I or l).",
    );
  }
  return text;
}

function assertPayoutKeySource(value: unknown, name: string): PayoutKeySource {
  if (value !== "ens-text-record" && value !== "local-demo") {
    throw new ProtocolError(
      400,
      `${name} must be "ens-text-record" or "local-demo"`,
      `Received: ${String(value)}`,
    );
  }
  return value;
}

function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new ProtocolError(400, `${name} must be a boolean`, `Received: ${typeof value}`);
  }
  return value;
}

function assertString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ProtocolError(400, `${name} must be a string`, `Received: ${typeof value}`);
  }
  if (value.length > maxLength) {
    throw new ProtocolError(400, `${name} is too long`, `Maximum ${maxLength} characters.`);
  }
  return value;
}

function assertPolicy(value: unknown): LendingPolicy {
  if (!value || typeof value !== "object") {
    throw new ProtocolError(400, "policy is required");
  }
  const raw = value as Record<string, unknown>;
  return {
    minimumAssets: assertFiniteNumber(raw.minimumAssets, "policy.minimumAssets", 0, 1_000_000_000),
    minimumCollateralQuality: assertFiniteNumber(
      raw.minimumCollateralQuality,
      "policy.minimumCollateralQuality",
      0,
      100,
    ),
    minimumHistoryMonths: assertFiniteNumber(
      raw.minimumHistoryMonths,
      "policy.minimumHistoryMonths",
      0,
      600,
    ),
    screenRestrictedExposure: assertBoolean(
      raw.screenRestrictedExposure,
      "policy.screenRestrictedExposure",
    ),
  };
}

/**
 * Provenance is generated by our own passport endpoint and is carried verbatim
 * onto the published request so the lender can see where the numbers came
 * from. It is checked structurally, not exhaustively: it holds no portfolio
 * values, so a malformed one is a cosmetic problem, never a leak.
 */
function assertProvenance(value: unknown): PassportProvenance {
  if (!value || typeof value !== "object") {
    throw new ProtocolError(400, "provenance is required");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.address !== "string" || raw.address.length === 0) {
    throw new ProtocolError(400, "provenance.address is required");
  }
  if (!Array.isArray(raw.sources)) {
    throw new ProtocolError(400, "provenance.sources must be an array");
  }
  return value as PassportProvenance;
}

function assertPolicyResults(value: unknown): PolicyResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProtocolError(400, "results must be a non-empty array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ProtocolError(400, `results[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const key = raw.key;
    if (key !== "assets" && key !== "quality" && key !== "history" && key !== "exposure") {
      throw new ProtocolError(400, `results[${index}].key is not a policy key`);
    }
    return {
      key,
      label: assertString(raw.label, `results[${index}].label`, 120),
      passed: assertBoolean(raw.passed, `results[${index}].passed`),
      requirement: assertString(raw.requirement, `results[${index}].requirement`, 240),
    };
  });
}

function assertPublicSignals(value: unknown): PublicSignals {
  if (!value || typeof value !== "object") {
    throw new ProtocolError(400, "publicSignals is required");
  }
  const raw = value as Record<string, unknown>;
  return {
    passportCommitment: assertHexField(raw.passportCommitment, "publicSignals.passportCommitment"),
    eligible: assertBoolean(raw.eligible, "publicSignals.eligible"),
    policyHash: assertHexField(raw.policyHash, "publicSignals.policyHash"),
    subjectCommitment: assertHexField(raw.subjectCommitment, "publicSignals.subjectCommitment"),
    expiry: assertFiniteNumber(raw.expiry, "publicSignals.expiry", 0, 4_102_444_800),
    nullifier: assertHexField(raw.nullifier, "publicSignals.nullifier"),
    // [6] The verifier this proof was issued to. It is public because the
    // circuit derives the nullifier from it; a private verifierCommitment
    // would let the prover bind the nullifier to a lender of their choosing.
    verifierCommitment: assertHexField(
      raw.verifierCommitment,
      "publicSignals.verifierCommitment",
    ),
  };
}

/* --------------------------------------------------------------- the store */

type StoreState = {
  parties: Map<string, Party>;
  requests: Map<string, CreditRequest>;
  challenges: Map<string, PolicyChallenge>;
  proofs: Map<string, ProofSubmission>;
  offers: Map<string, Offer>;
  loans: Map<string, Loan>;
  payouts: Map<string, PayoutAnnouncement>;
  /** nullifier hex -> the proof id that claimed it first. The replay guard. */
  nullifiers: Map<string, string>;
  version: number;
};

function emptyState(): StoreState {
  return {
    parties: new Map(),
    requests: new Map(),
    challenges: new Map(),
    proofs: new Map(),
    offers: new Map(),
    loans: new Map(),
    payouts: new Map(),
    nullifiers: new Map(),
    version: 1,
  };
}

const DEFAULT_VALIDITY_MINUTES = 30;
const DAY_MS = 86_400_000;

function newestFirst<T extends { createdAt: number }>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => b.createdAt - a.createdAt);
}

class ProtocolStore {
  #state: StoreState = emptyState();
  /** Long-poll wake-ups. Each entry removes itself exactly once. */
  #waiters = new Set<() => void>();

  /* ------------------------------------------------------------- internals */

  /** Bump the version and wake every long-poller. Called by every mutation. */
  #bump(): number {
    this.#state.version += 1;
    const waiters = [...this.#waiters];
    this.#waiters.clear();
    for (const wake of waiters) {
      wake();
    }
    return this.#state.version;
  }

  #requireRequest(id: string): CreditRequest {
    const request = this.#state.requests.get(id);
    if (!request) {
      throw new ProtocolError(404, "Unknown credit request", id);
    }
    return request;
  }

  #requireChallenge(id: string): PolicyChallenge {
    const challenge = this.#state.challenges.get(id);
    if (!challenge) {
      throw new ProtocolError(404, "Unknown policy challenge", id);
    }
    return challenge;
  }

  #requireProof(id: string): ProofSubmission {
    const proof = this.#state.proofs.get(id);
    if (!proof) {
      throw new ProtocolError(404, "Unknown proof submission", id);
    }
    return proof;
  }

  #requireOffer(id: string): Offer {
    const offer = this.#state.offers.get(id);
    if (!offer) {
      throw new ProtocolError(404, "Unknown offer", id);
    }
    return offer;
  }

  #requireLoan(id: string): Loan {
    const loan = this.#state.loans.get(id);
    if (!loan) {
      throw new ProtocolError(404, "Unknown loan", id);
    }
    return loan;
  }

  /** The borrower who published the loan's request. Throws 403 for anyone else. */
  #requireLoanBorrower(loan: Loan, party: Party): CreditRequest {
    assertRole(party, "borrower");
    const request = this.#requireRequest(loan.requestId);
    if (request.borrowerSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This loan belongs to another borrower", loan.id);
    }
    return request;
  }

  /** The lender whose offer became the loan. Throws 403 for anyone else. */
  #requireLoanLender(loan: Loan, party: Party): Offer {
    assertRole(party, "lender");
    const offer = this.#requireOffer(loan.offerId);
    if (offer.lenderSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This loan belongs to another lender", loan.id);
    }
    return offer;
  }

  /* -------------------------------------------------------------- sessions */

  /**
   * Mint or re-attach a session.
   *
   * Reuses the existing party when `requestedSessionId` is known AND its role
   * matches, so a browser refresh keeps its identity. A mismatched role mints a
   * fresh id rather than switching the party's role: one tab must never be able
   * to promote itself from borrower to lender by replaying its own id, because
   * that is exactly the boundary this whole project is about.
   *
   * Does NOT bump `version`. A session is per-browser bookkeeping, not
   * marketplace state, and waking every long-poller because someone opened a
   * tab would make the version counter meaningless.
   */
  createSession(role: Role, requestedSessionId?: string): Party {
    if (role !== "borrower" && role !== "lender") {
      throw new ProtocolError(400, "role must be 'borrower' or 'lender'", String(role));
    }

    if (typeof requestedSessionId === "string" && requestedSessionId.length > 0) {
      const existing = this.#state.parties.get(requestedSessionId);
      if (existing && existing.role === role) {
        return existing;
      }
    }

    const sessionId = randomUUID();
    const party: Party = {
      sessionId,
      role,
      label: (role === "borrower" ? "applicant-" : "provider-") + sessionId.slice(0, 4),
      createdAt: Date.now(),
    };
    this.#state.parties.set(sessionId, party);
    return party;
  }

  getParty(sessionId: string): Party | undefined {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return undefined;
    }
    return this.#state.parties.get(sessionId);
  }

  /* ------------------------------------------------------------ read paths */

  getRequest(id: string): CreditRequest | undefined {
    return this.#state.requests.get(id);
  }

  getChallenge(id: string): PolicyChallenge | undefined {
    return this.#state.challenges.get(id);
  }

  getProof(id: string): ProofSubmission | undefined {
    return this.#state.proofs.get(id);
  }

  getOffer(id: string): Offer | undefined {
    return this.#state.offers.get(id);
  }

  getLoan(id: string): Loan | undefined {
    return this.#state.loans.get(id);
  }

  /** The whole marketplace, newest-first. */
  snapshot(): ProtocolState {
    return {
      version: this.#state.version,
      serverTime: Date.now(),
      requests: newestFirst(this.#state.requests.values()),
      challenges: newestFirst(this.#state.challenges.values()),
      proofs: newestFirst(this.#state.proofs.values()),
      offers: newestFirst(this.#state.offers.values()),
      loans: newestFirst(this.#state.loans.values()),
      payouts: newestFirst(this.#state.payouts.values()),
    };
  }

  /**
   * The role-scoped view returned by `GET /api/state`.
   *
   * Today both roles see every request, challenge, proof, offer and loan. That
   * is not an oversight: a credit marketplace is deliberately public at this
   * tier (BACKEND_PLAN.md, Tier 1). A lender must be able to see open requests
   * it has not challenged, and a borrower must be able to see every competing
   * offer before accepting one.
   *
   * The function exists anyway, because the boundary should be a named,
   * testable thing rather than an absence. And the important property is one
   * no projection could give us: NO projection *can* leak the witness, because
   * `ProtocolState` has no field that could carry it and this store never
   * received it. The privacy guarantee is in the type, not in this filter --
   * that is the whole point. When workstream E adds lender-private settlement
   * detail, it gets filtered here.
   */
  projectFor(role: Role, sessionId: string): ProtocolState {
    if (role !== "borrower" && role !== "lender") {
      throw new ProtocolError(400, "role must be 'borrower' or 'lender'", String(role));
    }
    void sessionId; // reserved: per-session filtering lands with workstream E.
    return this.snapshot();
  }

  /**
   * Long-poll support. Resolves immediately when the caller is already behind,
   * otherwise on the next mutation or after `timeoutMs`, whichever comes first.
   *
   * The timer is always cleared and the resolver is always removed from the
   * set, on both paths -- a poller that times out must not leave a dangling
   * callback that a later mutation invokes.
   */
  waitForChange(sinceVersion: number, timeoutMs: number): Promise<void> {
    const since = Number.isFinite(sinceVersion) ? sinceVersion : 0;
    if (this.#state.version > since) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.#waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, timeoutMs));
      // A pending poll must never be the reason the process stays alive.
      if (typeof timer.unref === "function") {
        timer.unref();
      }
      this.#waiters.add(finish);
    });
  }

  /* -------------------------------------------------------------- requests */

  publishRequest(body: PublishRequestBody, party: Party): CreditRequest {
    assertRole(party, "borrower");

    const amount = assertFiniteNumber(body.amount, "amount", 1, 100_000_000);
    const collateral = assertFiniteNumber(body.collateral, "collateral", 0, 1_000_000_000);
    const termDays = assertFiniteNumber(body.termDays, "termDays", 1, 3_650);
    const commitment = assertHexField(body.passportCommitment, "passportCommitment");
    const provenance = assertProvenance(body.provenance);

    /**
     * The ENS identity, and the demo fallback that exists only because
     * registering a name needs funded Sepolia ETH.
     *
     * `payoutKey` is accepted ONLY with `payoutKeySource: "local-demo"`. A
     * client claiming `ens-text-record` is claiming the key is readable on
     * chain, in which case shipping a copy of it in the request body is at
     * best redundant and at worst a way to make the lender pay to a key that
     * ENS never published. Refuse the combination rather than silently
     * preferring one of two sources.
     */
    const ensName =
      body.ensName === undefined || body.ensName === null
        ? null
        : assertEnsName(body.ensName, "ensName");
    const payoutKeySource =
      body.payoutKeySource === undefined || body.payoutKeySource === null
        ? null
        : assertPayoutKeySource(body.payoutKeySource, "payoutKeySource");
    const payoutKey =
      body.payoutKey === undefined || body.payoutKey === null
        ? null
        : assertHexBytes(body.payoutKey, "payoutKey", 32);

    if (payoutKey !== null && payoutKeySource !== "local-demo") {
      throw new ProtocolError(
        400,
        "payoutKey may only accompany payoutKeySource 'local-demo'",
        "A key the lender is meant to read from ENS must not also travel in the request body.",
      );
    }
    if (payoutKey !== null && ensName === null) {
      throw new ProtocolError(
        400,
        "payoutKey requires ensName",
        "The payout key is derived per ENS identity; a key with no name attached cannot be used.",
      );
    }

    const request: CreditRequest = {
      id: randomUUID(),
      borrowerSessionId: party.sessionId,
      borrowerLabel: party.label,
      amount,
      collateral,
      termDays,
      // Published BEFORE any lender issues a policy challenge. That ordering is
      // the difference between a mechanism and theatre: commit first, learn the
      // thresholds second.
      passportCommitment: commitment,
      provenance,
      ensName,
      payoutKey,
      payoutKeySource,
      status: "open",
      createdAt: Date.now(),
    };

    this.#state.requests.set(request.id, request);
    this.#bump();
    return request;
  }

  withdrawRequest(id: string, party: Party): CreditRequest {
    assertRole(party, "borrower");
    const request = this.#requireRequest(id);

    if (request.borrowerSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This request belongs to another borrower", id);
    }
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request is already withdrawn", id);
    }
    if (request.status === "accepted") {
      throw new ProtocolError(409, "An accepted request cannot be withdrawn", id);
    }

    request.status = "withdrawn";

    // Cascade, so nothing is left pointing at a dead request.
    for (const challenge of this.#state.challenges.values()) {
      if (challenge.requestId === id && challenge.status === "pending") {
        challenge.status = "withdrawn";
      }
    }
    for (const offer of this.#state.offers.values()) {
      if (offer.requestId === id && offer.status === "open") {
        offer.status = "withdrawn";
      }
    }

    this.#bump();
    return request;
  }

  /* ------------------------------------------------------------ challenges */

  /**
   * The lender's policy challenge.
   *
   * `computed` carries the server-side `policyHash` and `verifierCommitment`.
   * The route recomputes both from the policy it just validated and from the
   * lender's own session -- they are never read from the request body, so a
   * client cannot claim it answered a policy it did not.
   */
  createChallenge(
    body: CreateChallengeBody,
    party: Party,
    computed: { policyHash: string; verifierCommitment: string },
  ): PolicyChallenge {
    assertRole(party, "lender");

    const request = this.#requireRequest(body.requestId);
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request has been withdrawn", request.id);
    }
    if (request.status === "accepted") {
      throw new ProtocolError(409, "Request has already been settled", request.id);
    }

    const policy = assertPolicy(body.policy);
    const validityMinutes =
      body.validityMinutes === undefined
        ? DEFAULT_VALIDITY_MINUTES
        : assertFiniteNumber(body.validityMinutes, "validityMinutes", 1, 1_440);

    const now = Date.now();
    const challenge: PolicyChallenge = {
      id: randomUUID(),
      requestId: request.id,
      lenderSessionId: party.sessionId,
      lenderLabel: party.label,
      policy,
      policyHash: assertHexField(computed.policyHash, "policyHash"),
      verifierCommitment: assertHexField(computed.verifierCommitment, "verifierCommitment"),
      nonce: randomFieldElement(),
      expiresAt: now + validityMinutes * 60_000,
      status: "pending",
      createdAt: now,
    };

    this.#state.challenges.set(challenge.id, challenge);
    // Only advance from "open". A second lender challenging an already-proven
    // request must not drag the request backwards through the lifecycle.
    if (request.status === "open") {
      request.status = "challenged";
    }

    this.#bump();
    return challenge;
  }

  withdrawChallenge(id: string, party: Party): PolicyChallenge {
    assertRole(party, "lender");
    const challenge = this.#requireChallenge(id);

    if (challenge.lenderSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This challenge belongs to another lender", id);
    }
    if (challenge.status !== "pending") {
      throw new ProtocolError(409, `Challenge is already ${challenge.status}`, id);
    }

    challenge.status = "withdrawn";
    this.#bump();
    return challenge;
  }

  /* ---------------------------------------------------------------- proofs */

  /**
   * Record a borrower's answer to a challenge.
   *
   * Verification deliberately starts `pending` with an empty check list. The
   * route immediately re-derives every binding (commitment matches the one
   * published before the challenge, policy hash matches the stored policy,
   * expiry, nullifier unclaimed) and calls `recordVerification`. Storing an
   * optimistic "verified" here and correcting it later would mean the state
   * briefly says something the backend has not checked.
   */
  submitProof(body: SubmitProofBody, party: Party): ProofSubmission {
    assertRole(party, "borrower");

    const request = this.#requireRequest(body.requestId);
    if (request.borrowerSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This request belongs to another borrower", request.id);
    }
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request has been withdrawn", request.id);
    }

    const challenge = this.#requireChallenge(body.challengeId);
    if (challenge.requestId !== request.id) {
      throw new ProtocolError(
        409,
        "Challenge does not belong to this request",
        `${challenge.id} -> ${challenge.requestId}`,
      );
    }
    if (challenge.status === "withdrawn") {
      throw new ProtocolError(409, "Challenge has been withdrawn", challenge.id);
    }
    if (challenge.expiresAt <= Date.now()) {
      throw new ProtocolError(
        409,
        "Challenge has expired",
        `Expired at ${new Date(challenge.expiresAt).toISOString()}.`,
      );
    }

    if (body.proofSystem !== "groth16-bn254" && body.proofSystem !== "policy-eval-v0") {
      throw new ProtocolError(400, "Unknown proof system", String(body.proofSystem));
    }

    const proof: ProofSubmission = {
      id: randomUUID(),
      requestId: request.id,
      challengeId: challenge.id,
      proofSystem: body.proofSystem,
      publicSignals: assertPublicSignals(body.publicSignals),
      results: assertPolicyResults(body.results),
      proof:
        body.proof === undefined || body.proof === null
          ? null
          : assertString(body.proof, "proof", 8_192),
      verification: { status: "pending", checkedAt: null, checks: [], reason: null },
      createdAt: Date.now(),
    };

    this.#state.proofs.set(proof.id, proof);
    challenge.status = "answered";
    if (request.status === "open" || request.status === "challenged") {
      request.status = "proven";
    }

    this.#bump();
    return proof;
  }

  recordVerification(
    proofId: string,
    verification: ProofSubmission["verification"],
  ): ProofSubmission {
    const proof = this.#requireProof(proofId);
    proof.verification = verification;
    this.#bump();
    return proof;
  }

  /**
   * The replay guard. First claim wins, permanently.
   *
   * A nullifier is `Poseidon(salt, policyHash, verifierCommitment)`, so the
   * same receipt presented twice to the same lender for the same policy
   * collides here and the second attempt is refused. This is the in-memory
   * stand-in for the nullifier PDA that workstream E will create on Solana;
   * the value and the semantics are identical, only the durability differs.
   *
   * Returns a result rather than throwing, because the caller wants to record
   * a failed `nullifier` check on the proof rather than abort the request.
   */
  claimNullifier(
    nullifierHex: string,
    proofId: string,
  ): { ok: true } | { ok: false; existingProofId: string } {
    const key = assertHexField(nullifierHex, "nullifier");
    const existingProofId = this.#state.nullifiers.get(key);

    if (existingProofId !== undefined) {
      if (existingProofId === proofId) {
        return { ok: true };
      }
      return { ok: false, existingProofId };
    }

    this.#state.nullifiers.set(key, proofId);
    this.#bump();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- offers */

  createOffer(body: CreateOfferBody, party: Party): Offer {
    assertRole(party, "lender");

    const request = this.#requireRequest(body.requestId);
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request has been withdrawn", request.id);
    }
    if (request.status === "accepted") {
      throw new ProtocolError(409, "Request has already been settled", request.id);
    }

    const proof = this.#requireProof(body.proofId);
    if (proof.requestId !== request.id) {
      throw new ProtocolError(409, "Proof does not belong to this request", proof.id);
    }
    // Capital never moves against an unchecked claim. The backend must have
    // re-derived the bindings itself before a lender can price anything.
    if (proof.verification.status !== "verified") {
      throw new ProtocolError(
        409,
        "Proof has not been verified",
        `Verification status is "${proof.verification.status}".`,
      );
    }
    if (!proof.publicSignals.eligible) {
      throw new ProtocolError(
        409,
        "Proof reports the borrower as ineligible",
        "The policy this proof answers was not satisfied.",
      );
    }

    const offer: Offer = {
      id: randomUUID(),
      requestId: request.id,
      proofId: proof.id,
      lenderSessionId: party.sessionId,
      lenderLabel: party.label,
      apr: assertFiniteNumber(body.apr, "apr", 0, 100),
      fee: assertFiniteNumber(body.fee, "fee", 0, 10_000_000),
      deposit: assertFiniteNumber(body.deposit, "deposit", 0, 1_000_000_000),
      note: body.note === undefined ? "" : assertString(body.note, "note", 280),
      status: "open",
      createdAt: Date.now(),
    };

    this.#state.offers.set(offer.id, offer);
    request.status = "funded";

    this.#bump();
    return offer;
  }

  /**
   * Borrower accepts one offer. Sibling offers on the same request are
   * declined in the same version bump, so the lenders' screens can never show
   * two live offers for a request that has already been settled.
   */
  acceptOffer(offerId: string, party: Party): { offer: Offer; loan: Loan } {
    assertRole(party, "borrower");

    const offer = this.#requireOffer(offerId);
    const request = this.#requireRequest(offer.requestId);

    if (request.borrowerSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This offer is on another borrower's request", offerId);
    }
    if (offer.status !== "open") {
      throw new ProtocolError(409, `Offer is already ${offer.status}`, offerId);
    }
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request has been withdrawn", request.id);
    }
    if (request.status === "accepted") {
      throw new ProtocolError(409, "Request has already been settled", request.id);
    }

    offer.status = "accepted";
    for (const sibling of this.#state.offers.values()) {
      if (sibling.requestId === request.id && sibling.id !== offer.id && sibling.status === "open") {
        sibling.status = "declined";
      }
    }
    request.status = "accepted";

    const loan: Loan = {
      id: randomUUID(),
      offerId: offer.id,
      requestId: request.id,
      status: "funded",
      principal: request.amount,
      apr: offer.apr,
      fee: offer.fee,
      termDays: request.termDays,
      drawnAt: null,
      dueAt: null,
      repaidAt: null,
      createdAt: Date.now(),
    };

    this.#state.loans.set(loan.id, loan);
    this.#bump();
    return { offer, loan };
  }

  /* ----------------------------------------------------------------- loans */

  /**
   * Borrower draws the funded loan. The term clock starts here, not at accept,
   * because that is when the money actually moves.
   *
   * Workstream E replaces the state change with the on-chain draw instruction
   * and mirrors the resulting signature onto the loan; the lifecycle and the
   * role checks stay exactly as they are.
   */
  drawLoan(loanId: string, party: Party): Loan {
    const loan = this.#requireLoan(loanId);
    this.#requireLoanBorrower(loan, party);

    if (loan.status !== "funded") {
      throw new ProtocolError(409, `Loan cannot be drawn while ${loan.status}`, loanId);
    }

    const now = Date.now();
    loan.status = "active";
    loan.drawnAt = now;
    loan.dueAt = now + loan.termDays * DAY_MS;

    this.#bump();
    return loan;
  }

  /** Lender calls the loan due. `default_risk` is a seam for workstream E. */
  markRepaymentDue(loanId: string, party: Party): Loan {
    const loan = this.#requireLoan(loanId);
    this.#requireLoanLender(loan, party);

    if (loan.status !== "active") {
      throw new ProtocolError(409, `Loan cannot be called due while ${loan.status}`, loanId);
    }

    loan.status = "repayment_due";
    this.#bump();
    return loan;
  }

  repayLoan(loanId: string, party: Party): Loan {
    const loan = this.#requireLoan(loanId);
    this.#requireLoanBorrower(loan, party);

    if (loan.status !== "active" && loan.status !== "repayment_due") {
      throw new ProtocolError(409, `Loan cannot be repaid while ${loan.status}`, loanId);
    }

    loan.status = "repaid";
    loan.repaidAt = Date.now();
    this.#bump();
    return loan;
  }

  /* --------------------------------------------------------------- payouts */

  /**
   * LENDER-ONLY. Record one derived one-time payout address.
   *
   * What this method deliberately does NOT do is check the derivation. The
   * server holds neither the borrower's viewing scalar nor the lender's
   * ephemeral scalar, so it cannot recompute the address from `R` — and a
   * server that could would be a server that could compute the payout key
   * itself, which is the property this whole leg exists to avoid. Verification
   * belongs with the only party able to do it: the borrower's tab recomputes
   * the address from `R` and shows the comparison. A lender who announces a
   * wrong address is caught there, not here.
   *
   * Re-announcing on the same request is allowed and expected: each call is a
   * new draw, with a new ephemeral key and therefore a new, unlinkable
   * address. Rotation is the mechanism, not an edge case.
   */
  announcePayout(body: CreatePayoutBody, party: Party): PayoutAnnouncement {
    assertRole(party, "lender");

    const request = this.#requireRequest(body.requestId);
    if (request.status === "withdrawn") {
      throw new ProtocolError(409, "Request has been withdrawn", request.id);
    }

    const offer = this.#requireOffer(body.offerId);
    if (offer.requestId !== request.id) {
      throw new ProtocolError(409, "Offer does not belong to this request", offer.id);
    }
    if (offer.lenderSessionId !== party.sessionId) {
      throw new ProtocolError(403, "This offer belongs to another lender", offer.id);
    }
    if (offer.status === "declined" || offer.status === "withdrawn") {
      throw new ProtocolError(409, `Offer is ${offer.status}`, offer.id);
    }

    const ensName = assertEnsName(body.ensName, "ensName");
    if (request.ensName !== null && request.ensName !== ensName) {
      throw new ProtocolError(
        409,
        "Payout announced against a different ENS name than the request carries",
        `Request says "${request.ensName}", announcement says "${ensName}".`,
      );
    }

    const announcement: PayoutAnnouncement = {
      id: randomUUID(),
      requestId: request.id,
      offerId: offer.id,
      lenderSessionId: party.sessionId,
      lenderLabel: party.label,
      ensName,
      ephemeralPublicKey: assertHexBytes(body.ephemeralPublicKey, "ephemeralPublicKey", 32),
      viewTag: assertFiniteNumber(body.viewTag, "viewTag", 0, 255),
      payoutAddress: assertBase58Address(body.payoutAddress, "payoutAddress"),
      keySource: assertPayoutKeySource(body.keySource, "keySource"),
      ensBlockNumber:
        body.ensBlockNumber === undefined || body.ensBlockNumber === null
          ? null
          : assertString(body.ensBlockNumber, "ensBlockNumber", 32),
      ensRecordValue:
        body.ensRecordValue === undefined || body.ensRecordValue === null
          ? null
          : assertString(body.ensRecordValue, "ensRecordValue", 512),
      createdAt: Date.now(),
    };

    this.#state.payouts.set(announcement.id, announcement);
    this.#bump();
    return announcement;
  }

  /* ----------------------------------------------------------------- admin */

  /**
   * Wipe everything, including sessions and claimed nullifiers, and bump.
   * Dev-only endpoint; it exists so a demo can be re-run without restarting
   * the process, and so the nullifier replay guard can be demonstrated twice.
   */
  reset(): void {
    const waiters = this.#waiters;
    this.#state = emptyState();
    this.#waiters = waiters;
    this.#bump();
  }
}

/** The single process-wide marketplace store. */
export const store = new ProtocolStore();

/* -------------------------------------------------------------- self-test */

if (process.argv[1] && process.argv[1].endsWith("store.ts")) {
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new Error("FAIL: " + message);
    }
  };

  const versions: number[] = [];
  const mark = (label: string): void => {
    const v = store.snapshot().version;
    const previous = versions.length === 0 ? 0 : versions[versions.length - 1];
    assert(v > previous, `version must increase at "${label}" (${previous} -> ${v})`);
    versions.push(v);
  };

  const expectError = (status: number, label: string, fn: () => unknown): void => {
    try {
      fn();
    } catch (error) {
      assert(error instanceof ProtocolError, `${label} threw a ProtocolError`);
      const actual = (error as ProtocolError).status;
      assert(actual === status, `${label} -> ${status} (got ${actual})`);
      return;
    }
    assert(false, `${label} should have thrown ${status}`);
  };

  // A leading zero nibble keeps the test value below the BN254 modulus, which
  // starts 0x30644e… — `0xa1a1…` would (correctly) be rejected as unreduced.
  const hex = (byte: string): string => "0x0" + byte.repeat(31) + "f";

  const provenance = {
    address: "So11111111111111111111111111111111111111112",
    readCluster: "solana mainnet-beta",
    settleCluster: "solana devnet",
    fetchedAt: new Date().toISOString(),
    sources: [
      { name: "solana rpc", endpoint: "https://api.mainnet-beta.solana.com", latencyMs: 226, ok: true, detail: "getHealth ok" },
    ],
    allowlist: [{ symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", qualityAsset: true }],
    denylist: [],
    history: {
      confidence: "exact" as const,
      pagesScanned: 2,
      pageCap: 10,
      signaturesSeen: 1_412,
      horizonMonths: 24,
      oldestBlockTime: new Date(Date.now() - 700 * DAY_MS).toISOString(),
    },
    warnings: [],
  };

  // ---- sessions: no version bump, refresh keeps identity, roles do not swap.
  const startVersion = store.snapshot().version;
  const borrower = store.createSession("borrower");
  const lender = store.createSession("lender");
  assert(store.snapshot().version === startVersion, "createSession does not bump version");
  assert(borrower.label.startsWith("applicant-"), "borrower label: " + borrower.label);
  assert(lender.label.startsWith("provider-"), "lender label: " + lender.label);
  assert(borrower.label.length === "applicant-".length + 4, "borrower label uses 4 id chars");
  assert(
    store.createSession("borrower", borrower.sessionId).sessionId === borrower.sessionId,
    "a refresh re-attaches the same borrower session",
  );
  assert(
    store.createSession("lender", borrower.sessionId).sessionId !== borrower.sessionId,
    "a borrower id cannot be replayed to obtain a lender session",
  );
  assert(store.getParty(borrower.sessionId)?.role === "borrower", "getParty");
  assert(store.getParty("nope") === undefined, "getParty on an unknown id");
  versions.push(startVersion);

  // ---- long poll: a caller already behind returns immediately.
  let immediate = false;
  void store.waitForChange(0, 50_000).then(() => {
    immediate = true;
  });

  // ---- publish: the commitment is fixed before any policy is seen.
  const request = store.publishRequest(
    {
      sessionId: borrower.sessionId,
      amount: 25_000,
      collateral: 40_000,
      termDays: 90,
      passportCommitment: hex("a1"),
      provenance,
    },
    borrower,
  );
  mark("publishRequest");
  assert(request.status === "open", "a new request is open");
  assert(request.borrowerLabel === borrower.label, "request carries the borrower label");
  assert(!("witness" in request), "a request has no witness field");
  assert(
    !JSON.stringify(store.snapshot()).includes("collateralQuality"),
    "no witness field name appears anywhere in the shared state",
  );

  expectError(403, "a lender publishing a request", () =>
    store.publishRequest(
      {
        sessionId: lender.sessionId,
        amount: 1,
        collateral: 1,
        termDays: 1,
        passportCommitment: hex("a1"),
        provenance,
      },
      lender,
    ),
  );
  expectError(400, "a request with a non-numeric amount", () =>
    store.publishRequest(
      {
        sessionId: borrower.sessionId,
        amount: Number.NaN,
        collateral: 1,
        termDays: 1,
        passportCommitment: hex("a1"),
        provenance,
      },
      borrower,
    ),
  );
  expectError(400, "a request with an unreduced commitment", () =>
    store.publishRequest(
      {
        sessionId: borrower.sessionId,
        amount: 1,
        collateral: 1,
        termDays: 1,
        passportCommitment: "0x" + "f".repeat(64),
        provenance,
      },
      borrower,
    ),
  );

  // ---- challenge.
  const challenge = store.createChallenge(
    { sessionId: lender.sessionId, requestId: request.id, policy: {
      minimumAssets: 10_000,
      minimumCollateralQuality: 50,
      minimumHistoryMonths: 6,
      screenRestrictedExposure: true,
    } },
    lender,
    { policyHash: hex("b2"), verifierCommitment: hex("c3") },
  );
  mark("createChallenge");
  assert(store.getRequest(request.id)?.status === "challenged", "request moves to challenged");
  assert(challenge.nonce.length === 66, "challenge nonce is a field element");
  assert(challenge.expiresAt > Date.now() + 29 * 60_000, "default validity is 30 minutes");
  expectError(403, "a borrower issuing a challenge", () =>
    store.createChallenge(
      { sessionId: borrower.sessionId, requestId: request.id, policy: challenge.policy },
      borrower,
      { policyHash: hex("b2"), verifierCommitment: hex("c3") },
    ),
  );
  expectError(404, "a challenge on an unknown request", () =>
    store.createChallenge(
      { sessionId: lender.sessionId, requestId: "nope", policy: challenge.policy },
      lender,
      { policyHash: hex("b2"), verifierCommitment: hex("c3") },
    ),
  );

  // ---- proof.
  const signals = {
    passportCommitment: hex("a1"),
    eligible: true,
    policyHash: hex("b2"),
    subjectCommitment: hex("d4"),
    expiry: Math.floor((Date.now() + 30 * 60_000) / 1000),
    nullifier: hex("e5"),
    verifierCommitment: hex("c3"),
  };
  const results: PolicyResult[] = [
    { key: "assets", label: "Collateral value", passed: true, requirement: "At least $10k in allowlisted collateral" },
    { key: "quality", label: "Collateral quality", passed: true, requirement: "At least 50% in stables and liquid staking tokens" },
    { key: "history", label: "Account history", passed: true, requirement: "6+ months of on-chain history" },
    { key: "exposure", label: "Restricted exposure", passed: true, requirement: "No denylisted mints held" },
  ];

  const proof = store.submitProof(
    {
      sessionId: borrower.sessionId,
      requestId: request.id,
      challengeId: challenge.id,
      proofSystem: "policy-eval-v0",
      publicSignals: signals,
      results,
    },
    borrower,
  );
  mark("submitProof");
  assert(proof.verification.status === "pending", "verification starts pending");
  assert(proof.verification.checks.length === 0, "verification starts with no checks");
  assert(proof.proof === null, "policy-eval-v0 carries no proof bytes");
  assert(store.getChallenge(challenge.id)?.status === "answered", "challenge is answered");
  assert(store.getRequest(request.id)?.status === "proven", "request moves to proven");

  expectError(403, "a lender submitting a proof", () =>
    store.submitProof(
      {
        sessionId: lender.sessionId,
        requestId: request.id,
        challengeId: challenge.id,
        proofSystem: "policy-eval-v0",
        publicSignals: signals,
        results,
      },
      lender,
    ),
  );
  expectError(400, "a proof in an unknown proof system", () =>
    store.submitProof(
      {
        sessionId: borrower.sessionId,
        requestId: request.id,
        challengeId: challenge.id,
        proofSystem: "snake-oil-v9" as never,
        publicSignals: signals,
        results,
      },
      borrower,
    ),
  );

  // ---- offers cannot be made against an unverified proof.
  expectError(409, "an offer against a pending proof", () =>
    store.createOffer(
      { sessionId: lender.sessionId, requestId: request.id, proofId: proof.id, apr: 9, fee: 100, deposit: 0 },
      lender,
    ),
  );

  // ---- nullifier replay guard.
  assert(store.claimNullifier(signals.nullifier, proof.id).ok, "first nullifier claim wins");
  mark("claimNullifier");
  const replay = store.claimNullifier(signals.nullifier, "some-other-proof");
  assert(!replay.ok, "a replayed nullifier is refused");
  assert(replay.ok === false && replay.existingProofId === proof.id, "the replay names the original proof");
  assert(store.claimNullifier(signals.nullifier.toUpperCase().replace("0X", "0x"), "other").ok === false, "case does not defeat the guard");
  assert(store.claimNullifier(signals.nullifier, proof.id).ok, "re-claiming for the same proof is idempotent");

  // ---- verification.
  store.recordVerification(proof.id, {
    status: "verified",
    checkedAt: Date.now(),
    checks: [
      { name: "commitment", passed: true, detail: "Matches the commitment published before the challenge." },
      { name: "policyHash", passed: true, detail: "Recomputed server-side from the stored policy." },
      { name: "expiry", passed: true, detail: "Receipt is inside its validity window." },
      { name: "nullifier", passed: true, detail: "Unclaimed; recorded against this proof." },
    ],
    reason: null,
  });
  mark("recordVerification");
  assert(store.getProof(proof.id)?.verification.status === "verified", "verification is recorded");

  // ---- offers.
  const offerA = store.createOffer(
    { sessionId: lender.sessionId, requestId: request.id, proofId: proof.id, apr: 9.5, fee: 250, deposit: 0, note: "Standard terms." },
    lender,
  );
  mark("createOffer A");
  assert(store.getRequest(request.id)?.status === "funded", "request moves to funded");

  const lenderB = store.createSession("lender");
  const offerB = store.createOffer(
    { sessionId: lenderB.sessionId, requestId: request.id, proofId: proof.id, apr: 11, fee: 100, deposit: 0 },
    lenderB,
  );
  mark("createOffer B");
  expectError(400, "an offer with an out-of-range apr", () =>
    store.createOffer(
      { sessionId: lender.sessionId, requestId: request.id, proofId: proof.id, apr: 900, fee: 0, deposit: 0 },
      lender,
    ),
  );

  // ---- accept.
  expectError(403, "a lender accepting an offer", () => store.acceptOffer(offerA.id, lender));
  const otherBorrower = store.createSession("borrower");
  expectError(403, "a stranger accepting someone else's offer", () =>
    store.acceptOffer(offerA.id, otherBorrower),
  );

  const accepted = store.acceptOffer(offerA.id, borrower);
  mark("acceptOffer");
  assert(accepted.offer.status === "accepted", "the chosen offer is accepted");
  assert(store.getOffer(offerB.id)?.status === "declined", "the sibling offer is declined");
  assert(store.getRequest(request.id)?.status === "accepted", "request moves to accepted");
  assert(accepted.loan.status === "funded", "the loan starts funded");
  assert(accepted.loan.principal === request.amount, "principal comes from the request");
  assert(accepted.loan.termDays === request.termDays, "termDays comes from the request");
  assert(accepted.loan.apr === offerA.apr && accepted.loan.fee === offerA.fee, "apr/fee come from the offer");
  assert(accepted.loan.drawnAt === null && accepted.loan.dueAt === null, "an undrawn loan has no clock");
  expectError(409, "accepting the same offer twice", () => store.acceptOffer(offerA.id, borrower));

  // ---- the ENS payout leg. Rotation is the property under test: two draws on
  // one request must produce two different one-time addresses.
  const payoutBody = {
    sessionId: lender.sessionId,
    requestId: request.id,
    offerId: offerA.id,
    ensName: "privatecredit.eth",
    ephemeralPublicKey: "0x" + "aa".repeat(32),
    viewTag: 17,
    payoutAddress: "GzjEmiRXvcCvmtGFZ6FFMaX2rhFhVWHMpwKooCLzz2UY",
    keySource: "local-demo" as const,
    ensBlockNumber: "11629098",
    ensRecordValue: "",
  };
  const payout1 = store.announcePayout(payoutBody, lender);
  mark("announcePayout");
  const payout2 = store.announcePayout(
    {
      ...payoutBody,
      ephemeralPublicKey: "0x" + "bb".repeat(32),
      viewTag: 240,
      payoutAddress: "6CVnWSn7N41RoH8ypSvShVeGsZQ4xmiJwwiMfNyuuPqg",
    },
    lender,
  );
  mark("announcePayout (rotation)");
  assert(payout1.id !== payout2.id, "each draw is its own announcement");
  assert(
    payout1.payoutAddress !== payout2.payoutAddress,
    "two draws on one request produce two different payout addresses",
  );
  assert(
    payout1.ephemeralPublicKey !== payout2.ephemeralPublicKey,
    "each announcement carries its own ephemeral key R",
  );
  assert(store.snapshot().payouts.length === 2, "both announcements are in the shared state");
  expectError(403, "a borrower announcing a payout", () =>
    store.announcePayout({ ...payoutBody, sessionId: borrower.sessionId }, borrower),
  );
  expectError(400, "a payout with a 31-byte ephemeral key", () =>
    store.announcePayout({ ...payoutBody, ephemeralPublicKey: "0x" + "aa".repeat(31) }, lender),
  );
  expectError(400, "a payout address that is not base58", () =>
    store.announcePayout({ ...payoutBody, payoutAddress: "0OIl" }, lender),
  );
  expectError(400, "a payout claiming an unknown key source", () =>
    store.announcePayout({ ...payoutBody, keySource: "trust-me" as never }, lender),
  );
  expectError(403, "a payout against another lender's offer", () =>
    store.announcePayout({ ...payoutBody, offerId: offerB.id }, lender),
  );
  expectError(404, "a payout against an unknown offer", () =>
    store.announcePayout({ ...payoutBody, offerId: "nope" }, lender),
  );

  // ---- lifecycle.
  const loanId = accepted.loan.id;
  expectError(409, "repaying a loan that was never drawn", () => store.repayLoan(loanId, borrower));
  expectError(403, "a lender drawing the loan", () => store.drawLoan(loanId, lender));

  const drawn = store.drawLoan(loanId, borrower);
  mark("drawLoan");
  assert(drawn.status === "active", "a drawn loan is active");
  assert(drawn.drawnAt !== null && drawn.dueAt !== null, "the term clock starts at draw");
  assert(drawn.dueAt! - drawn.drawnAt! === request.termDays * DAY_MS, "dueAt is termDays after draw");
  expectError(409, "drawing twice", () => store.drawLoan(loanId, borrower));

  expectError(403, "a borrower calling their own loan due", () => store.markRepaymentDue(loanId, borrower));
  assert(store.markRepaymentDue(loanId, lender).status === "repayment_due", "lender calls the loan due");
  mark("markRepaymentDue");

  const repaid = store.repayLoan(loanId, borrower);
  mark("repayLoan");
  assert(repaid.status === "repaid" && repaid.repaidAt !== null, "the loan is repaid");
  expectError(409, "repaying twice", () => store.repayLoan(loanId, borrower));
  expectError(404, "acting on an unknown loan", () => store.drawLoan("nope", borrower));

  // ---- projection: identical for both roles, and witness-free by construction.
  const borrowerView = store.projectFor("borrower", borrower.sessionId);
  const lenderView = store.projectFor("lender", lender.sessionId);
  assert(borrowerView.requests.length === lenderView.requests.length, "both roles see the marketplace");
  assert(Object.keys(borrowerView).sort().join(",") === "challenges,loans,offers,payouts,proofs,requests,serverTime,version", "ProtocolState keys: " + Object.keys(borrowerView).sort().join(","));
  const serialised = JSON.stringify(lenderView);
  // Note "assets" is deliberately absent from this list: it is a PolicyResult
  // *key* (a pass/fail label for a comparison the lender itself specified), not
  // the borrower's asset total. The four witness FIELD names are what must
  // never appear.
  for (const forbidden of ["collateralQuality", "historyMonths", "restrictedExposure", "witness", "DEMO_WITNESS"]) {
    assert(!serialised.includes(forbidden), `the lender projection never contains ${forbidden}`);
  }
  // And nothing can ride along inside a PolicyResult either.
  for (const submission of lenderView.proofs) {
    for (const result of submission.results) {
      assert(
        Object.keys(result).sort().join(",") === "key,label,passed,requirement",
        "a PolicyResult carries only key/label/passed/requirement: " + Object.keys(result).join(","),
      );
      assert(typeof result.passed === "boolean", "a PolicyResult discloses a boolean, not a value");
    }
  }

  // ---- ordering.
  assert(
    store.snapshot().offers[0].createdAt >= store.snapshot().offers[1].createdAt,
    "snapshot is newest-first",
  );

  // ---- long poll actually fired, and a fresh wait times out cleanly.
  // `waitForChange` unrefs its timer so a pending poll never holds the process
  // open; in a server an open HTTP request does that. Here nothing else does,
  // so the test supplies its own ref'd keep-alive.
  const keepAlive = setInterval(() => {}, 20);

  const pollStart = Date.now();
  await store.waitForChange(store.snapshot().version, 60);
  const elapsed = Date.now() - pollStart;
  assert(elapsed >= 50, `an up-to-date poller waits for the timeout (waited ${elapsed}ms)`);
  assert(immediate, "a behind poller resolved immediately");

  const wokeAt: number[] = [];
  const pending = store.waitForChange(store.snapshot().version, 5_000).then(() => wokeAt.push(Date.now()));
  store.reset();
  await pending;
  clearInterval(keepAlive);
  assert(wokeAt.length === 1, "a mutation wakes the poller before its timeout");

  // ---- reset.
  const afterReset = store.snapshot();
  assert(afterReset.requests.length === 0, "reset wipes requests");
  assert(afterReset.loans.length === 0, "reset wipes loans");
  assert(afterReset.version === 1 + 1, "reset restarts the version at 1 and bumps to 2");
  assert(store.getParty(borrower.sessionId) === undefined, "reset wipes sessions");
  assert(store.claimNullifier(hex("e5"), "fresh").ok, "reset clears claimed nullifiers");

  // ---- monotonicity across the whole run.
  for (let i = 1; i < versions.length; i += 1) {
    assert(versions[i] > versions[i - 1], `version is monotonic at step ${i}`);
  }

  console.log(
    `store.ts OK (${versions.length} mutations, version ${versions[0]} -> ${versions[versions.length - 1]})`,
  );
}
