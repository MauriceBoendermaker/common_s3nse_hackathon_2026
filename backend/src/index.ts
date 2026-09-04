/**
 * Process entry point. Deliberately thin: everything interesting is in
 * `app.ts` and `routes/`.
 *
 * The startup banner prints the RPC endpoints and the read/settle clusters
 * because those two lines are the honest version of the pitch — balances come
 * from MAINNET, settlement will happen on DEVNET — and they should be visible
 * in the terminal a judge is looking at, not only in a README.
 */

import { READ_CLUSTER } from "./adapters/solanaPortfolio.ts";
import { clusterName, readDeployment, rpcUrl } from "./adapters/solanaSettlement.ts";
import { RPC_ENDPOINTS } from "./adapters/solanaRpc.ts";
import { staleBuiltSpaWarning, verifierBanner, verifierStatus } from "./protocol/verifier.ts";
import { FRONTEND_DIST, app, servesStatic } from "./app.ts";
import { API_VERSION } from "./routes/api.ts";

const port = Number(process.env.PORT) || 3001;

const server = app.listen(port, () => {
  console.log(`ZKredit backend (${API_VERSION}) listening on http://localhost:${port}`);
  console.log(`  solana rpc     ${RPC_ENDPOINTS.join(", ")}`);
  console.log(`  read cluster   ${READ_CLUSTER}  (real balances)`);
  // The settle cluster is read from the resolved deployment rather than from a
  // constant, because "which chain did this actually settle on" is exactly the
  // kind of thing a stale string gets wrong at the worst moment.
  const deployment = readDeployment();
  console.log(
    `  settle cluster ${clusterName()} @ ${rpcUrl()}  ` +
      (deployment
        ? `(program ${deployment.programId}, mint ${deployment.mintSymbol})`
        : "(NOT DEPLOYED — run `npm run solana:up`)"),
  );
  // The verifying key this server checks proofs against, and whether it is the
  // same key the browser's proving key was generated with. Stale artifacts are
  // the single most confusing failure mode in this workstream, so the answer is
  // on screen before the first request rather than inferred from a pairing
  // failure an hour later. `protocol/verifier.ts` has already shouted if not.
  console.log(`  groth16        ${verifierBanner()}`);
  console.log(
    servesStatic
      ? `  static         serving the SPA from ${FRONTEND_DIST}`
      : "  static         off — run the Vite dev server, it proxies /api to this port",
  );
  if (!verifierStatus.ready) {
    console.log(
      "  WARNING        proofs will be REJECTED until `npm run zk:build` regenerates the artifacts.",
    );
  }
  // Only meaningful when this process is the one handing the browser its
  // proving key. Behind the Vite dev server the SPA comes from
  // frontend/public/zk and a stale dist/ is nobody's problem.
  if (servesStatic && verifierStatus.servedArtifactsAgree === false) {
    console.log("");
    console.log("############################################################");
    console.log("##  " + staleBuiltSpaWarning());
    console.log("############################################################");
    console.log("");
  }
});

/**
 * Close the listener on a signal so `node --watch` restarts cleanly instead of
 * leaving the port held by a zombie and failing the next boot with EADDRINUSE.
 * In-flight long polls are allowed to drain; `close()` stops accepting new
 * connections and fires once the last one ends.
 */
function shutdown(signal: string): void {
  console.log(`\n${signal} received — closing the server.`);
  server.close(() => {
    process.exit(0);
  });
  // A long poll can hold a socket for up to 25 s. Do not wait for it forever.
  setTimeout(() => {
    process.exit(0);
  }, 3_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
