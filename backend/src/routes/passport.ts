/**
 * `GET /api/passport/:address` — the borrower's only door to the witness.
 *
 * THIS IS THE ONLY ROUTE FILE THAT IMPORTS THE PORTFOLIO READER, and it is
 * mounted separately in `app.ts` so the separation is visible in one glance
 * rather than argued for in a comment. `routes/api.ts` — every marketplace
 * endpoint the lender's client calls — imports no witness module at all.
 *
 * What crosses this boundary and where it goes:
 *
 *   Solana mainnet + Jupiter  ->  this route  ->  the borrower's browser
 *                                                        |
 *                                                 (never comes back)
 *
 * The response is NOT persisted. It is not written to the store, not logged,
 * and not cached anywhere a lender session could address — the 60 s cache below
 * is keyed by Solana address and is only reachable from this endpoint, which
 * anyone could call for any public address anyway, because these are public
 * chain balances. The privacy claim is about the *commitment*: the lender never
 * learns which address the applicant used, and the marketplace store has no
 * field that could hold one of these numbers.
 *
 * Honesty, restated at the boundary where it is easiest to check: balances are
 * read from Solana MAINNET; settlement (workstream E) happens on DEVNET. Both
 * cluster names ride on `provenance` so the UI can say it out loud.
 */

import express from "express";
import type { Router } from "express";

import { buildWitness } from "../adapters/solanaPortfolio.ts";
import type { PassportResponse } from "../protocol/types.ts";
import { param, route } from "./http.ts";

/** A re-render must not re-hit Solana RPC and Jupiter. */
const PASSPORT_TTL_MS = 60_000;

type CacheEntry = { response: PassportResponse; expiresAt: number };

const cache: Map<string, CacheEntry> = new Map();

/**
 * Concurrent reads of the SAME address share one build.
 *
 * React 19's StrictMode double-invokes effects in development, so without this
 * a single mounted passport panel fires two full portfolio builds — roughly
 * twenty-eight RPC calls — and the provenance strip shows latencies from
 * whichever race won. Deduplicating is both faster and more honest.
 */
const inFlight: Map<string, Promise<PassportResponse>> = new Map();

export const passportRouter: Router = express.Router();

passportRouter.get(
  "/:address",
  route(async (request, response) => {
    const address = param(request, "address");
    const now = Date.now();

    const hit = cache.get(address);
    if (hit && hit.expiresAt > now) {
      response.set("x-passport-cache", "hit");
      response.json(hit.response);
      return;
    }

    let pending = inFlight.get(address);
    if (!pending) {
      // buildWitness validates the address itself (real base58 decode to 32
      // bytes, not a regex) and throws a PassportError with a 400 before any
      // network call. Adapter failures surface as 502 with the real reason —
      // there is deliberately no fallback witness, no placeholder portfolio and
      // no cached-stale path. If Solana cannot be read, the applicant is told
      // so; they are never shown numbers the chain did not produce.
      pending = buildWitness(address);
      inFlight.set(address, pending);
      // Both arms, not `.finally()`: `.finally()` returns a NEW promise that
      // re-throws, and nothing awaits that one — under Node 22 an unhandled
      // rejection is fatal, so a single unreachable RPC would take the server
      // down. Two no-op handlers keep the shared promise always handled.
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
    response.set("x-passport-cache", "miss");
    response.json(built);
  }),
);
