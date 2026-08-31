# Footprint validation record

Expanded build checked August 31, 2026, on Windows with Node 22.22.3. This records what was exercised, not a third-party security audit.

## Automated checks

- **49/49 tests passing.** Tests run with mocked/injected providers and fixed synthetic evidence, without making external requests.
- **TypeScript and production build passing.** Both frontend and server are checked; Vite generates the client bundle and TypeScript generates the server.
- **Compiled application smoke check passing:** `npm run smoke` exercises HTML, referenced assets, security/no-store headers, health, fallback rehearsal, denied live access and unknown API routes in-process.
- Formatting and whitespace are checked before handoff. GitHub CI runs install, formatting, tests, build and the compiled smoke check. A workflow file is provided; no remote CI run is claimed until it is pushed.

### Important regression coverage

- A real viem custom transport reproduces a Universal Resolver revert that non-strict reads convert to null. Footprint's strict reads retain ten unknown failures instead of reporting ten successful empty records.
- Equal explicit/default values are distinguished with `hasAddr`. Failed provenance and unknown resolvers remain unknown.
- Default replacement, override removal and explicitly stored zero addresses have distinct consequences.
- Name-control records, same address bytes in other retained records, incomplete coverage and untouched historical evidence are handled separately.
- Newer-block verification checks stored values; a price change cannot verify an ENS edit. Changed resolvers, stale observations and missing provenance cannot yield successful draft verification.
- Token contracts retain chain identity; symbols cannot establish native ETH. Grouped ETH/WETH quantities and values reconcile before splitting.
- Activity checks chain, transaction hash, time window, duplicate hashes and incomplete indexing. HTTP errors do not echo secrets.
- Upstream response limits work even without Content-Length. Invalid input, malformed imports, allowlist misses, budget exhaustion and origin failures fail closed.

## Browser checks

The development app was exercised at http://127.0.0.1:5173 in the in-app browser, including a 390×844 responsive viewport:

- Load the synthetic map and inspect record/holding evidence.
- Clear Base and observe the retained Default route.
- Clear Default and observe no remaining checked Base route, with historical caveats.
- Replace Base with the fixed demo wallet and explicitly load its $1,200 synthetic portfolio.
- Rehearse the after-state and inspect the comparison table.
- Check presentation layout and mobile width/overflow.

Rapid rewrites exposed a development-server cache issue during the check: Vite briefly transformed an incomplete file and retained a stale module. The watcher now waits for stable writes; the server restarted and the app loaded again on a clean refresh. This did not affect the successful production build. The final workflow is rechecked after that restart.

Snapshot import parsing and export-envelope round trips are covered by the tests. A real filesystem upload/download interaction is not claimed as part of browser automation.

## External verification still required

- The current local API reports configured provider credentials; this is not proof of endpoint access or current provider availability. Earlier prototype notes recorded portfolio success, but this expansion did not repeat a real-person audit.
- The new activity adapter is checked against documented request/response shape and fixtures. Confirm **actual v2 activity access for your Mobula plan** before making it essential to a live pitch.
- Live Default simulation pins the official public resolver address and uses onchain reads. Demonstrate it with a consenting name on that resolver; custom resolver semantics remain unknown.
- No real ENS update, signed wallet action, payment, public deployment, video recording or TAIKAI submission was performed.
- Docker files were added, but the local Docker daemon was unavailable, so an image build/run is not claimed. The compiled Node application itself passes smoke checks.
- Hosted-domain origin, proxy configuration, TLS, provider spending caps and real allowlisted names must be checked on the actual host.

On this Windows environment the test runner needs access to the OS user-directory lookup unavailable inside the restricted shell. Tests passed when run with the approved command permission; no source change was needed for that environment issue.
