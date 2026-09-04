/**
 * The Express application.
 *
 * ORDER IS THE WHOLE FILE. Express 5 has two traps here that cost an hour each
 * if you meet them at 3am, and both are handled below with the reason written
 * down next to the line:
 *
 *   1. `app.get("*")` THROWS on Express 5 (path-to-regexp 8 rejects a bare
 *      wildcard). The SPA fallback must be `app.get("/{*splat}", ...)`.
 *   2. The `/api` 404 must be registered BEFORE the SPA fallback. Without it a
 *      typo'd endpoint returns `index.html` with HTTP 200, and the client sees
 *      "Unexpected token < in JSON" instead of "unknown_endpoint".
 *
 * The request logger is not decoration either: it is the demo's own evidence
 * that the two browser windows are talking to one server rather than to two
 * copies of a `useState`. One line per request, method + path + status + ms.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import { apiRouter, metrics } from "./routes/api.ts";
import { translateError } from "./routes/http.ts";
import { passportRouter } from "./routes/passport.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `backend/src` in dev (node --watch src/index.ts) and `backend/dist` after a
 * build; the SPA is two levels up either way.
 */
export const FRONTEND_DIST = path.resolve(here, "..", "..", "frontend", "dist");

export const servesStatic = fs.existsSync(path.join(FRONTEND_DIST, "index.html"));

export const app = express();

/* 1 ------------------------------------------------------------ middleware */

app.use(cors());
// 256kb: a proof submission is a few hundred bytes and a provenance blob a few
// kilobytes. Anything larger is a mistake or an attack, not a credit request.
app.use(express.json({ limit: "256kb" }));

/* 2 ---------------------------------------------------------------- logger */

app.use((request: Request, response: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  metrics.requests += 1;

  response.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ${ms.toFixed(1)}ms`,
    );
  });

  next();
});

/* 3 ----------------------------------------------------------- the routers */

// Mounted first and separately: this is the borrower's portfolio door, and it
// is the only route module that imports the witness builder. See the header of
// routes/passport.ts.
app.use("/api/passport", passportRouter);
app.use("/api", apiRouter);

/* 4 ---------------------------------------------------- the /api 404, EARLY */

// MUST come before the SPA fallback. Without it, POST /api/requestz falls
// through to index.html with HTTP 200 and the failure looks like a JSON parse
// bug in the client.
app.use("/api", (request: Request, response: Response) => {
  response.status(404).json({
    error: "unknown_endpoint",
    detail: request.method + " " + request.originalUrl,
  });
});

/* 5 -------------------------------------------------------- static / SPA */

if (servesStatic) {
  app.use(express.static(FRONTEND_DIST));
  // `/{*splat}` — NOT `"*"`, which throws on Express 5.
  app.get("/{*splat}", (_request: Request, response: Response) => {
    response.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.log(
    `[static] ${FRONTEND_DIST} not found — not serving the SPA. Dev mode: Vite serves it on :5173 and proxies /api here.`,
  );
}

/* 6 ------------------------------------------------------- error middleware */

// Four arguments, or Express does not recognise it as error middleware and the
// error falls through to the default HTML handler. `next` is unused on purpose.
app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const { status, body } = translateError(error);

  if (status >= 500) {
    console.error(
      `[500] ${request.method} ${request.originalUrl}`,
      error instanceof Error ? error.stack : error,
    );
  }

  response.status(status).json(body);
});
