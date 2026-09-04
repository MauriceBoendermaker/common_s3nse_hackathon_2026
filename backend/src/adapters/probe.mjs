/**
 * Manual probe for the Solana witness adapter.
 *
 *   node backend/src/adapters/probe.mjs <address> [<address> ...]
 *
 * Node 22 strips types from the imported .ts modules natively, so this runs
 * without a build step. Everything it prints comes off the network at the
 * moment you run it: run it twice and the latencies, prices and signature
 * counts will differ. That is the point.
 */

import { buildWitness } from "./solanaPortfolio.ts";
import { isLikelySolanaAddress } from "./solanaRpc.ts";

const usd = (value) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function printPassport(address, passport) {
  const { witness, holdings, ignoredTokenAccounts, provenance } = passport;

  console.log("");
  console.log("=".repeat(78));
  console.log("ADDRESS  " + address);
  console.log("=".repeat(78));

  console.log("");
  console.log("WITNESS (private — never leaves the borrower)");
  console.log("  assets .............. " + witness.assets + "  (" + usd(witness.assets) + ")");
  console.log("  collateralQuality ... " + witness.collateralQuality + "%");
  console.log(
    "  historyMonths ....... " +
      (witness.historyMonths === null ? "null  (fail closed)" : witness.historyMonths) +
      "   [" +
      provenance.history.confidence +
      "]",
  );
  console.log("  restrictedExposure .. " + witness.restrictedExposure);

  console.log("");
  console.log(
    "HOLDINGS  (" +
      holdings.length +
      " priced and liquid, out of " +
      ignoredTokenAccounts +
      " token accounts seen)",
  );
  if (holdings.length === 0) {
    console.log("  (none)");
  }
  for (const holding of holdings) {
    console.log(
      "  " +
        holding.symbol.padEnd(9) +
        String(holding.amount).padStart(18) +
        "  @ " +
        usd(holding.priceUsd).padStart(12) +
        "  = " +
        usd(holding.usdValue).padStart(14) +
        (holding.qualityAsset ? "  [quality]" : "") +
        "   liq " +
        usd(holding.liquidityUsd),
    );
  }

  console.log("");
  console.log("PROVENANCE");
  console.log("  read   " + provenance.readCluster + "   settle   " + provenance.settleCluster);
  console.log("  fetchedAt " + provenance.fetchedAt);
  console.log(
    "  history: " +
      provenance.history.pagesScanned +
      "/" +
      provenance.history.pageCap +
      " pages, " +
      provenance.history.signaturesSeen +
      " signatures, horizon " +
      provenance.history.horizonMonths +
      "m, oldest " +
      provenance.history.oldestBlockTime,
  );
  console.log("  sources (" + provenance.sources.length + " real network calls):");
  for (const source of provenance.sources) {
    console.log(
      "    " +
        String(source.latencyMs + "ms").padStart(8) +
        "  " +
        source.name.padEnd(38) +
        source.endpoint,
    );
    console.log("              " + source.detail);
  }
  if (provenance.warnings.length > 0) {
    console.log("  warnings:");
    for (const warning of provenance.warnings) console.log("    - " + warning);
  }
}

const addresses = process.argv.slice(2);
if (addresses.length === 0) {
  console.error("usage: node backend/src/adapters/probe.mjs <address> [<address> ...]");
  process.exit(1);
}

let failures = 0;
for (const address of addresses) {
  const startedAt = Date.now();
  try {
    const passport = await buildWitness(address);
    printPassport(address, passport);
    console.log("");
    console.log("  total wall clock: " + (Date.now() - startedAt) + "ms");
  } catch (error) {
    failures += 1;
    console.log("");
    console.log("=".repeat(78));
    console.log("ADDRESS  " + address);
    console.log("=".repeat(78));
    console.log(
      "  REJECTED after " +
        (Date.now() - startedAt) +
        "ms  status=" +
        (error.status ?? "-") +
        "  " +
        error.name +
        ": " +
        error.message,
    );
    if (error.detail) console.log("  detail: " + error.detail);
    console.log("  isLikelySolanaAddress -> " + isLikelySolanaAddress(address));
  }
}

console.log("");
console.log(addresses.length - failures + " ok, " + failures + " rejected");
