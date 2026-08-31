# Footprint

**See what your ENS name reveals. Preview a change. Verify what still gets through.**

Footprint is a privacy preflight for people deciding which wallets and profile records to publish through ENS. It turns resolver records and Mobula observations into inspectable paths, explains the consequences of an edit, and compares a fresh snapshot after a user makes their own change in ENS.

Built for Common S3nse 2026. Partner targets: **ENS and Mobula**, subject to their final eligibility rules. No prize or placement is guaranteed.

## Try it

Requires Node **22.12+** and npm. No keys are needed for the synthetic demo.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens on port 3001; Vite proxies `/api` locally.

1. Start with the clearly labeled fictional `mira.demo.eth` profile.
2. Click **Preview the removal**. The Base override disappears from the draft, but the Default still resolves to the same address.
3. Clear **Default EVM address** too. The app explains which current checked route disappears, without erasing the original evidence.
4. Try the demo payment wallet, then **Load draft wallet evidence** for a fixed synthetic portfolio.
5. Select **Review & verify → Rehearse after-state**. Compare resolved values and explicit/default origins. No onchain update occurs.
6. Use **Present** for a focused display; **Export**, **Import** and **Clear session** exercise the local snapshot flow.

For live use, copy `.env.example` to `.env`, set your mainnet RPC and Mobula key, and restart the API. Choose Live and acknowledge permission and provider disclosure. Inspect only a profile and draft wallets you control or have permission to inspect. The checkbox does not cryptographically prove control. Never put secrets in `VITE_*` variables.

## Why this matters

A public payment name can also reveal social handles, contact information and financial activity. Removing one record may leave another route intact. A chain-specific address can inherit a Default, and name ownership is separate from payment records. Users need a concrete explanation of those consequences before making a change.

Footprint supports deliberate use of public identity. It does not promise anonymity or recommend hiding all ENS records.

## What works

- **Evidence map:** inspect exact record values, keys, resolver block, explicit/default origin, provider results, chain-qualified token contracts and independent fetch times.
- **Editable publishing draft:** add, replace or remove supported Ethereum/Base/Default and profile fields. Original observations remain immutable. Unknown resolver behavior stays unknown.
- **Surviving-route explanations:** distinguish a new route, a retained route, no remaining checked route, and an unknown result. Explain Default fallback, other records publishing the same address bytes, and supported ENS owner/manager observations.
- **Fresh comparison:** review an edit checklist, open the official ENS app yourself, and re-audit. A live draft check requires a newer block, known stored values and unchanged resolver semantics. Prices do not determine success.
- **Bounded activity:** explicitly request up to ten Mobula activity entries from thirty days, with validated chain/hash/time. No recursive counterparty investigation or inferred relationships.
- **Portable snapshots:** validate local JSON imports, label their claims unverified, retain a draft and export original/after snapshots separately. Importing makes no provider request.
- **Controlled demo hosting:** server-enforced profile and proposed-wallet allowlists, process-wide provider-work budget, concurrency limits, restricted diagnostics, origin checks and no-store/security headers.

## How it works

```text
Browser: evidence → local draft → exact edit checklist → fresh comparison
   │ explicit, acknowledged live request
   ▼
Fastify: validation, allowlists, rate limits, work budget
   ├─ ENS / Ethereum RPC: ten strict reads at one observed block
   │    └─ supported resolver: hasAddr + Default + name-control evidence
   └─ Mobula: portfolio observations; optional bounded activity request
```

React, TypeScript and Vite provide the frontend. Fastify serves the API and the compiled frontend. viem handles ENS normalization and Ethereum calls; Zod validates provider data, drafts and imports. There is no database, wallet connection, custom contract, analytics, remote avatar fetching or third-party font loading.

| Code                                | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `server/providers/ens.ts`           | Strict ENS reads, fallback provenance, scoped name-control reads            |
| `server/providers/mobula.ts`        | Portfolios, token identity, ETH/WETH reconciliation and diagnostics         |
| `server/providers/activity.ts`      | Validated v2 activity sample                                                |
| `shared/preview.ts`                 | Immutable simulation, surviving routes, stale-baseline and comparison logic |
| `shared/snapshot.ts`                | Bounded local snapshot import validation                                    |
| `server/app.ts`, `server/budget.ts` | API policy and provider-work limits                                         |
| `src/components/`                   | Map, evidence inspector, draft, outcomes, comparison and privacy dialog     |
| `tests/`                            | Offline API, provider and evidence-boundary regression tests                |

## Partner technologies

**ENS is the identity and publishing layer.** Footprint reads actual mainnet resolver records and accounts for Default fallback. Simulation currently pins the official Public Resolver at `0xF29100983E058B709F3D539b0c765937B804AC15`; matching address strings alone never establish fallback. `hasAddr` distinguishes stored overrides from inherited values. Other resolvers can be inspected, but unsupported edit predictions remain unknown.

**Mobula makes the disclosure consequences visible.** `/api/1/wallet/portfolio` provides holdings and contract balances; `/api/2/wallet/activity` provides an optional activity sample. Keys stay on the server. Missing access, quota exhaustion, malformed data and timeouts remain explicit errors or unknown evidence. Synthetic fixtures never substitute for live responses.

Ordinary tokens retain available chain-qualified contract identifiers, including multiple identities for grouped provider rows. ETH/WETH are separated only when their known chain/contract identities and quantities reconcile. Displayed values remain provider estimates; unknown prices are not zero.

## Coverage and trust boundaries

- **Ten ENS reads:** Ethereum `addr(60)`, Base `addr(2147492101)`, Default `addr(2147483648)`, Solana `addr(501)`, `com.twitter`, `com.github`, `url`, `email`, `description`, `avatar`. Empty, populated, failed and unsupported are separate states. Unlisted keys and history are not scanned.
- **Supported fallback:** a cleared override means an empty stored byte string (`0x`). A stored 20-byte zero address is different and can disable fallback. The checklist warns about this; the after-state check compares stored values as well as resolved results.
- **Name control:** direct second-level `.eth` names use Registry manager and Base Registrar owner observations, or the Name Wrapper owner for wrapped names. Subnames, approvals, parent control, expiry/grace-period behavior and every possible control path are outside this scope. Partial/unsupported coverage cannot certify route removal.
- **Chain scope:** Ethereum and Base portfolios only. Solana bytes are inspectable but are not decoded, edited or enriched. Matching EVM bytes on different chains do not prove common ownership. No speculative cross-chain expansion occurs.
- **Timing:** ENS reads share an observed block; portfolio/activity requests are independent observations. A newer-block comparison is not a finality proof, transaction receipt, proof of sender, or complete history audit.
- **Provider coverage:** at most eight displayed asset positions per wallet, with its provider total kept separately. Activity is at most ten entries over thirty days; pagination, spam filtering and indexing can omit events. Empty results do not establish inactivity or privacy.
- **Import trust:** a valid JSON file is still untrusted evidence. Import does not authenticate its claims. Re-auditing an imported live baseline is allowed with acknowledgment, but its comparison is explicitly unverified; draft provider enrichment requires a fresh live baseline.
- **Metadata:** the local/hosted API sees submitted names; RPC operators and Mobula see queries. Hosting infrastructure may log metadata independently. Clearing the page cannot delete provider records, historical disclosures or exported files.
- **Networking:** CCIP-read is disabled; offchain-only names may fail. Provider fetches reject redirects and have time/response-size limits. These limits are prototype safeguards, not a production security audit.

## API

| Endpoint                            | Request / behavior                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/health`                   | Sanitized provider status and hosting policy; no external request                          |
| `GET /api/demo?scenario=fallback`   | Explicit synthetic report; `classic` is also available                                     |
| `POST /api/demo/preview`            | `{ "edits": {...}, "scenario": "fallback" }`; fixed synthetic enrichment                   |
| `POST /api/demo/after`              | Same input; synthetic after-state                                                          |
| `POST /api/audit`                   | `{ "name": "yourname.eth", "consent": true }`                                              |
| `POST /api/preview`                 | Name, consent and `edits`; server reads its own baseline and enriches permitted new routes |
| `POST /api/activity`                | Name, consent, address and chain (`Ethereum` or `Base`)                                    |
| `POST /api/providers/mobula/verify` | `{ "consent": true }`; local-only fixed public-documentation probe                         |

Draft keys match IDs such as `address:base`, `address:default` and `text:com.github`. Values are strings or `null` to clear. Maximum body size is 4 KiB (24 KiB for draft endpoints). Rate limits apply to provider-work endpoints, not ordinary page assets, health or synthetic rehearsals. See [DEPLOYMENT.md](./DEPLOYMENT.md) for quota details and restrictions.

## Build and validate

```sh
npm test
npm run build
npm run format:check
npm start
```

`npm start` serves the compiled app at http://127.0.0.1:3001 by default. Do not run it on top of an existing API listener. `npm run dev` reloads source changes; restart the API after changing environment settings.

The expanded regression suite has **49 passing tests**, including a real viem custom-transport reproduction of silent resolver errors, fallback and zero-address cases, surviving name-control routes, stale/new-block comparisons, malformed imports, token identities, bounded activity and hosted restrictions. Tests use fixtures and injected providers, not real credentials. See [VALIDATION.md](./VALIDATION.md) for the verification record and remaining live-demo checks.

## Deployment and judging

- [DEPLOYMENT.md](./DEPLOYMENT.md): same-origin restricted public demo and Docker setup.
- [DEMO.md](./DEMO.md): a 90-second script, longer walkthrough and live evidence checklist.
- [SUBMISSION.md](./SUBMISSION.md): prepared submission copy; video/deployment links still require real artifacts.
- [HACKATHON_REVIEW.md](./HACKATHON_REVIEW.md): the earlier assessment that motivated this expansion; it is a historical review, not the current feature list.

No deployment, ENS write, payment or public submission was performed by this implementation. No contract addresses are claimed because Footprint deploys no custom contract.

## What we built during Common S3nse

The project-specific frontend/backend, ENS and Mobula adapters, map, strict-read fixes, Default-aware draft simulation, route explanations, scoped control evidence, before/after workflow, local snapshots, bounded activity, controlled-demo safeguards and regression suite were built in the August 31 workspace sessions. Public libraries, SDKs and existing public contracts are dependencies. Keep the genuine Git history and review what is actually committed before submission; do not manufacture build history.

**Pre-existing work:** repository scaffolding and submission materials preceded the application work. Any additional pre-event project-specific work must be disclosed by the team. The earlier same-day prototype is part of the hackathon build, not an external product dependency.

**Team:** Maurice Boendermaker — builder. Contact details are in [SUBMISSION.md](./SUBMISSION.md); update roles if the team changes.

## References

- [ENS deployments](https://docs.ens.domains/learn/deployments/), [ENSIP-19](https://docs.ens.domains/ensip/19/)
- [ENS AddrResolver source](https://github.com/ensdomains/ens-contracts/blob/staging/contracts/resolvers/profiles/AddrResolver.sol), [ENSIP19 implementation](https://github.com/ensdomains/ens-contracts/blob/staging/contracts/utils/ENSIP19.sol)
- [Mobula portfolio API](https://docs.mobula.io/rest-api-reference/endpoint/wallet-portfolio), [Mobula activity API](https://docs.mobula.io/rest-api-reference/endpoint/wallet-activity)

MIT — see [LICENSE](./LICENSE).
