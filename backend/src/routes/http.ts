/**
 * The two pieces of HTTP plumbing every router shares: an async-safe handler
 * wrapper and the single error translator.
 *
 * Kept in its own file so that `routes/passport.ts` (which imports the
 * borrower's portfolio module) and `routes/api.ts` (which must not) can share
 * plumbing without either importing the other.
 */

import type { NextFunction, Request, Response } from "express";

import { ProtocolError } from "../protocol/store.ts";
import type { ApiError } from "../protocol/types.ts";

/**
 * Turn any thrown value into `{ status, ApiError }`.
 *
 * `ProtocolError` carries its own status. The adapter errors (`PassportError`,
 * `RpcError`, `PriceError`) are matched structurally by `name` + a numeric
 * `status` rather than by import, so the lender-safe marketplace router never
 * has to import the portfolio module just to name an error class.
 *
 * Anything else is a 500 with a generic message and the real message in
 * `detail` — the UI shows something honest instead of "something went wrong",
 * and `app.ts` logs the stack.
 */
export function translateError(error: unknown): { status: number; body: ApiError } {
  if (error instanceof ProtocolError) {
    return { status: error.status, body: { error: error.message, detail: error.detail } };
  }

  if (error instanceof Error) {
    const named = error as Error & { status?: unknown; detail?: unknown };
    const isAdapterError =
      named.name === "PassportError" || named.name === "RpcError" || named.name === "PriceError";
    if (isAdapterError && typeof named.status === "number") {
      return {
        status: named.status,
        body: {
          error: error.message,
          detail:
            typeof named.detail === "string" && named.detail.length > 0 ? named.detail : undefined,
        },
      };
    }
    return { status: 500, body: { error: "Internal server error", detail: error.message } };
  }

  return { status: 500, body: { error: "Internal server error", detail: String(error) } };
}

/**
 * Read one route parameter as a string.
 *
 * Express 5 types `req.params[k]` as `string | string[]`, because a wildcard
 * segment (`/{*splat}`) captures an array. None of our parameters are
 * wildcards, so an array here means the route was mis-declared — join it rather
 * than casting, so the id simply fails to resolve instead of crashing.
 */
export function param(request: Request, name: string): string {
  const value = request.params[name];
  if (Array.isArray(value)) {
    return value.join("/");
  }
  return typeof value === "string" ? value : "";
}

/**
 * Wrap a handler so every throw — synchronous or asynchronous — lands in the
 * error middleware. Express 5 forwards rejected promises on its own; doing it
 * explicitly here means one shape for every route and no silent difference
 * between the two paths.
 */
export function route(
  handler: (request: Request, response: Response) => Promise<void> | void,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    try {
      const result = handler(request, response);
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}
