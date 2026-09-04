/**
 * Typed client for the protocol backend.
 *
 * This module is the ONLY place the frontend talks to the server. Note what is
 * absent: there is no call that sends a `Witness` anywhere. The raw portfolio
 * snapshot arrives exactly once, in the response of
 * `GET /api/passport/:address`, and every other request body in this file is
 * drawn from `protocol-types.ts` — none of which has a field that could carry
 * it. The trust boundary is enforced by the shape of these functions, not by
 * anyone remembering to be careful.
 */

import type {
  ApiError as ApiErrorBody,
  CreateChallengeBody,
  CreateOfferBody,
  CreatePayoutBody,
  CreditRequest,
  Loan,
  Offer,
  PassportResponse,
  PayoutAnnouncement,
  PolicyChallenge,
  ProofSubmission,
  ProtocolState,
  PublishRequestBody,
  Role,
  SessionResponse,
  SubmitProofBody,
} from "./protocol-types";

/**
 * Empty string means same-origin, which is how this ships: one Render service
 * serving both the API and the SPA. In dev, Vite proxies `/api` to the backend,
 * so same-origin holds there too.
 *
 * `import.meta` is read through a cast rather than as `import.meta.env` so this
 * file compiles whether or not `vite/client` types are wired into tsconfig — a
 * missing `vite-env.d.ts` should not be able to break the API layer.
 */
const API_BASE: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE ?? "";

/**
 * A non-2xx response, or a response that was not JSON at all.
 *
 * `status === 0` is reserved for transport failures (offline, DNS, blocked
 * origin) where no HTTP response ever arrived.
 */
export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type Method = "GET" | "POST" | "DELETE";

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${API_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // An aborted fetch is control flow, not failure: re-throw it untouched so
    // the polling hook can tell the two apart.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      0,
      `Could not reach the protocol backend at ${url}`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const raw = await response.text();

  // 204 or an empty body: nothing to parse.
  if (raw.length === 0) {
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `${method} ${path} failed (${response.status})`,
      );
    }
    return undefined as T;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Known Express 5 trap: if the `/api` 404 handler is registered AFTER the
    // SPA fallback, a mistyped or unimplemented endpoint returns `index.html`
    // with HTTP 200 and the client "succeeds" on a page of HTML. Name the cause
    // explicitly — this failure mode costs an hour to diagnose blind.
    const looksLikeHtml = raw.trimStart().startsWith("<");
    throw new ApiError(
      response.status,
      looksLikeHtml
        ? `${method} ${path} returned HTML, not JSON — the SPA fallback answered an API route. The backend must register its /api 404 handler BEFORE app.get("/{*splat}").`
        : `${method} ${path} returned a body that is not JSON.`,
      raw.slice(0, 200),
    );
  }

  if (!response.ok) {
    if (isApiErrorBody(parsed)) {
      throw new ApiError(response.status, parsed.error, parsed.detail);
    }
    throw new ApiError(
      response.status,
      `${method} ${path} failed (${response.status})`,
      raw.slice(0, 200),
    );
  }

  return parsed as T;
}

function query(params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return search.toString();
}

/* -------------------------------------------------------------- sessions */

/**
 * Claim (or re-claim) a party identity. `existingId` lets a page reload keep
 * the same seat at the table; the server issues a fresh id if it no longer
 * recognises that one.
 */
export function createSession(
  role: Role,
  existingId?: string,
): Promise<SessionResponse> {
  return request<SessionResponse>("POST", "/api/session", {
    role,
    sessionId: existingId ?? null,
  });
}

/* ----------------------------------------------------------------- state */

/**
 * Long-poll the shared state. The server holds the request for ~25s and answers
 * the instant `version` moves past `since`, so callers loop on this rather than
 * poll on a timer.
 *
 * The returned `ProtocolState` is role-projected by the server and, by the
 * shape of the type, contains no witness.
 */
export function fetchState(params: {
  role: Role;
  sessionId: string;
  since: number;
  signal?: AbortSignal;
}): Promise<ProtocolState> {
  const qs = query({
    role: params.role,
    sessionId: params.sessionId,
    since: params.since,
  });
  return request<ProtocolState>("GET", `/api/state?${qs}`, undefined, params.signal);
}

/* -------------------------------------------------------------- passport */

/**
 * Borrower-only. Returns the real Solana-derived witness plus the provenance
 * strip. Nothing in this response is persisted server-side, and no other
 * endpoint accepts it back.
 */
export function fetchPassport(address: string): Promise<PassportResponse> {
  return request<PassportResponse>(
    "GET",
    `/api/passport/${encodeURIComponent(address)}`,
  );
}

/* -------------------------------------------------------------- requests */

export function publishRequest(body: PublishRequestBody): Promise<CreditRequest> {
  return request<CreditRequest>("POST", "/api/requests", body);
}

export function withdrawRequest(
  id: string,
  sessionId: string,
): Promise<CreditRequest> {
  return request<CreditRequest>(
    "POST",
    `/api/requests/${encodeURIComponent(id)}/withdraw`,
    { sessionId },
  );
}

/* ------------------------------------------------------------ challenges */

export function createChallenge(body: CreateChallengeBody): Promise<PolicyChallenge> {
  return request<PolicyChallenge>("POST", "/api/challenges", body);
}

export function withdrawChallenge(
  id: string,
  sessionId: string,
): Promise<PolicyChallenge> {
  return request<PolicyChallenge>(
    "POST",
    `/api/challenges/${encodeURIComponent(id)}/withdraw`,
    { sessionId },
  );
}

/* ---------------------------------------------------------------- proofs */

export function submitProof(body: SubmitProofBody): Promise<ProofSubmission> {
  return request<ProofSubmission>("POST", "/api/proofs", body);
}

/**
 * Lender-side verification. The backend re-derives the policy hash from the
 * stored challenge, re-checks the expiry and burns the nullifier — the client
 * is trusted for none of it.
 */
export function verifyProof(id: string, sessionId: string): Promise<ProofSubmission> {
  return request<ProofSubmission>(
    "POST",
    `/api/proofs/${encodeURIComponent(id)}/verify`,
    { sessionId },
  );
}

/* ---------------------------------------------------------------- offers */

export function createOffer(body: CreateOfferBody): Promise<Offer> {
  return request<Offer>("POST", "/api/offers", body);
}

export function acceptOffer(
  id: string,
  sessionId: string,
): Promise<{ offer: Offer; loan: Loan }> {
  return request<{ offer: Offer; loan: Loan }>(
    "POST",
    `/api/offers/${encodeURIComponent(id)}/accept`,
    { sessionId },
  );
}

/* --------------------------------------------------------------- payouts */

/**
 * LENDER-ONLY. Publishes one derived one-time Solana payout address, plus the
 * ephemeral public key `R` and view tag the borrower needs to recover it.
 *
 * The derivation itself happens in the lender's browser — `derivePayoutAddress`
 * in `shared/ensPayout.ts`, over the X25519 key read from the borrower's ENS
 * text record. The server receives only the public half and stores it; it has
 * no key material and cannot recompute the address. Whether the announcement is
 * honest is checked by the borrower's tab, which is the only party that can.
 */
export function announcePayout(body: CreatePayoutBody): Promise<PayoutAnnouncement> {
  return request<PayoutAnnouncement>("POST", "/api/payouts", body);
}

/* ----------------------------------------------------------------- loans */

export function drawLoan(id: string, sessionId: string): Promise<Loan> {
  return request<Loan>("POST", `/api/loans/${encodeURIComponent(id)}/draw`, {
    sessionId,
  });
}

/**
 * LENDER-ONLY. The backend registers this as `/api/loans/:id/due` and rejects a
 * borrower session with 403 — calling your own loan due is the lender's move.
 * Verified live against the running backend: `/repayment-due` returned 404
 * `unknown_endpoint`, and `/due` with a borrower session returned 403.
 */
export function markRepaymentDue(id: string, sessionId: string): Promise<Loan> {
  return request<Loan>(
    "POST",
    `/api/loans/${encodeURIComponent(id)}/due`,
    { sessionId },
  );
}

export function repayLoan(id: string, sessionId: string): Promise<Loan> {
  return request<Loan>("POST", `/api/loans/${encodeURIComponent(id)}/repay`, {
    sessionId,
  });
}

/* ------------------------------------------------------------------- dev */

/** Wipes the in-memory store. Demo reset button only. */
export async function resetProtocol(): Promise<void> {
  await request<unknown>("POST", "/api/dev/reset", {});
}
