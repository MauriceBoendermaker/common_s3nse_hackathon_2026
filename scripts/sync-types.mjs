// Copies the canonical protocol contract into the frontend so both workspaces
// compile against byte-identical types without a cross-workspace import.
import { readFileSync, writeFileSync } from "node:fs";
const SRC = "backend/src/protocol/types.ts";
const DEST = "frontend/src/shared/protocol-types.ts";
const header =
  "// GENERATED FILE — do not edit.\n" +
  "// Mirror of backend/src/protocol/types.ts. Regenerate with `npm run sync:types`.\n\n";
writeFileSync(DEST, header + readFileSync(SRC, "utf8"));
console.log(`synced ${SRC} -> ${DEST}`);
