/**
 * `POST /api/passport` — the borrower's only door to the witness.
 *
 * THIS IS THE ONLY ROUTE FILE THAT IMPORTS THE PORTFOLIO READER, and it is
 * mounted separately in `app.ts` so the separation is visible in one glance.
 * `routes/api.ts` — every marketplace endpoint the lender's client calls —
 * imports no witness module at all.
 *
 * WHO MAY READ. The applicant proves control of the address by signing a
 * fixed message with that address's ed25519 key (Phantom `signMessage`). The
 * server rebuilds the message from `address` + `issuedAt`, verifies the
 * signature against the address bytes, checks the timestamp is recent, and
 * only then touches Solana RPC. Nobody can build a passport over an address
 * they do not hold.
 *
 * The response is NOT persisted. It is not written to the store, not logged,
 * and the short cache below is keyed by address and reachable only from this
 * endpoint, behind the same signature check.
 */

import express from "express";
import type { Router } from "express";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey } from "@solana/web3.js";

import { buildWitness } from "../adapters/solanaPortfolio.ts";
import { ProtocolError } from "../protocol/store.ts";
import type { PassportRequestBody, PassportResponse } from "../protocol/types.ts";
import { param, route } from "./http.ts";

/** A re-render must not re-hit Solana RPC and Jupiter. */
const PASSPORT_TTL_MS = 60_000;

/** A signed authorisation is good for this long. */
const AUTH_WINDOW_MS = 10 * 60_000;

type CacheEntry = { response: PassportResponse; expiresAt: number };

const cache: Map<string, CacheEntry> = new Map();
const inFlight: Map<string, Promise<PassportResponse>> = new Map();

/**
 * The exact message the wallet signs. MIRRORED in
 * `frontend/src/shared/passportAuth.ts` — change both or neither.
 */
export function portfolioAuthMessage(address: string, issuedAt: string): string {
  return [
    "Private Credit - portfolio read authorisation (v1)",
    "",
    `Address: ${address}`,
    `Issued: ${issuedAt}`,
    "",
    "This signature proves you control this address so a private credit",
    "passport can be read for it. It authorises no transaction and moves no funds.",
  ].join("\n");
}

function verifyAuthorisation(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProtocolError(400, "A JSON object body is required");
  }
  const { address, issuedAt, signature } = body as Partial<PassportRequestBody>;
  if (typeof address !== "string" || address.trim().length === 0) {
    throw new ProtocolError(400, "address is required");
  }
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt))) {
    throw new ProtocolError(400, "issuedAt must be an ISO-8601 timestamp");
  }
  if (typeof signature !== "string" || signature.length === 0) {
    throw new ProtocolError(400, "signature is required", "base64 of the 64-byte ed25519 signature");
  }

  const age = Date.now() - Date.parse(issuedAt);
  if (age > AUTH_WINDOW_MS || age < -60_000) {
    throw new ProtocolError(
      401,
      "The wallet authorisation has expired",
      "Sign the message again; a signature is accepted for ten minutes.",
    );
  }

  let publicKey: Uint8Array;
  try {
    publicKey = new PublicKey(address.trim()).toBytes();
  } catch {
    throw new ProtocolError(400, "Not a valid Solana address");
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = new Uint8Array(Buffer.from(signature, "base64"));
  } catch {
    throw new ProtocolError(400, "signature is not base64");
  }
  if (signatureBytes.length !== 64) {
    throw new ProtocolError(400, "signature must be 64 bytes", `Received ${signatureBytes.length}`);
  }

  const message = new TextEncoder().encode(portfolioAuthMessage(address.trim(), issuedAt));
  let valid = false;
  try {
    valid = ed25519.verify(signatureBytes, message, publicKey);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new ProtocolError(
      401,
      "The signature does not match this address",
      "The message must be signed by the wallet that owns the address.",
    );
  }
  return address.trim();
}

async function readPassport(address: string): Promise<{ response: PassportResponse; cached: boolean }> {
  const now = Date.now();
  const hit = cache.get(address);
  if (hit && hit.expiresAt > now) {
    return { response: hit.response, cached: true };
  }

  let pending = inFlight.get(address);
  if (!pending) {
    // buildWitness validates the address itself and throws a PassportError
    // with a 400 before any network call. Adapter failures surface as 502 with
    // the real reason — there is no fallback witness and no placeholder.
    pending = buildWitness(address);
    inFlight.set(address, pending);
    pending.then(
      () => {
        inFlight.delete(address);
      },
      () => {
        inFlight.delete(address);
      },
    );
  }

  const built = await pending;
  cache.set(address, { response: built, expiresAt: Date.now() + PASSPORT_TTL_MS });
  return { response: built, cached: false };
}

export const passportRouter: Router = express.Router();

passportRouter.post(
  "/",
  route(async (request, response) => {
    const address = verifyAuthorisation(request.body);
    const { response: built, cached } = await readPassport(address);
    response.set("x-passport-cache", cached ? "hit" : "miss");
    response.json(built);
  }),
);

/**
 * Unsigned read, for the curl-driven end-to-end script only. Off by default:
 * an open read-any-address endpoint would let anyone build a passport over a
 * portfolio they do not own. Enable with ALLOW_UNSIGNED_PASSPORT=1.
 */
if (process.env.ALLOW_UNSIGNED_PASSPORT === "1") {
  passportRouter.get(
    "/:address",
    route(async (request, response) => {
      const { response: built, cached } = await readPassport(param(request, "address"));
      response.set("x-passport-cache", cached ? "hit" : "miss");
      response.json(built);
    }),
  );
}
