# Common S3nse 2026 — Footprint

## Project name

**Footprint — privacy preflight for ENS**

## Description

Footprint shows what an ENS identity exposes through public records, wallet holdings and bounded activity. Preview publishing changes, understand the routes that survive, and compare a fresh snapshot after an edit — with evidence from ENS and Mobula, clear unknowns and no anonymity score.

## Team contact

**Maurice Boendermaker — builder**

**Discord:** `mauries`

**Telegram:** [@MauriceBoendermaker](https://t.me/MauriceBoendermaker)

## Code

[Project repository](https://github.com/MauriceBoendermaker/common_s3nse_hackathon_2026)

Run: `npm ci && npm run dev`, then open http://127.0.0.1:5173. The built-in synthetic rehearsal requires no credentials. The README contains scope, trust boundaries and testing instructions.

**Technologies:** React, TypeScript, Vite, Fastify, viem, Zod, Ethereum RPC, ENS, Mobula.

**Partner technologies:** ENS mainnet resolution, ten strict record reads at one block, supported Public Resolver `hasAddr`/Default semantics and scoped name-control observations. Mobula wallet portfolios, chain-qualified contract identities and optional thirty-day activity samples.

## Tracks and bounty targets

- Privacy / Security.
- ENS partner bounty — deliberate publication, resolver semantics and fresh after-state verification.
- Mobula partner bounty — financial evidence behind a disclosure decision, portfolios and optional bounded activity.

The team must confirm final partner-specific eligibility and whether both bounties may be entered. This copy does not claim acceptance or a prize.

## Demo

**Video:** recording/link still required. Prepare the 90-second version from [DEMO.md](./DEMO.md), plus a longer live walkthrough if requested by organizers.

**Deployment:** actual public URL still required if deploying. [DEPLOYMENT.md](./DEPLOYMENT.md) describes the restricted hosting profile. No deployment URL is fabricated here.

**Network:** Ethereum mainnet ENS reads; Ethereum and Base portfolio/activity observations. The default demo is entirely synthetic.

**Contracts:** no custom contract deployed. Footprint does not send transactions. Real profile changes are made by the user through the official ENS application.

## What was built during Common S3nse

The project-specific application, interactive evidence interface, ENS/Mobula adapters, strict resolver error handling, supported Default-aware draft simulator, surviving-route explanations, before/after comparison, local snapshot workflow, activity sample, hosting safeguards and regression suite were implemented in the August 31 build sessions. Preserve the actual commit history as the record of implementation.

**Pre-existing work:** repository scaffolding and submission materials; public libraries/APIs/contracts are dependencies. The team should disclose any additional relevant pre-event work before submitting.

## Trust and privacy

No application report database, request/body logging, remote avatars, analytics, wallet signatures or transaction submission. The API/RPC/Mobula can observe explicitly requested queries; hosting providers may keep their own logs. Imported snapshots are unverified. No ownership clustering, complete history scan, anonymity guarantee or claim that removing a record erases prior exposure.

## Submission checklist

Existing registration/access items below were marked complete in the team's original checklist; they have not been independently reverified by this build.

- [x] Project created on TAIKAI (team-provided status)
- [x] Team members added (team-provided status)
- [x] Repository public (team-provided status; recheck in a private window)
- [x] Local project description and README prepared
- [ ] Confirm source and lockfile are present in the submitted repository
- [ ] Confirm sponsor criteria and select tracks/bounties in TAIKAI
- [ ] Record/upload demo and add the real public link
- [ ] Deploy if desired and add the real URL
- [ ] Complete a consenting live-profile walkthrough and record its limitations
- [ ] Test every submission link in a private browser window
- [ ] Publish the TAIKAI project before **September 5, 2026, 09:00 CEST — Amsterdam local time**
- [x] Team plans an IRL representative (team-provided status; ensure attendance)

The live platform entry, video upload, deployment and final submission were not performed by preparing this document.
