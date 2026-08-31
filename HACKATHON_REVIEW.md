# Footprint: competition review and build priorities

Reviewed August 31, 2026. **Historical assessment:** the recommendations below were subsequently implemented in the expanded app. See README.md and VALIDATION.md for current functionality and checks. The original review itself left application source unchanged.

**Recommendation: keep Footprint. It is a credible initial prototype, but its distinctive product behavior is not finished. Make it a privacy preflight for ENS profile changes: understand a disclosure, preview a change, explain what remains discoverable, and verify the result.**

No review can predict a Top 10 placement or a partner prize. The opportunity is to make the project easier to understand, harder to dismiss as a wallet explorer, and more convincing under technical questioning.

## What exists today

| Capability         | Current implementation                                                                                      | Assessment                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Application        | React/TypeScript, Vite, Fastify, shared types, no database                                                  | Sensible scope; no rewrite needed                                                        |
| ENS                | Name normalization; nine reads at one mainnet block; resolver lookup                                        | Real integration, with an error-classification issue below                               |
| Supported records  | Ethereum, Base, Solana bytes, Twitter, GitHub, URL, email, description, avatar                              | Fixed, disclosed coverage; not a complete identity audit                                 |
| Mobula             | Authenticated server-side portfolio requests for published Ethereum/Base addresses                          | Real adapter, explicit failure handling, no key in frontend                              |
| Exposure map       | Selectable identity, record and wallet nodes with evidence inspector                                        | Useful explanation interface; currently a fixed three-column map                         |
| Publishing preview | Toggle existing records; filter directly linked wallets and totals                                          | Working visual draft, but cannot add/replace records or simulate resolver behavior       |
| Findings           | Four rules based on the presence of addresses, social records and email                                     | Honest but generic; findings do not analyze wallet activity or propose a concrete change |
| Export             | Download original report JSON                                                                               | Useful portability; no import/replay or before/after comparison                          |
| Privacy boundaries | No analytics, application request logging, report database, or remote avatars; explicit provider disclosure | A strength worth preserving                                                              |
| Demo               | Clearly labeled synthetic dataset, isolated from live requests                                              | Good fallback; needs a consenting real-profile story alongside it                        |
| Submission         | README mostly developed; submission template incomplete; app files untracked                                | Not ready for handoff to judges                                                          |

### Checks performed

- `npm test`: **27/27 passed**, after rerunning outside the Windows sandbox because the test runner's system user lookup failed inside it.
- `npm run build`: TypeScript checks and production build passed.
- `npm run format:check`: passed.
- Freshly compiled Fastify application: HTML, health and demo endpoints returned 200; unknown API route returned 404; missing consent returned 400. Security/no-store headers were present.
- Existing local server health reported a configured mainnet RPC and a successful Mobula check timestamped `2026-08-31T16:07:28.049Z`. That is existing process state, not a new external verification performed by this review.
- No new real-person ENS audit, payment, ENS record write, deployment, or publication was performed.
- Browser navigation to the local app was blocked by the browser client. This review does **not** claim a new visual or interactive browser verification. Layout observations below are based on the code and CSS.

## Correctness and readiness findings

### 1. Fix ENS failures being classified as empty successful reads

Location: `server/providers/ens.ts:104-105` and coverage calculation at line 126.

The adapter does not pass `strict: true` to viem's ENS record readers. The installed viem implementation can convert Universal Resolver errors such as `ResolverError` and `HttpError` into `null`. The adapter then treats that fulfilled null result as an absent record and increments successful coverage.

An isolated reproduction used the actual installed viem readers, a synthetic transport returning `ResolverError` for every record, and a valid modern block number. It made no network calls. The result was:

```json
{
  "records": 0,
  "coverage": { "checked": 9, "succeeded": 9, "failedKeys": [] }
}
```

The same viem text lookup with strict mode threw as expected. The existing tests inject a reader that throws directly, so they do not exercise viem's conversion to null.

**Required outcome:** explicitly distinguish populated, empty, failed and unsupported reads. Use strict reads and classify expected outcomes deliberately. Add a regression at the actual viem transport boundary, alongside the existing empty-record and partial-outage cases. Never present a resolver failure as evidence that a record was not published.

### 2. A resolution result is not necessarily an independently stored record

Location: `server/providers/ens.ts`, `shared/types.ts`, `src/components/PreviewPanel.tsx`.

Every nonempty chain lookup currently becomes an independently toggled record. The UI warns that values may be inherited, but the data model does not describe that provenance or simulate its consequences.

On compatible resolvers, an unset chain address can fall back to a Default EVM address. Removing a chain override can therefore reveal a fallback rather than remove resolution. This behavior is documented by [ENS support](https://support.ens.domains/en/articles/16648170-what-is-the-default-address-on-my-ens-name) and [ENSIP-19](https://docs.ens.domains/ensip/19/).

**Required outcome:** distinguish the value returned by resolution from a proven explicit record. Implement preview semantics for a clearly supported resolver/version first. For arbitrary/custom resolvers, mark the origin or proposed result unknown when it cannot be established. Equal returned addresses alone do not prove fallback.

Technical reference: ENSIP-19 defines Default EVM coin type as `0x80000000` (2147483648); Bitcoin coin type is 0. Do not confuse chain ID 0 with coin type 0.

### 3. Preserve token identity in the evidence model

Location: `server/providers/mobula.ts:30` and `parsePortfolio` at line 102.

The normal asset model retains name, symbol, amount and value but drops ordinary token contract identities. ETH/WETH separation is a useful exception. A synthetic ordinary-token response containing a chain and contract produced an output with only name, symbol, balance and USD value.

**Required outcome:** retain chain-qualified token identifiers and provider provenance. If a row aggregates several contracts, preserve that relationship instead of inventing a single contract. Let the inspector show exact identities and deliberately opened explorer links. A symbol is display text, not token identity.

### 4. Current findings are not personalized decisions

Location: `server/analysis.ts:5`.

`buildFindings(records)` only receives records. It cannot explain the financial consequence of a proposed edit, relate a finding to observed activity, or determine whether another checked route survives. Most people with a social record and address receive essentially the same advice.

**Required outcome:** each main finding should answer: what is observable, what evidence supports it, which change affects it, what functionality that change would alter, and what remains unknown.

### 5. Treat public hosting as a separate readiness step

Location: `server/app.ts:30-32`, verification endpoint at line 58, `server/config.ts`.

The application deliberately defaults to loopback and has no authenticated access controls. The consent checkbox is an acknowledgment, not proof of control. The provider verification endpoint would allow public visitors to spend API requests. In-memory IP limits alone are not a complete quota strategy. Shared venue Wi-Fi and reverse proxies also need consideration.

**Practical hackathon scope:** public synthetic demo plus a small server-enforced allowlist of consenting live demo profiles, explicit upstream spend/concurrency limits, restricted provider diagnostics, and documented provider disclosure. A broadly open audit service is a later decision. Configure trusted proxies for the chosen host; do not blindly trust forwarded IP headers.

Do not equate signing with the resolved payment address to authorization to manage an ENS name. Those roles can differ. Keep record writes in the official ENS application for this week unless direct writes are already well tested.

### 6. Preserve the work and finish the submission

`git status` shows the app source, tests and package files are untracked; the local committed tree contains scaffolding/documents rather than this implementation. This review does not verify the remote repository state. Make reviewed commits during the event, check for secrets, and verify the submitted repository includes the app and lockfile. Do not rewrite history to manufacture evidence.

`SUBMISSION.md` still has placeholders for the name, description, demo, deployment and bounty categories. Its deadline uses CET, while the newer instructions supplied for this review use CEST. Use **September 5, 09:00 Amsterdam local time** as the planning deadline and confirm any organizer ambiguity.

## The product that should be demonstrated

**Footprint helps ENS users see the consequences of publishing identity records before they publish, then checks what changed afterward.**

Start with one person and one decision: an ENS user deciding whether to associate a wallet with their public professional identity. Do not make a feature buffet for traders, investigators, invoicers and security researchers.

The main workspace should show:

| Current profile                               | Proposed change                           | Result within checked scope                                                   |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Published/resolved links with source evidence | Add, replace or remove a supported record | Newly discoverable, no longer directly linked, still discoverable, or unknown |

The important result is a plain-language explanation attached to a path. Examples are scenarios to implement, not claims about existing live names:

- “Publishing this address would add a direct path from your name to these observed holdings.”
- “Removing this chain override still leaves the same address available through the Default.”
- “This address is still published in another retained record.”
- “This link is no longer in the current checked profile. It was observed before the update; history has not been erased.”

Keep chain-qualified accounts distinct. Matching address bytes on different chains do not establish common ownership, especially for smart accounts. A reported route means information remains discoverable, not that the app has identified a person.

### The smallest convincing implementation

1. **Fix evidence correctness first.** Strict ENS reads, ordinary token identifiers, explicit data origin and checked coverage.
2. **Replace hide-only preview with an editable draft.** Add/replace/remove the supported fields; preserve the original snapshot. Explain that looking up a proposed wallet sends its address to providers even before anything is published onchain.
3. **Compute surviving routes.** Start with duplicate current record references and a supported Default EVM resolver case. Return a path explanation, not a safety score. Unsupported resolution behavior stays unknown.
4. **Re-audit and compare.** Guide the user to review the exact intended edit in the official ENS app. After their own update, fetch a new block and show whether the proposed result occurred. Keep the two observations in browser memory unless explicitly exported. Label older evidence “previously observed in this session”; do not imply a complete historical scan.
5. **Make it understandable without narration.** Add a focused presentation view, readable path labels, one primary finding, and a visible evidence button. Keep advanced provider diagnostics outside the normal first screen.

ENS name ownership/management is another possible public connection, separate from payment records. If adding it, scope to supported `.eth` ownership arrangements and handle wrapped names correctly. It is useful follow-on work, not permission to label a returned payment address the owner. [ENS explains the separate roles here](https://support.ens.domains/en/articles/9185310-disassociate-a-eth-name-from-your-wallet).

### Optional addition if Mobula is the primary bounty target

Add a small activity panel that explains what associating the proposed wallet would expose: selected transfers/swaps, exact transaction hashes, chain and observation time. Keep it bounded to a short window and small result count. Explain pagination and incomplete coverage. Do not recursively investigate counterparties or infer salary, real-world relationships or account ownership.

Mobula documents [wallet activity](https://docs.mobula.io/rest-api-reference/endpoint/wallet-activity) separately from [portfolio data](https://docs.mobula.io/rest-api-reference/endpoint/wallet-portfolio). The activity endpoint uses `/api/2/wallet/activity`; the current adapter uses `/api/1/wallet/portfolio`. Confirm actual plan access and request/response behavior before committing this to the demo. A second endpoint is useful only if it improves the same disclosure decision.

## Why this fits the judging criteria

| Criterion supplied by organizers | Evidence to show                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Technical execution              | Real resolver semantics, immutable drafts, surviving-path explanations and failure-boundary regression tests |
| Problem and relevance            | A real ENS user makes a specific publishing decision                                                         |
| Working product                  | Preview, a user-performed record update, and a verified new snapshot                                         |
| Innovation                       | Personalized consequences and residual links, beyond listing public records and balances                     |
| Privacy/security thinking        | Honest limits, no ownership clustering, unknown states, provider disclosure and no silent fixtures           |
| Clarity                          | One memorable case that a judge can reproduce                                                                |

My assessment is that ENS is the clearest primary pitch: the product improves deliberate use of ENS. Mobula is essential evidence enrichment, with a stronger standalone story if the bounded activity view is delivered. Neither assessment is a claim about official eligibility.

The [organizer page](https://commons3nse.cryptocanal.org/hackathon) currently advertises ENS, Mobula and Superteam NL partner bounties of 2k. This review could not verify detailed partner acceptance criteria or prize stacking. Ask the sponsors which requirements apply to a read-only ENS/Mobula project, which endpoints/features they expect, and whether the same project can enter both. Do not infer currency or eligibility beyond what the partners confirm.

## Remaining-week build order

This is a suggested allocation, not a guaranteed effort estimate.

| Day              | Finish line                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Monday, Aug 31   | Preserve current implementation in reviewed Git history; select consenting demo profiles; verify sponsor requirements and actual API access |
| Tuesday, Sep 1   | Fix ENS error handling; preserve token identities; implement supported resolver provenance and test residual paths                          |
| Wednesday, Sep 2 | Editable publishing preview plus re-audit comparison; one complete meaningful scenario                                                      |
| Thursday, Sep 3  | Restrained Mobula activity addition only if core journey is stable; deployment safeguards; focused presentation layout; user tests          |
| Friday, Sep 4    | Freeze features; resolve failures; record a 90-second video and longer backup; complete README/submission; verify public links              |
| Saturday, Sep 5  | Submit before 09:00 Amsterdam time, with enough upload margin; prepare laptop and offline recording                                         |

If Wednesday's core journey is not reliable, cut activity enrichment, broad history scanning, ownership expansion and direct wallet writes. Keep the preflight and verification loop.

Test with five consenting ENS users. Ask each to explain one disclosed connection, predict the consequence of a proposed edit, and find its evidence without coaching. Record actual confusion and actual decisions; do not invent validation numbers for the pitch.

## A 90-second demo to rehearse

| Time   | Show and say                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–10s  | Show a team-controlled profile. “I want people to pay my public name. I also want to understand what that name reveals.”                                                          |
| 10–25s | Live ENS records unfold into Mobula holdings. Open the evidence for one link.                                                                                                     |
| 25–45s | Preview adding/replacing/removing one address. Show the concrete consequence, not just a changed total.                                                                           |
| 45–60s | Show a supported residual path: a retained reference or Default still exposes the address. Explain why the proposed edit does not remove that route.                              |
| 60–78s | Show a team-performed ENS update and the fresh re-audit comparison. In a recording, visibly cut across the confirmation wait. Keep prior observation separate from current state. |
| 78–90s | “ENS tells us how the name resolves. Mobula shows what that address makes observable. Footprint helps users choose deliberately, with evidence and explicit limits.”              |

Do not rely on a live transaction confirming within a judging slot. Have the real update recorded, with its transaction and before/after blocks available. Never present a recording or synthetic fixture as a fresh live response.

## Definition of ready

- One real, consenting ENS profile completes the full story repeatedly.
- One residual-link case is correctly explained and independently checkable.
- Failed/unsupported reads cannot become successful empty records.
- Ordinary token evidence retains chain and contract identity.
- Proposed edits never mutate the original snapshot.
- Re-audit distinguishes observed record changes from independent portfolio price/timing changes.
- Missing provider data remains unknown; previously observed evidence remains labeled historical to the session.
- A judge can use the intended desktop flow without hunting through tiny labels or horizontal scrolling. Current CSS uses a 720px minimum graph and many 8–11px labels; validate the presentation layout on the actual laptop/projector.
- Public hosting does not expose unrestricted provider diagnostics or unbounded API spend.
- Code, deployment, video and README links work for a signed-out judge.
- You can explain the core implementation, its trust assumptions, and what was built during the hackathon without relying on the generated README as a script.

**The next milestone should be one correct, evidence-backed preview and re-audit flow. More visual polish alone will not close the current product gap.**
