# Private Credit — Backend & Smart Contract Plan

**Target:** turn the current front-end simulation into a functional, dual-chain, privacy-preserving credit
protocol in time for Common S3nse.

| | |
|---|---|
| **Written** | 2026-09-03, ~18:40 CEST |
| **Submission deadline** | **Sat 5 Sep 2026, 09:00** (verified on commons3nse.cryptocanal.org: *"Sept 5 - 09:00 Hackathon ends. Final submissions."*) |
| **Wall clock remaining** | ~38 h · **realistically 20–24 workable hours** |
| **Bounties targeted** | ENS $2,000 · SuperteamNL/Solana $2,000 · Mobula $2,750 + $2,750 credits |
| **Judging needs** | open repo · demo video/deck · deployed contract addresses · **"functional with no hard-coded demonstrations"** |

---

## 0. The one-paragraph version

The app today is a convincing shell with **zero** substance behind it: one React `useState` shared by both
"parties", three `setTimeout` calls standing in for proving, verification and every transaction, and a
hard-coded `DEMO_WITNESS` constant that every pass/fail badge is derived from. That last item alone
disqualifies it from the ENS bounty, which explicitly requires *"functional with no hard-coded
demonstrations"*. The fix is not cosmetic. We need (a) a **real trust boundary** — two processes, not two
render branches; (b) a **real witness** from real portfolio data; (c) a **real Groth16 credential**; and
(d) **ENS carrying a load-bearing privacy function**, not a display string. I have already built and
verified the hardest parts of that chain end-to-end on this machine (§1) — including a single circom proof
verifying on **both** Ethereum and Solana. What remains is integration, and integration is what the
remaining hours should be spent on.

**Recommended shape: one credential, two rails, no bridge.**
Ethereum/ENS is the *identity and discovery* rail. Solana is the *underwriting and settlement* rail. The
same Groth16 proof is verified on both. The user's browser is the only thing that crosses between them —
there is no bridge, no relayer, no guardian set.

---

## 1. What is already proven (executed, not researched)

Everything in this table was run on **this machine, today**. These are not estimates. This matters because
it converts the plan's highest-risk assumptions into settled facts, and because the artifacts can be moved
straight into the repo.

| # | Claim | Evidence |
|---|---|---|
| 1 | **circom needs no Rust on Windows** | `circom-windows-amd64.exe` v2.2.3 (12 MB) downloaded and run → `circom compiler 2.2.3` |
| 2 | **The real policy circuit compiles** | 221 template instances, **1090 non-linear + 1301 linear constraints**, 4 public inputs, 2 public outputs |
| 3 | **Proving is fast** | `groth16.fullProve` → **600 ms**; `groth16.verify` → **18 ms** (Node 22) |
| 4 | **The policy logic actually discriminates** | Passing profile → `eligible = 1`. Policy raised to 500k assets → `eligible = 0`, same `passportCommitment` |
| 5 | **EVM verifier works** | `snarkjs zkey export solidityverifier` → compiles under solc 0.8.36, **1845 bytes** runtime, `verifyProof(uint[2],uint[2][2],uint[2],uint[6])` |
| 6 | **⭐ The same proof verifies on Solana** | `groth16-solana` 0.2.0 in Docker: `proof.A NEGATED : VERIFIED` / `proof.A as-is : rejected` / `TAMPERED inputs: correctly rejected` |
| 7 | **Browser proving is viable** | snarkjs 0.7.6 ships `build/browser.esm.js` (537 KB) under the `exports.browser` condition — Vite resolves it automatically. Artifacts: wasm 3.1 MB + zkey **1.13 MB** + vkey 3.8 KB |
| 8 | **Stealth addresses work** | 3 successive disbursements to one ENS identity → 3 unlinkable addresses, each recovered and spendable by the recipient |
| 9 | **ENS infra is live on Sepolia** | Registry `0x0000…2e1e`, PublicResolver `0x8FADE6…B7dD`, ETHRegistrarController `0xFED6a9…5B72`, **ERC-5564 Announcer `0x55649E…5564`**, **ERC-6538 Registry `0x6538E6…6538`** — all return bytecode |
| 10 | **Names are available** | `privatecredit.eth` / `commons3nse.eth` / `s3nsecredit.eth` available on Sepolia @ **0.00313 ETH/yr**. ⚠️ `alice.eth` and `vault.eth` are **taken** |
| 11 | **Solana devnet is live** | `solana-core 4.3.0-beta.3`, SPL Token program present |
| 12 | **Mobula endpoints are real** | `/api/1/wallet/portfolio` + `/api/1/market/data` return auth errors (not 404) — and `demo-api.mobula.io` serves the whole surface **keyless with `access-control-allow-origin: *`** |

### 1.1 The dual-chain conversion recipe (the crux)

This is the thing that makes "one proof, two chains" real rather than aspirational. A snarkjs Groth16 proof
converts to `groth16-solana` input as:

- **`proof.A` must be negated** — `(x, p − y)`. Non-negated A is rejected. This is not optional.
- **G2 coordinates swap**: snarkjs gives `[[x.c0, x.c1], [y.c0, y.c1]]`; Solana wants **c1 before c0**.
- **All values 32-byte big-endian.** Guard the conversion — if a value exceeds 32 bytes, `padStart(64)`
  silently no-ops and corrupts the proof. Throw instead.
- `vk_ic.len()` must equal `nPublic + 1`.

> **Trap, verified:** published `groth16-solana` **0.2.0 ≠ GitHub master.** The published crate has **no
> feature flags**, no `vk::circom` module, no `proof_parser.rs`, and the struct field is misspelled
> **`vk_gamme_g2`**. Writing `vk_gamma_g2` is a compile error. VK generation in the published crate is a
> bundled Node script (`npm run parse-vk`), not a Rust helper. My working test used `vk_gamme_g2` and
> compiled first try; every "generate_vk_file" tutorial you find describes master and will not work.

All of this is committed under **[`prototype/`](./prototype/)** (authored today, inside the event window) with
reproduction commands in [`prototype/README.md`](./prototype/README.md):

```
prototype/zk/circuits/credit_policy.circom   prototype/zk/to_solana.mjs      (the converter)
prototype/zk/prove.mjs                       prototype/solana-verify/        (Rust verification test)
prototype/zk/Verifier.sol                    prototype/ens/stealth.mjs, check.mjs
```

---

## 2. What the front-end is faking

Four parallel audits covered every file. The full inventory is ~110 items; these are the load-bearing ones.

### 2.1 The three structural problems

**(a) There is no trust boundary.** `App.tsx:42` holds a single `useState<DemoState>`, and *both*
`BorrowerView` and `LenderView` receive it **and its setter**. The lender's code path literally reads the
borrower's secret witness — `LenderView.tsx:258`'s "Load a policy that fails this demo profile" button
hard-codes `500_000` precisely *because* `DEMO_WITNESS.assets` is `340_000`. Until borrower and lender are
separate processes with separate keys, **every privacy claim in the UI is decorative**, and the ENS
bounty's "explain what is protected, from whom" cannot be answered at all.

**(b) Three `setTimeout`s are the entire engine.**

| Location | Delay | Pretends to be |
|---|---|---|
| `App.tsx:79-85` | 1400 ms | ZK proof generation |
| `App.tsx:87-104` | 1400 ms | Proof verification |
| `App.tsx:108-144` | 1200 ms | **All seven** wallet transactions |

**(c) `DEMO_WITNESS` is the load-bearing constant.** `config/product.ts:103-108` —
`{assets: 340_000, debtRatio: 28, historyMonths: 14, hasRestrictedExposure: false}`. Read only by
`evaluatePolicy()` (`state/demo.ts:149`), which is called from the App verification timer, from
`ProofReceipt` (so the *lender's* component recomputes the verdict from the borrower's witness), and from
the borrower view. This is the single disqualifying item.

### 2.2 Inventory by layer

| What the UI shows | Reality | Needs |
|---|---|---|
| "Forward and reverse resolution match", "Controller verified" | static JSX; renders unconditionally | ENS forward + reverse resolution, registry `owner()`, SIWE/EIP-1271 signature |
| ENS names everywhere (`alice.eth`, `vault.lender.eth`) | display strings; **no ENS call exists in the repo** | ENS must carry a *function* — this is the bounty's explicit disqualifier |
| "Passport commitment `0x91ca…0f42`" | frozen literal, never recomputed, never published | Poseidon commitment over the real witness + blinding salt |
| 3 "passport sources" with Connect/Retry | `toggleSource` pushes a string into an array. Zero network calls | **Mobula adapter** → real balances, debt, account age |
| "Policy fingerprint `0x…`" | `minAssets*17 + maxDebtRatio*101 + …` — invertible over 72 possible policies | `Poseidon(policy params)`, computed identically in circuit, contract and both clients |
| "Generate ZK proof" → receipt | 1400 ms timer; no circuit, no prover, no artifact | snarkjs in a Web Worker |
| Proof ID / circuit / verifier contract / valid-until | all frozen literals containing Unicode ellipses | real hashes, real deployed address, real timestamps as public inputs |
| "Verify ZK proof" | re-runs `evaluatePolicy` against `DEMO_WITNESS` | on-chain verification (Solana program + Sepolia verifier) |
| "restricted to vault.lender.eth and policy 0x…" | prose only; nothing binds anything | verifier identity + nonce + expiry as **public inputs** |
| Publish request / fund / accept / draw / repay | `setTimeout` writing a status string | real transactions against an escrow program |
| 2 competing offers | constants in `config/product.ts:77-94` | real funded offers from distinct lender identities |
| "The repayment event can now update the ENS-anchored reputation commitment" | a sentence; no code anywhere | either implement or delete |
| "Preview source outage" / "Preview proving failure" / "Preview expired proof" / "Load sample request" | operator-pressed demo shortcuts | **delete before submission** — these read as hard-coded demos |

---

## 3. Recommended architecture

```
                    BORROWER BROWSER (the only place raw data exists)
                    ┌──────────────────────────────────────────────┐
   Mobula ─────────▶│ witness {assets, debtRatio, historyMonths,   │
   (server-proxied) │          restrictedExposure} + salt          │
                    │            │                                 │
                    │            ▼  snarkjs in a Web Worker        │
                    │   proof (256 B) + public signals             │
                    └──────┬────────────────────────┬──────────────┘
                           │                        │
        ETHEREUM SEPOLIA   │                        │   SOLANA DEVNET
        identity+discovery │                        │   underwriting+settlement
     ┌─────────────────────▼──────┐      ┌──────────▼─────────────────────┐
     │ ENS name = only public id  │      │ private_credit program:        │
     │ text record: payout        │      │  • groth16 verify (~105k CU)   │
     │   meta-address             │      │  • recompute policyHash on-    │
     │ ERC-6538 registry entry    │      │    chain from stored Policy    │
     │ CredentialAnchor.sol       │      │  • nullifier PDA (replay stop) │
     │   (same VK, same proof)    │      │  • SPL-USDC escrow → payout    │
     └────────────────────────────┘      └────────────────────────────────┘
                    ▲                                  │
                    └── lender resolves ENS, derives ──┘
                        a fresh one-time payout address
```

**Why two chains is not decoration:** the lender cannot pay the borrower on Solana without first resolving
the borrower's ENS name on Ethereum to derive a one-time payout address. **Remove ENS and the Solana
settlement leg stops working.** That is the sentence to put on the slide.

**The single artifact that sells it — the "Credential Passport" strip.** Three live rows:
1. **`VK_HASH` read from Sepolia and from the Solana program config, side by side, identical.** Visual proof
   both chains run the same circuit.
2. The same credential consumed on both chains (Etherscan tx + Solana Explorer tx) plus a **"Present again"**
   button producing a live on-chain rejection from the nullifier PDA. Unfakeable.
3. "Paid to `Hs9v…` — derived from `alice.eth`" with an explorer link.

### 3.1 Public signal layout (this ordering is a contract across circuit / Solidity / Rust / TS)

| idx | signal | purpose |
|---|---|---|
| 0 | `passportCommitment` | Poseidon over the private snapshot + salt |
| 1 | `eligible` | the only bit of underwriting that is disclosed |
| 2 | `policyHash` | Poseidon(minAssets, maxDebtRatio, minHistoryMonths, screenExposure) — **recomputed on-chain** from the stored policy, so the client is trusted for nothing |
| 3 | `subjectCommitment` | **`Poseidon(namehash(name), blindingFactor)`** |
| 4 | `expiry` | unix seconds; verifier checks `now < expiry` |
| 5 | `nullifier` | `Poseidon(salt, policyHash, verifierCommitment)` |

> **Two corrections that are easy to get wrong and fatal to the pitch:**
>
> 1. **Never publish a raw ENS namehash as the subject commitment.** namehash is an unsalted, publicly
>    computable function of the name — a rainbow table over any ENS name list inverts it instantly, so
>    "the name never appears on Solana" would be **false**. It must be salted: `Poseidon(namehash, blind)`.
>    Two independent fact-checks flagged this; it attacks the bounty rationale, not just the code.
> 2. **A namehash may exceed the BN254 scalar field** (~78% do; `alice.eth` does, `vault.lender.eth`
>    doesn't). Reduce mod `r` **identically** in circom, Solidity and Rust, and write a test asserting it —
>    otherwise verification fails ~1 time in 4 and looks random.

### 3.2 Circuit rules

- **`Num2Bits`/range-check every private amount before it reaches a comparator.** Without it the circuit is
  forgeable by field overflow while still appearing to work. This is soundness, not decoration — do not let
  a late-night "simplification" delete it.
- The `passportCommitment` **must be published before the lender issues its policy challenge.** Otherwise
  the borrower picks whatever numbers satisfy the policy and the proof proves nothing. This is precisely
  the difference between a mechanism and theatre, and precisely what ENS judges will probe.

---

## 4. Workstreams

Ordered by **value per hour**, not by architectural elegance.

### A — Real trust boundary + marketplace backend · ~3 h · prerequisite for everything

Split the single `useState` into two clients talking over an explicit channel.

- Backend store: in-memory `Map` + monotonic `version` integer. Both browsers poll
  `GET /api/state?since=<version>`. ~80 lines, no dependencies, works through every proxy.
- Endpoints: `POST /api/requests`, `POST /api/challenges`, `POST /api/proofs`, `POST /api/offers`,
  `GET /api/state`, `GET /api/passport/:address`.
- The lender bundle must become **structurally incapable** of reading the witness — separate route, separate
  session, no shared object.

> Traps: `app.get('*')` **throws on Express 5** — use `app.get('/{*splat}')`. Insert an
> `app.use('/api', …404)` *before* the SPA fallback or typo'd endpoints silently return `index.html` with
> HTTP 200. Never use a TS `enum` in the backend — `node --watch src/index.ts` dies with
> `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; mirror the frontend's string-union style.

### B — Mobula witness adapter · ~5 h · kills the disqualifier, wins bounty #3

Highest value per hour of anything in this plan: **zero blockchain risk, pure Node 22 `fetch`**, and it
removes the `DEMO_WITNESS` constant that would otherwise sink the ENS bounty too.

`backend/src/adapters/mobula.ts` → `buildWitness(evmAddress, solAddress?)`, behind
`GET /api/passport/:address`. Default `MOBULA_BASE=https://demo-api.mobula.io` (**keyless**, works
immediately); `MOBULA_API_KEY` + `https://api.mobula.io` as an env-only upgrade. The key stays server-side —
exactly what the security page already promises.

| Field | Source |
|---|---|
| `assets` | `/api/1/wallet/portfolio` **∩ allowlist** + `Σ defi.totalDepositedUSD` |
| `debtRatio` | `Σ defi.totalBorrowedUSD / assets` from `/api/2/wallet/defi-positions` |
| `historyMonths` | `/api/2/wallet/funding` → `data.date` |
| `restrictedExposure` | see correction below |

> **Four demo-breaking corrections, each verified live:**
>
> - **`isBlacklisted` is a contract-*capability* flag, not a reputation verdict.** USDC, USDT and stETH all
>   return `true`. Screening on it makes **every realistic wallet fail** its own policy check. Drop
>   `/token/security` from the witness entirely (it is also 50 of ~84 credits).
> - **`filterSpam=true` is a no-op.** `minliq` does 100% of the work, and **neither** prunes `data.assets[]`
>   — the array keeps all 5,855 rows including a $4.1T spam entry.
> - **`total_wallet_balance` is not collateral.** For vitalik.eth, ~88% of the filtered $721k is meme tokens
>   against $20k of real ETH. An **allowlist intersection** (ETH/WETH/WBTC/cbBTC/USDC/USDT/DAI/stETH/
>   wstETH/SOL) is **mandatory** for the `assets` figure, not a refinement.
> - **Use `/api/2/wallet/funding` for account age, not `/wallet/activity`** — activity's index doesn't reach
>   before ~2018 and reported vitalik.eth 2.5 years late, enough to flip a `minHistoryMonths` check.
>
> Also: latency is **8–23 s** on heavy wallets (not sub-second) — cap the input or pre-warm. The demo API
> **429s at ~10 rapid calls** with ~10 s recovery, and it's shared with every other hacker at the event, so
> get a free key from admin.mobula.io tonight as insurance. Aave V3 aTokens are inconsistently present in
> `/portfolio`, so you need **both** the `totalDepositedUSD` addition **and** a case-insensitive de-dup
> guard. Mobula prices testnets at **0** — read the passport from **mainnet** and say so in the UI.

### C — ZK credential pipeline · ~4 h · already 70% done (§1)

`zk/` as a third npm workspace: `getcircom.mjs` → `circuits/credit_policy.circom` → `build.mjs` → copies
`wasm`/`zkey`/`vkey` into `frontend/public/zk/`.

- **Generate the ptau locally** — 21 s for 2^12. Every Hermez/zkevm mirror is **403/404**; circomkit 0.3.4
  even hardcodes the dead bucket. Delete any `curl …ptau` step from your notes; it fails looking like a
  network problem.
- Do **≥2 phase-2 contributions**, publish the transcript, and state plainly in the README that this is a
  development setup, not a real ceremony. Judges reward the disclosure and will ask.
- Frontend: import snarkjs inside a **Vite module Worker**, created **once at app mount** and reused —
  a fresh worker per proof costs 650–750 ms of pure startup.
- Use `poseidon-lite` with **subpath imports** (`poseidon-lite/poseidon6`). Never the barrel import
  (33 KB → 433 KB gzipped), never `circomlibjs` in the browser (drags in ethers v5).
- If you add a CSP, allow `worker-src blob:` or ffjavascript's internal workers break obscurely.

### D — ENS privacy mechanism · ~7 h · wins bounty #1 · **no Rust required**

**The narrative:** *"The lender never learns the borrower's address. They know only `alice.eth`. Every draw
and repayment lands at a fresh, unlinkable address derived from the meta-address published under that name.
Remove ENS and the mechanism does not work."*

1. Register a Sepolia name (`privatecredit.eth`, verified available @ 0.00313 ETH/yr).
2. Derive spend/view keys from a `personal_sign` of a fixed message (ScopeLift's `generateKeysFromSignature`
   pattern) — no key storage, re-derivable on any device.
3. Publish the meta-address via `setText`, plus `registerKeys()` on the **ERC-6538 registry** (verified
   deployed) so there is an on-chain artifact to cite.
4. Lender reads the record **by name only**, derives a fresh address client-side, disburses, calls
   `announce()` on the **ERC-5564 Announcer** (verified deployed).
5. Borrower scans `Announcement` logs, filters by view tag, derives and sweeps.

Use plain `viem` + `@noble/curves@2.4.0` and hand-roll ~60 lines (working code in
[`prototype/ens/stealth.mjs`](./prototype/ens/stealth.mjs)). Do **not** install
`@scopelift/stealth-address-sdk` — it is `1.0.0-beta.5`; read its source for reference instead.
Cross-check one derivation against ScopeLift's output before demoing — hashing the
uncompressed 65-byte point instead of the **compressed 33-byte** one is self-consistent but interoperable
with nothing.

> **Traps:** A fresh stealth address has **zero ETH and cannot broadcast its own sweep** — the disbursement
> must also send ~0.002 Sepolia ETH. Budget 45 min; this is the single most likely thing to break the live
> demo. `eth_getLogs` limits vary wildly by RPC (publicnode 50,000 blocks, drpc 10,000, **1rpc just 50**) —
> chunk at ≤10,000 and store the publication block. The ENS manager app **will not display a custom text
> key**, so verify with a direct `text()` call and show *that*. The stealth-address ENSIP is an **RFC, not a
> standard**, and it explicitly says non-EVM scoping is **out of scope** — if you point it at Solana, use a
> clearly custom key and frame it as an early implementation of an in-flight ENSIP. Do not claim standard
> compliance; do not reuse ERC-5564 `schemeId 1` for a non-secp256k1 key.
>
> **Do not start:** `ensdomains/offchain-resolver` (dead since 2024), ENSv2 `UserRegistry`/`VerifiableFactory`
> subname issuance (ENS's own docs stamp them "not yet final"), Durin/L2 subnames, Unruggable Gateways,
> NameStone/Namespace (you'd be *configuring*, not building). A CCIP-Read wildcard resolver is genuinely
> impressive and is where your entire remaining budget disappears if anything misbehaves — **Tier 2 only if
> everything else is done.**
>
> **Precedent:** Fluidkey shipped ENS+stealth at ETHRome 2023 and runs it in production. A judge may know
> this. Differentiate on the credit framing: *policy-bound* disbursement where each draw under a ZK-verified
> underwriting policy lands at a fresh address. Lead with that, not with "we implemented stealth addresses."

### E — Solana program · ~8 h · wins bounty #2 · **start the funding step first**

One Anchor program, `private_credit`, built via the **`solanafoundation/anchor:v1.0.2` Docker image** — do
not install Rust natively, do not use WSL. (I compiled `groth16-solana` in Docker in **40 s**.)

Instruction `present_and_fund`:
1. `groth16-solana` verify — budget **~105k CU** for 6–7 public inputs (not the 95k the README implies;
   the benchmark table interpolates to ~105k). Set the CU limit to 400k.
2. Recompute `policyHash` on-chain via `solana-poseidon` from the **stored** Policy account and require
   equality with signal [2].
3. `init` a **nullifier PDA** seeded by signal [5] → a second presentation fails at the runtime level.
4. SPL-USDC transfer from escrow to the one-time payout address, **plus ~0.002 SOL** so the borrower can
   actually sweep, plus ATA rent.

> **⚠️ Devnet funding is the #1 schedule risk and the plan has no step for it unless you add one.** A probe
> from this network returned a `requestAirdrop` signature that reached **`finalized` with `err: null` while
> the balance stayed 0** — the transaction was a bare Memo from the faucet with the target not even in
> `accountKeys` — and the next request 429'd. A deployed program address is an explicit judging deliverable.
> **Get devnet SOL first, before writing any Solana code, and verify the balance actually landed rather than
> trusting the RPC response.** Use GitHub-authenticated faucet.solana.com or a Discord faucet. Deploy costs
> ~**0.63 SOL** (not 1.25 — the 2× upgrade reserve is legacy behaviour).
>
> Other traps: `anchor test` **fails in that image** (Anchor 1.0 defaults to the Surfpool validator, absent
> from the image) — use `cargo test` with LiteSVM, or `anchor test --validator legacy`. `anchor init`
> defaults to `-t multiple`; pass **`-t single`** to match a single-`lib.rs` program. Add
> `vite-plugin-node-polyfills` with `Buffer: true` or wallet-adapter breaks under Vite 7. Pin
> `@solana/web3.js@1.98.4` in root `overrides` — wallet-adapter takes it as a *peer* dep while Anchor takes
> it as a *regular* dep, and two copies produce baffling `PublicKey instanceof` failures.
>
> **Byte-conversion bugs are silent.** Every failure mode — wrong Fp2 limb order, forgotten negation,
> little-endian creeping in, an unreduced public signal — produces exactly one symptom: "proof invalid".
> Get `cargo test` green against your own fixtures **before** touching devnet. §1.1 and
> [`prototype/solana-verify/`](./prototype/solana-verify/) already do exactly this.

### F — Storage & hosting · ~3 h

- **Tier 0 — never persisted:** raw portfolio + witness. Browser memory only.
- **Tier 1 — backend:** requests, challenges, receipts, offers, lifecycle. Deliberately public; zero
  portfolio data.
- **Tier 2 — Swarm, ciphertext only:** passport envelope, AES-GCM-256, key generated in the browser via
  WebCrypto, **key never sent to the backend**, released to one chosen lender at accept time. Put the
  *reference* in an ENS text record, never the key. Line for the demo: *"Swarm has no delete. That is
  exactly why only ciphertext goes there."*
- **Tier 3 — Swarm, public:** signed proof receipts.

> Swarm verdict: **~90 minutes, gateway-only.** Do not run a Bee node (Gnosis RPC + funded wallet + xBZZ +
> chequebook + postage batch). Note Swarm has **no bounty** at this event — justify it as ENS-bounty
> reinforcement and partner goodwill only. Use `bee.file.upload`, **not** `bee.data.upload`: refs from
> `POST /bytes` return **404 on `/bzz/<ref>`**. Wrap every call in try/catch and keep your own copy — the
> public gateway is best-effort and accepted a completely random postage batch id with HTTP 201.

**Hosting:** one Render free web service serving both API and built SPA (one origin, no CORS, one URL for
TAIKAI). Pin `NODE_VERSION: 22.22.3` — **Render's current default is Node 24**. Add a cron-job.org ping to
`/health` every 10 min or the first judge hits a ~1-minute cold start. Render's free filesystem is
**wiped on restart, redeploy and spin-down**, so SQLite buys nothing there. If you keep ngrok as the
conference-wifi fallback, note it is capped at **20,000 requests/month** — a 1.5 s two-tab poll burns
4,800/hour — and it shows a browser interstitial judges must click through. Raise the poll interval.

**Do the first green deploy at hour 2 with a stub.** A deployed stub beats a perfect app that has never
been deployed.

---

## 5. Bounty alignment

| Bounty | Requirement | Satisfied by | Confidence |
|---|---|---|---|
| **ENS $2,000** | ENS beyond name display | Meta-address text record + ERC-6538 registration; ENS is the **only** input to deriving the payout address | High — but only with D shipped |
| | actual privacy mechanism | ERC-5564 stealth addresses (verified working, §1 #8) | High |
| | protected from whom, stated | Portfolio hidden from lender; payout addresses + credit graph hidden from all chain observers | High, **if** §3.1 salting is applied |
| | no hard-coded demos | Workstream B removes `DEMO_WITNESS`; delete all four "Preview…" buttons | **Currently failing** |
| **Solana $2,000** | build on Solana | On-chain Groth16 verification + nullifier PDA + SPL escrow | Medium — gated on devnet funding |
| **Mobula $2,750** | real data integration | Multi-endpoint witness adapter, server-side key, `sourceUrls` surfaced in UI | High — lowest risk of the three |

Surfacing the Mobula `sourceUrls` + `fetchedAt` next to the passport kills the "hard-coded demo" objection
for **both** the ENS and Mobula judges in one stroke.

**Note:** the SuperteamNL rubric could not be retrieved — TAIKAI's prizes page returns nothing to an
unauthenticated fetch. Log in and read it before finalising the Solana scope.

---

## 6. Build order and go/no-go gates

Run B, C and D in parallel where possible — they share almost no surface area.

| Hours | Work | Gate |
|---|---|---|
| **0–1** | **Get devnet SOL + Sepolia ETH first.** Register the Sepolia ENS name. Start the Render deploy with a stub. | 💰 **Funds confirmed landed?** If not, Solana is at risk — decide early |
| 0–3 | **A**: backend store, REST, polling, two separate clients | |
| 1–5 | **B**: Mobula adapter → real witness replaces `DEMO_WITNESS` | ✅ Highest-value milestone; ship this even if all else slips |
| 3–7 | **C**: circuit → local ptau → browser proving in a worker | |
| 5–12 | **D**: ENS stealth mechanism end-to-end | **Hour 12: is D working?** If not, cut Solana and perfect the ENS story |
| 7–9 | Byte-conversion + `cargo test` green against own fixtures | 🚦 **Do not deploy before this is green** |
| 9–17 | **E**: Solana program → devnet | **Hour 17: deployed?** If not, fall back to Sepolia-only verification |
| 17–20 | **F**: Swarm + hosting + Credential Passport strip | |
| 20–23 | Delete demo shortcuts, rewrite stale copy (§7), README, video | ⚠️ Reserve 3 h — this is not optional polish |

**Fallback ladder — decide at hours 1, 12 and 17, never at hour 22:**
1. Solana toolchain fails → ship Sepolia-only verification + ERC-5564 stealth. You lose the Solana bounty
   and keep a **complete, honest ENS submission**. Both fact-checkers independently recommended making this
   the *primary* plan, since it needs no Rust and it is the path that actually earns $2,000.
2. ENS stealth fights back → keep the ZK + Mobula + Solana story; ENS degrades to identity + commitment
   anchoring (weaker for bounty #1, still honest).
3. Everything slips → **B alone** (real data + real proof + real trust boundary) is still a dramatically
   better submission than today's simulation.

---

## 7. Copy that becomes false — must be rewritten

The marketing/security/legal copy is currently **honest** ("everything is simulated"). The risk is that it
goes **stale** the moment a backend exists, and judges read these pages.

| Page | Line | Action |
|---|---|---|
| SecurityPage | "Production contracts: None", "Real funds: Disabled" | Update to deployed addresses |
| SecurityPage | "Application state lives in the current browser session… no production persistence layer" | Now false — replace with the Tier 0–3 model from §F |
| SecurityPage | Trust model lists 4 assumptions | **Add a fifth: our own backend/prover/relay operator** — what it can see, what it could forge, that it is a single unaudited operator. A trust model that omits the author's own server reads as naïve |
| HowItWorks | "No proof or funds move onchain" prototype banner | Now false |
| HowItWorks | "Witness construction and policy evaluation" listed as Local/private | **Only stays true if proving is in the browser.** If you move proving server-side, the server sees raw balances — rewrite both cards |
| AudiencePages | ENS listed as "Shared" while portfolio is "Hidden" | Self-contradictory today; becomes coherent once stealth addressing lands |
| PrivacyBoundary | two hard-coded lists | Generate the disclosed set **programmatically** from the actual public signals |

Also delete: "Preview source outage", "Preview proving failure", "Preview expired proof", "Load a policy
that fails this demo profile", and "Load sample request" — or make the last one seed a *real* account.

---

## 8. Honest trust assumptions (put these on a slide)

1. **Trusted setup.** A hackathon phase-2 means whoever ran it could forge proofs. ≥2 contributions,
   published transcript, stated plainly.
2. **Data honesty.** The proof shows the policy holds over data from Mobula. We prove honest *computation*,
   not honest *data*. Naming this earns credit.
3. **VK equality.** Both verifiers are "the same circuit" only because both were derived from one zkey —
   made visible by the on-chain `VK_HASH` on both sides.
4. **ENS resolution.** The Solana program cannot read ENS; it accepts the payout address the lender's client
   supplies. The payer is the party incentivised to resolve correctly, and the borrower detects misdirection
   immediately.
5. **Gateway metadata.** Whoever operates the backend/gateway sees request timing and IPs even when it never
   sees plaintext.
6. **`groth16-solana` is unaudited** at 0.2.0 (only 0.0.1 was covered by the Light Protocol v3 audit). Say
   "widely used, 128k downloads, unaudited" — do **not** tell judges it is audited.

---

## 9. Open decisions

1. **Is Mobula in scope?** You named ENS and Solana. Mobula is worth **more than either** ($2,750 + $2,750
   credits), needs **no blockchain work**, and is the thing that removes the hard-coded-witness disqualifier.
   **My recommendation: yes, and do it first.**
2. **Which chain settles the loan?** Solana (as diagrammed) makes ENS load-bearing for the Solana leg — the
   strongest dual-bounty story — but the ENS→Solana payout derivation is a custom extension the ENSIP
   explicitly does not cover. Sepolia settlement uses fully standard, already-deployed ERC-5564/6538
   contracts and is lower risk. **Recommendation: build the Sepolia stealth path first (it is the $2,000
   ENS mechanism), and upgrade to ENS-derived Solana payout only if hour 12 is green.**
3. **Browser proving or server proving?** Browser keeps the "witness never leaves the device" claim true and
   is verified viable (§1 #7). Server proving is simpler but **makes the security page false**.
   **Recommendation: browser.**
4. **Mainnet ENS name?** ~$8 buys a mainnet name with the same text record. Judges who resolve your Sepolia
   name on mainnet see nothing. Cheapest credibility purchase available.

---

## Appendix — verified commands

```bash
# circom, no Rust required
curl -sL -o circom.exe \
  https://github.com/iden3/circom/releases/download/v2.2.3/circom-windows-amd64.exe
./circom.exe credit_policy.circom --r1cs --wasm --sym -l node_modules -o .

# local ptau (21s) — the Hermez mirrors are DEAD, do not curl them
npx snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau -e="entropy 1"
npx snarkjs powersoftau beacon pot12_0001.ptau pot12_beacon.ptau 0102…1f20 10
npx snarkjs powersoftau prepare phase2 pot12_beacon.ptau pot12_final.ptau -v

# groth16 setup (4.5s) + verifiers
npx snarkjs groth16 setup credit_policy.r1cs pot12_final.ptau cp_0000.zkey
npx snarkjs zkey beacon cp_0000.zkey cp_final.zkey 0102…1f20 10
npx snarkjs zkey export verificationkey cp_final.zkey verification_key.json
npx snarkjs zkey export solidityverifier cp_final.zkey Verifier.sol
npx snarkjs zkey export soliditycalldata public.json proof.json   # public.json FIRST

# Solana verification test in Docker — no local Rust
docker run --rm -v "$PWD:/work" -w /work rust:1.90-slim cargo run --release
```

### Pinned versions (checked against the live registries today)

| | |
|---|---|
| circom **2.2.3** · snarkjs **0.7.6** · circomlib **2.0.5** | poseidon-lite **0.3.0** (subpath imports) |
| groth16-solana **0.2.0** (field is `vk_gamme_g2`) | anchor-lang **1.1.2** stable (2.0.0-rc.1 is a prerelease) |
| @solana/web3.js **1.98.4** (pin in overrides) | @solana/wallet-adapter-react **0.15.39** |
| viem **2.56.3** · wagmi **3.7.7** | @noble/curves **2.4.0** · @noble/hashes **2.4.0** |
| @ethersphere/bee-js **13.0.0** | solc **0.8.28** (pin — unpinned pulls 0.8.36 and changes gas) |

### .gitignore fixes needed

`dist/`, `build/`, `out/` and **`docs`** are all ignored. Circuit artifacts under `build/` and any `docs/`
submission folder will be silently untracked. Add negations before committing ZK artifacts.
