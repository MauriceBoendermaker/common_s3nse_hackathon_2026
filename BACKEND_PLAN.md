# Private Credit — Backend & Smart Contract Plan

**Target:** turn the current front-end simulation into a functional, privacy-preserving credit protocol
**with all smart contracts on Solana**, in time for Common S3nse.

| | |
|---|---|
| **Written** | 2026-09-03, ~18:40 CEST · revised for Solana-only contracts |
| **Submission deadline** | **Sat 5 Sep 2026, 09:00** (verified on commons3nse.cryptocanal.org: *"Sept 5 - 09:00 Hackathon ends. Final submissions."*) |
| **Wall clock remaining** | ~38 h · **realistically 20–24 workable hours** |
| **Contract chain** | **Solana devnet only.** No contracts are authored or deployed on Ethereum |
| **Bounties targeted** | SuperteamNL/Solana $2,000 · ENS $2,000 · Mobula $2,750 + $2,750 credits |
| **Judging needs** | open repo · demo video/deck · deployed contract addresses · **"functional with no hard-coded demonstrations"** |

---

## 0. The one-paragraph version

The app today is a convincing shell with **zero** substance behind it: one React `useState` shared by both
"parties", three `setTimeout` calls standing in for proving, verification and every transaction, and a
hard-coded `DEMO_WITNESS` constant that every pass/fail badge derives from. That last item alone
disqualifies it from the ENS bounty, which explicitly requires *"functional with no hard-coded
demonstrations"*. The fix is not cosmetic: we need (a) a **real trust boundary** — two processes, not two
render branches; (b) a **real witness** from real portfolio data; (c) a **real Groth16 credential**; and
(d) **ENS carrying a load-bearing privacy function** rather than being a display string. The hardest parts
are already built and verified on this machine (§1), including on-chain Groth16 verification on Solana.

**Recommended shape: Solana holds the money and the verifier; ENS is the private payment directory.**

Every contract we write lives on Solana devnet. Ethereum is used **only through contracts that already
exist** — we register an ENS name, write one text record, and read records back. That needs no deployment,
so it is fully compatible with "Solana-only smart contracts" while keeping the $2,000 ENS bounty in play.

> **Why ENS is not decoration here:** the lender cannot pay the borrower without first resolving the
> borrower's ENS name to derive a fresh, unlinkable **Solana** payout address. Delete ENS and the
> settlement leg stops working. That is the sentence for the slide — and it is a genuinely novel use, since
> ENS is almost always confined to EVM payments.

---

## 1. What is already proven (executed, not researched)

Everything in this table was run on **this machine, today**. Not estimates. This converts the plan's
highest-risk assumptions into settled facts, and the artifacts move straight into the repo.

| # | Claim | Evidence |
|---|---|---|
| 1 | **circom needs no Rust on Windows** | `circom-windows-amd64.exe` v2.2.3 downloaded and run → `circom compiler 2.2.3` |
| 2 | **The real policy circuit compiles** | 221 template instances, **1090 non-linear + 1301 linear constraints** |
| 3 | **Proving is fast** | `groth16.fullProve` → **600 ms**; `groth16.verify` → **18 ms** (Node 22) |
| 4 | **The policy logic actually discriminates** | Passing profile → `eligible = 1`. Policy raised to 500k assets → `eligible = 0`, same `passportCommitment` |
| 5 | **⭐ The proof verifies on Solana** | `groth16-solana` 0.2.0 in Docker: `proof.A NEGATED : VERIFIED` / `proof.A as-is : rejected` / `TAMPERED inputs: correctly rejected` |
| 6 | **Browser proving is viable** | snarkjs 0.7.6 ships `build/browser.esm.js` (537 KB) under the `exports.browser` condition — Vite resolves it automatically. Artifacts: wasm 3.1 MB + zkey **1.13 MB** + vkey 3.8 KB |
| 7 | **Stealth derivation works** | 3 successive disbursements to one identity → 3 unlinkable addresses, each recovered and spendable by the recipient |
| 8 | **ENS infra is live on Sepolia** | Registry `0x0000…2e1e`, PublicResolver `0x8FADE6…B7dD`, ETHRegistrarController `0xFED6a9…5B72`, ERC-6538 Registry `0x6538E6…6538` — all return bytecode. **We deploy none of these; we only call them** |
| 9 | **Names are available** | `privatecredit.eth` / `commons3nse.eth` available on Sepolia @ **0.00313 ETH/yr**. ⚠️ `alice.eth` and `vault.eth` are **taken** |
| 10 | **Solana devnet is live** | `solana-core 4.3.0-beta.3`, SPL Token program present |
| 11 | **Mobula endpoints are real** | `demo-api.mobula.io` serves the whole surface **keyless with `access-control-allow-origin: *`** |

> **Portability bonus, already proven but not deployed:** the same proof also verifies under a
> snarkjs-exported Solidity verifier (compiles under solc 0.8.36, 1845 bytes). We are **not** deploying it —
> but `prototype/zk/Verifier.sol` is worth one line in the README as evidence the credential is
> chain-portable, not Solana-specific. That is a *claim about the credential*, not a second deployment.

### 1.1 The snarkjs → Solana conversion recipe (the crux)

A snarkjs Groth16 proof converts to `groth16-solana` input as:

- **`proof.A` must be negated** — `(x, p − y)`. Non-negated A is rejected. Not optional.
- **G2 coordinates swap**: snarkjs gives `[[x.c0, x.c1], [y.c0, y.c1]]`; Solana wants **c1 before c0**.
- **All values 32-byte big-endian.** Guard the conversion — if a value exceeds 32 bytes, `padStart(64)`
  silently no-ops and corrupts the proof. Throw instead.
- `vk_ic.len()` must equal `nPublic + 1`.

> **Trap, verified:** published `groth16-solana` **0.2.0 ≠ GitHub master.** The published crate has **no
> feature flags**, no `vk::circom` module, no `proof_parser.rs`, and the struct field is misspelled
> **`vk_gamme_g2`**. Writing `vk_gamma_g2` is a compile error. VK generation in the published crate is a
> bundled Node script (`npm run parse-vk`), not a Rust helper. My working test used `vk_gamme_g2` and
> compiled first try; every "generate_vk_file" tutorial you find describes master and will not work.

All of this is committed under **[`prototype/`](./prototype/)** (authored today, inside the event window)
with reproduction commands in [`prototype/README.md`](./prototype/README.md):

```
prototype/zk/circuits/credit_policy.circom   prototype/zk/to_solana.mjs      (the converter)
prototype/zk/prove.mjs                       prototype/solana-verify/        (Rust verification test)
prototype/ens/stealth.mjs, check.mjs         prototype/zk/Verifier.sol       (reference only, not deployed)
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
| "Forward and reverse resolution match", "Controller verified" | static JSX; renders unconditionally | ENS forward + reverse resolution, registry `owner()`, SIWE signature |
| ENS names everywhere (`alice.eth`, `vault.lender.eth`) | display strings; **no ENS call exists in the repo** | ENS must carry a *function* — this is the bounty's explicit disqualifier |
| "Passport commitment `0x91ca…0f42`" | frozen literal, never recomputed, never published | Poseidon commitment over the real witness + blinding salt |
| 3 "passport sources" with Connect/Retry | `toggleSource` pushes a string into an array. Zero network calls | **Mobula adapter** → real balances, debt, account age |
| "Policy fingerprint `0x…`" | `minAssets*17 + maxDebtRatio*101 + …` — invertible over 72 possible policies | `Poseidon(policy params)`, computed identically in circuit, program and client |
| "Generate ZK proof" → receipt | 1400 ms timer; no circuit, no prover, no artifact | snarkjs in a Web Worker |
| Proof ID / circuit / **"Verifier contract · Sepolia"** / valid-until | frozen literals containing Unicode ellipses | real hashes, real timestamps — and the verifier row now says **Solana program ID**, not Sepolia |
| "Verify ZK proof" | re-runs `evaluatePolicy` against `DEMO_WITNESS` | on-chain verification in the Solana program |
| "restricted to vault.lender.eth and policy 0x…" | prose only; nothing binds anything | verifier identity + nonce + expiry as **public inputs** |
| Publish request / fund / accept / draw / repay | `setTimeout` writing a status string | real instructions against the Solana escrow program |
| Network guard: **"Switch to Sepolia"**, header pill "Demo · Sepolia" | `demo.walletNetwork` string literal | Solana cluster guard (devnet) via wallet-adapter |
| 2 competing offers | constants in `config/product.ts:77-94` | real funded offers from distinct lender identities |
| "The repayment event can now update the ENS-anchored reputation commitment" | a sentence; no code anywhere | either implement or delete |
| "Preview source outage" / "Preview proving failure" / "Preview expired proof" / "Load sample request" | operator-pressed demo shortcuts | **delete before submission** — these read as hard-coded demos |

> Note the whole app is currently written around Sepolia as *the* network. Going Solana-only means the
> wallet layer, the network guard, the explorer links and every "Sepolia" string change. That is a real
> sweep through `WalletActionDialog.tsx`, `AppHeader.tsx`, `product.ts` and the content pages — budget for
> it rather than discovering it at hour 20.

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
                    └──────┬───────────────────────────────────────┘
                           │
   ETHEREUM (no deploys)   │                    SOLANA DEVNET (all contracts)
   ┌───────────────────────▼────────┐     ┌──────────────────────────────────┐
   │ ENS name = only public id      │     │ private_credit program           │
   │ text record: X25519 payout key │     │  • groth16 verify  (~105k CU)    │
   │   (written to the EXISTING     │     │  • recompute policyHash on-chain │
   │    PublicResolver)             │     │  • nullifier PDA (replay stop)   │
   │ optional: ERC-6538 registerKeys│     │  • SPL-USDC escrow → payout      │
   └────────────────────────────────┘     │  • draw / repay lifecycle        │
                   ▲                      └──────────────────────────────────┘
                   │                                    ▲
                   └── lender resolves the ENS name ────┘
                       and derives a one-time SOLANA payout address
```

### 3.1 The ENS → Solana payout derivation

This is the mechanism that earns the ENS bounty, and it needs **no Ethereum contract of ours**.

1. **Borrower, once.** Derive an X25519 keypair deterministically from a `personal_sign` of a fixed message
   (no key storage; re-derivable on any device). Publish the public key as an ENS **text record** via
   `setText` on the existing PublicResolver — a custom key such as `privatecredit.payout-key[501]`
   (501 = SLIP-44 Solana).
2. **Lender, per draw.** Resolve the borrower's ENS name → `X`. Pick ephemeral `r`, compute `R = r·G` and
   `ss = X25519(r, X)`, then
   `seed = HKDF-SHA256(ss, salt = requestId, info = "privatecredit/v1/sol-payout")`, and
   `payout = ed25519 Keypair.fromSeed(seed).publicKey` — a **standard Solana address**.
3. **On Solana.** The lender writes `R` (32 B) + a 1-byte view tag into the Loan account and disburses
   SPL-USDC to `payout`.
4. **Borrower.** Scans Loan accounts, recomputes `ss = X25519(x, R)`, obtains the *same* keypair, and sweeps
   normally.

Deriving the whole one-time key from a single ECDH secret sidesteps ed25519 scalar arithmetic entirely
(which standard Solana `Keypair` APIs will not do for you). **Document the trade-off honestly:** because
there is one secret rather than separate spend/view keys, the viewing key can also spend. That is a real
weakening versus full ERC-5564 stealth — it costs key compartmentalisation, not unlinkability.

> **Framing, and this matters for the bounty:** the pending stealth-address ENSIP explicitly states that
> *"non-EVM scoping would be an ERC-5564 extension and is out of scope here."* So **do not** claim standard
> compliance and **do not** reuse ERC-5564 `schemeId 1` (registered for secp256k1) to carry an X25519 key.
> Use a clearly custom record key, cite the RFC, and present this as an early implementation of a direction
> ENS is standardising. An ENS judge is exactly the person who will notice. Honesty here reads as
> competence; overclaiming reads as sloppiness.

### 3.2 Public signal layout (a contract across circuit / Rust / TS)

| idx | signal | purpose |
|---|---|---|
| 0 | `passportCommitment` | Poseidon over the private snapshot + salt |
| 1 | `eligible` | the only bit of underwriting that is disclosed |
| 2 | `policyHash` | Poseidon(minAssets, maxDebtRatio, minHistoryMonths, screenExposure) — **recomputed on-chain** from the stored Policy account, so the client is trusted for nothing |
| 3 | `subjectCommitment` | **`Poseidon(namehash(name), blindingFactor)`** |
| 4 | `expiry` | unix seconds; program checks against the cluster clock |
| 5 | `nullifier` | `Poseidon(salt, policyHash, verifierCommitment)` → seeds the nullifier PDA |

> **Two corrections that are easy to get wrong and fatal to the pitch:**
>
> 1. **Never publish a raw ENS namehash as the subject commitment.** namehash is an unsalted, publicly
>    computable function of the name — a rainbow table over any ENS name list inverts it instantly, so
>    "the name never appears on Solana" would be **false**, and it is submitted as instruction data. It
>    must be salted: `Poseidon(namehash, blind)`. Two independent fact-checks flagged this; it attacks the
>    bounty rationale, not just the code.
> 2. **A namehash may exceed the BN254 scalar field** (~78% do; `alice.eth` does, `vault.lender.eth`
>    doesn't). Reduce mod `r` **identically** in circom, Rust and TS, and write a test asserting it —
>    otherwise verification fails ~1 time in 4 and looks random.
>
> Poseidon domain tags must also be byte-identical across circom and Rust. `Poseidon("privatecredit.v1")`
> is under-specified — Poseidon consumes field elements, not strings. Fix one encoding (e.g.
> `keccak256(tag) mod r`) and implement it the same way in both places, or the on-chain recompute will
> never match and you will lose an hour finding out.

### 3.3 Circuit rules

- **`Num2Bits`/range-check every private amount before it reaches a comparator.** Without it the circuit is
  forgeable by field overflow while still appearing to work. This is soundness, not decoration — do not let
  a late-night "simplification" delete it.
- The `passportCommitment` **must be published before the lender issues its policy challenge.** Otherwise
  the borrower picks whatever numbers satisfy the policy and the proof proves nothing. This is precisely
  the difference between a mechanism and theatre, and precisely what ENS judges will probe.

---

## 4. Workstreams

Ordered by **value per hour**, not architectural elegance.

### A — Real trust boundary + marketplace backend · ~3 h · prerequisite for everything

Split the single `useState` into two clients talking over an explicit channel.

- Backend store: in-memory `Map` + monotonic `version`. Both browsers poll `GET /api/state?since=<version>`.
  ~80 lines, no dependencies, works through every proxy.
- Endpoints: `POST /api/requests`, `/api/challenges`, `/api/proofs`, `/api/offers`, `GET /api/state`,
  `GET /api/passport/:address`.
- The lender bundle must become **structurally incapable** of reading the witness — separate route,
  separate session, no shared object.

> Traps: `app.get('*')` **throws on Express 5** — use `app.get('/{*splat}')`. Insert an
> `app.use('/api', …404)` *before* the SPA fallback or typo'd endpoints silently return `index.html` with
> HTTP 200. Never use a TS `enum` in the backend — `node --watch src/index.ts` dies with
> `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; mirror the frontend's string-union style.

### B — Mobula witness adapter · ~5 h · kills the disqualifier, wins bounty #3

Highest value per hour in this plan: **zero blockchain risk, pure Node 22 `fetch`**, and it removes the
`DEMO_WITNESS` constant that would otherwise sink the ENS bounty too.

`backend/src/adapters/mobula.ts` → `buildWitness(evmAddress, solAddress?)`, behind
`GET /api/passport/:address`. Default `MOBULA_BASE=https://demo-api.mobula.io` (**keyless**, works
immediately); `MOBULA_API_KEY` + `https://api.mobula.io` as an env-only upgrade. The key stays server-side —
exactly what the security page already promises.

Mobula covers **both** ecosystems, so a passport can span the borrower's EVM *and* Solana holdings via
`wallets=<evm>,<sol>` — which fits a Solana-settled loan nicely.

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
> **429s at ~10 rapid calls** with ~10 s recovery and is shared with every other hacker at the event, so
> get a free key from admin.mobula.io tonight as insurance. Aave V3 aTokens are inconsistently present in
> `/portfolio`, so you need **both** the `totalDepositedUSD` addition **and** a case-insensitive de-dup
> guard. Mobula prices testnets at **0** — read the passport from **mainnet** and say so in the UI.

### C — ZK credential pipeline · ~4 h · already 70% done (§1)

`zk/` as a third npm workspace: `getcircom.mjs` → `circuits/credit_policy.circom` → `build.mjs` → copies
`wasm`/`zkey`/`vkey` into `frontend/public/zk/`, and emits `vk_data.rs` for the Solana program.

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
- **One build step, two outputs.** Regenerating the zkey changes the verifying key, so the browser artifacts
  and the program's `VK_*` constants must always be regenerated together — otherwise every proof fails
  on-chain with no useful error.

### D — ENS privacy mechanism · ~4 h · wins bounty #1 · **no contract deployment**

Cheaper than the EVM-settled version, because there is nothing to deploy and no announcement log to scan.

1. Register `privatecredit.eth` on Sepolia (verified available @ 0.00313 ETH/yr) — a call to the **existing**
   ETHRegistrarController. *Or* use a mainnet name you already own and skip registration entirely.
2. Derive the X25519 payout keypair from a `personal_sign` (§3.1).
3. `setText` the payout key on the **existing** PublicResolver. Optionally also `registerKeys()` on the
   **existing** ERC-6538 registry for a second citable on-chain artifact.
4. Lender resolves the name and derives the one-time Solana address (§3.1) — a pure client-side computation
   with `@noble/curves`.
5. Borrower scans Loan accounts via `getProgramAccounts`, filters by view tag, derives and sweeps.

Use plain `viem` + `@noble/curves@2.4.0`; working reference in
[`prototype/ens/stealth.mjs`](./prototype/ens/stealth.mjs). Do **not** install
`@scopelift/stealth-address-sdk` (`1.0.0-beta.5`) — read its source instead.

> **Traps:** A freshly derived Solana payout address holds no SOL, so the borrower cannot sweep — the
> funding instruction must also transfer **~0.002 SOL** for rent + fees, plus ATA rent. Budget it; this is
> the most likely thing to dead-end the live demo at "funds arrived, cannot move them". The ENS manager app
> **will not display a custom text key**, so verify with a direct `text()` call and show *that*. Prove a
> `setText` → `getEnsText` round-trip **in the first hour** — a fact-check could not obtain a positive
> control for Sepolia text reads, so treat it as unproven until you see it work.
>
> **Do not start:** `ensdomains/offchain-resolver` (dead since 2024), ENSv2 `UserRegistry`/`VerifiableFactory`
> subname issuance (ENS's own docs stamp them "not yet final"), Durin/L2 subnames, Unruggable Gateways,
> NameStone/Namespace (you'd be *configuring*, not building). A CCIP-Read wildcard resolver is genuinely
> impressive and is where your entire remaining budget disappears if anything misbehaves.
>
> **Precedent:** Fluidkey shipped ENS+stealth at ETHRome 2023 and runs it in production. A judge may know
> this. Differentiate on two axes: (1) **cross-ecosystem** — ENS resolving to rotating *Solana* addresses is
> not the well-trodden path; (2) **policy-bound** — each draw under a ZK-verified underwriting policy lands
> at a fresh address. Lead with those, not with "we implemented stealth addresses."

### E — Solana program · ~9 h · the only contract work · **start the funding step first**

One Anchor program, `private_credit`, built via the **`solanafoundation/anchor:v1.0.2` Docker image** — do
not install Rust natively, do not use WSL. (I compiled `groth16-solana` in Docker in **40 s**.)

Accounts: `Policy`, `Request`, `Offer`, `Loan`, `Nullifier` (PDA), `ProgramConfig` (holds `VK_HASH`).

Instructions:

| Instruction | Does |
|---|---|
| `publish_policy` | lender stores the policy preimage; `policyHash` derived on-chain |
| `publish_request` | borrower posts amount / term / deposit / `passportCommitment` |
| `present_and_fund` | **the core one** — see below |
| `draw` / `repay` | lifecycle; interest accrues from the cluster clock |

`present_and_fund`:
1. `groth16-solana` verify — budget **~105k CU** for 6 public inputs (not the 95k the README implies; the
   benchmark table interpolates to ~105k). Set the CU limit to 400k.
2. Recompute `policyHash` on-chain via `solana-poseidon` from the **stored** Policy account and require
   equality with signal [2]. The client is trusted for nothing.
3. `init` a **nullifier PDA** seeded by signal [5] → a second presentation fails at the runtime level with
   "account already in use". This is the unfakeable "Present again" demo moment.
4. SPL-USDC transfer from escrow to the one-time payout address, **plus ~0.002 SOL** so the borrower can
   actually sweep.

> **⚠️ Devnet funding is now the single biggest risk in the whole plan, because Solana-only removes the
> fallback chain.** A probe from this network returned a `requestAirdrop` signature that reached
> **`finalized` with `err: null` while the balance stayed 0** — the transaction was a bare Memo from the
> faucet with the target not even in `accountKeys` — and the next request 429'd. A deployed program address
> is an explicit judging deliverable.
>
> **Get SOL before writing any Solana code, and verify the balance actually landed rather than trusting the
> RPC response.** Options in order: GitHub-authenticated faucet.solana.com → a Discord faucet → **Solana
> testnet instead of devnet** (different faucet, still a public cluster that satisfies "a testnet of your
> choice") → a teammate's funded keypair. Deploy costs ~**0.63 SOL** (not 1.25 — the 2× upgrade reserve is
> legacy behaviour). Keep `solana-test-validator` for local iteration so development never blocks on
> faucets, but note a local validator does **not** satisfy the deployed-address requirement.
>
> Other traps: `anchor test` **fails in that image** (Anchor 1.0 defaults to the Surfpool validator, absent
> from the image) — use `cargo test` with LiteSVM, or `anchor test --validator legacy`. `anchor init`
> defaults to `-t multiple`; pass **`-t single`**. Add `vite-plugin-node-polyfills` with `Buffer: true` or
> wallet-adapter breaks under Vite 7. Pin `@solana/web3.js@1.98.4` in root `overrides` — wallet-adapter
> takes it as a *peer* dep while Anchor takes it as a *regular* dep, and two copies produce baffling
> `PublicKey instanceof` failures. Stay on `@coral-xyz/anchor@0.32.1` + `anchor-lang` 0.32.1, or Anchor
> 1.1.2 with a Codama client — do **not** mix generations.
>
> **Byte-conversion bugs are silent.** Every failure mode — wrong Fp2 limb order, forgotten negation,
> little-endian creeping in, an unreduced public signal — produces exactly one symptom: "proof invalid".
> Get `cargo test` green against your own fixtures **before** touching devnet.
> [`prototype/solana-verify/`](./prototype/solana-verify/) already does exactly this.

### F — Storage & hosting · ~3 h

- **Tier 0 — never persisted:** raw portfolio + witness. Browser memory only.
- **Tier 1 — backend:** requests, challenges, receipts, offers, lifecycle. Deliberately public; zero
  portfolio data.
- **Tier 2 — Swarm, ciphertext only:** passport envelope, AES-GCM-256, key generated in the browser via
  WebCrypto, **key never sent to the backend**, released to one chosen lender at accept time. Put the
  *reference* in an ENS text record, never the key. Line for the demo: *"Swarm has no delete. That is
  exactly why only ciphertext goes there."*
- **Tier 3 — Swarm, public:** signed proof receipts.

> Swarm verdict: **~90 minutes, gateway-only.** Do not run a Bee node. Swarm has **no bounty** at this event
> — justify it as partner goodwill and privacy-story reinforcement only, and cut it first if time is tight.
> Use `bee.file.upload`, **not** `bee.data.upload`: refs from `POST /bytes` return **404 on `/bzz/<ref>`**.
> Wrap every call in try/catch and keep your own copy — the public gateway accepted a completely random
> postage batch id with HTTP 201.

**Hosting:** one Render free web service serving both API and built SPA (one origin, no CORS, one URL for
TAIKAI). Pin `NODE_VERSION: 22.22.3` — **Render's current default is Node 24**. Add a cron-job.org ping to
`/health` every 10 min or the first judge hits a ~1-minute cold start. Render's free filesystem is **wiped
on restart, redeploy and spin-down**, so SQLite buys nothing there. If you keep ngrok as the conference-wifi
fallback, note it is capped at **20,000 requests/month** — a 1.5 s two-tab poll burns 4,800/hour — and it
shows an interstitial judges must click through.

**Do the first green deploy at hour 2 with a stub.** A deployed stub beats a perfect app never deployed.

---

## 5. Bounty alignment

| Bounty | Requirement | Satisfied by | Confidence |
|---|---|---|---|
| **Solana $2,000** | build on Solana | On-chain Groth16 verification, nullifier PDA, SPL escrow, full loan lifecycle — **every contract in the project** | High on design; **gated on devnet funding** |
| **ENS $2,000** | ENS beyond name display | ENS text record is the **only** input to deriving the Solana payout address | High — but only with D shipped |
| | actual privacy mechanism | Rotating one-time payout addresses (verified working, §1 #7) | High |
| | protected from whom, stated | Portfolio hidden from lender; payout addresses + credit graph hidden from all chain observers | High, **if** §3.2 salting is applied |
| | no hard-coded demos | Workstream B removes `DEMO_WITNESS`; delete all four "Preview…" buttons | **Currently failing** |
| **Mobula $2,750** | real data integration | Multi-endpoint witness adapter spanning EVM **and** Solana holdings, server-side key, `sourceUrls` surfaced in UI | High — lowest risk of the three |

Surfacing the Mobula `sourceUrls` + `fetchedAt` next to the passport kills the "hard-coded demo" objection
for **both** the ENS and Mobula judges in one stroke.

**Note:** the SuperteamNL rubric could not be retrieved — TAIKAI's prizes page returns nothing to an
unauthenticated fetch. Log in and read it; it is now your primary bounty.

---

## 6. Build order and go/no-go gates

A, B, C and D share almost no surface area — parallelise them.

| Hours | Work | Gate |
|---|---|---|
| **0–1** | **Get devnet SOL first.** Register the ENS name + prove a `setText`/`getText` round-trip. Green Render deploy with a stub. | 💰 **SOL confirmed landed?** If not, escalate faucets immediately — there is no second chain |
| 0–3 | **A**: backend store, REST, polling, two separate clients | |
| 1–5 | **B**: Mobula adapter → real witness replaces `DEMO_WITNESS` | ✅ Ship this even if all else slips |
| 3–7 | **C**: circuit → local ptau → browser proving in a worker → `vk_data.rs` | |
| 7–9 | Byte-conversion + `cargo test` green against own fixtures | 🚦 **Do not deploy before this is green** |
| 5–9 | **D**: ENS payout derivation end-to-end | |
| 9–18 | **E**: Solana program → devnet; wallet-adapter + Sepolia→Solana UI sweep | **Hour 18: deployed?** If not, drop to the fallback below |
| 18–20 | **F**: hosting, Swarm (cut first if tight), Credential Passport strip | |
| 20–23 | Delete demo shortcuts, rewrite stale copy (§7), README, video | ⚠️ Reserve 3 h — not optional polish |

**Fallback ladder — decide at hours 1, 9 and 18, never at hour 22.** Solana-only removes the "ship the EVM
half instead" escape hatch that previously existed, so the ladder now degrades *within* Solana:

1. **Devnet faucet blocked** → switch cluster to **testnet**, or fund from any wallet that has SOL. Do not
   spend more than an hour here before escalating.
2. **Program won't deploy in time** → verify the proof **off-chain in the backend** with `snarkjs.verify`
   and keep the escrow logic as a `solana-test-validator` demo. You lose the "deployed contract address"
   deliverable — say so plainly rather than implying otherwise.
3. **Everything slips** → **A + B + C alone** (real trust boundary, real data, real proof) is still a
   dramatically better submission than today's simulation, and still qualifies for Mobula.

**Honest total:** the workstreams sum to ~28 h against 20–24 available. Something must go. Cut in this
order: Swarm → the Credential Passport polish → `draw`/`repay` on-chain (demo funding and repayment only)
→ Solana-side sweep UI.

---

## 7. Copy that becomes false — must be rewritten

The marketing/security/legal copy is currently **honest** ("everything is simulated"). The risk is that it
goes **stale** the moment a backend exists, and judges read these pages.

| Page | Line | Action |
|---|---|---|
| SecurityPage | "Production contracts: None", "Real funds: Disabled" | Update to the deployed Solana program ID |
| SecurityPage | "Application state lives in the current browser session… no production persistence layer" | Now false — replace with the Tier 0–3 model from §F |
| SecurityPage | Trust model lists 4 assumptions | **Add a fifth: our own backend/prover operator** — what it can see, what it could forge, that it is a single unaudited operator. A trust model that omits the author's own server reads as naïve |
| HowItWorks | "No proof or funds move onchain" prototype banner | Now false |
| HowItWorks | "Witness construction and policy evaluation" listed as Local/private | **Only stays true if proving is in the browser.** Server-side proving makes it false |
| HowItWorks | "Onchain: ENS identity and resolver records / verifier and settlement contracts" | Split correctly: ENS records on Ethereum (**existing** contracts), verifier + settlement **on Solana** |
| Everywhere | "Sepolia", "USDC on Sepolia", "Switch to Sepolia", verifier-contract row | Solana devnet, SPL-USDC, cluster guard, program ID |
| AudiencePages | ENS listed as "Shared" while portfolio is "Hidden" | Self-contradictory today; coherent once rotating payout addresses land |
| PrivacyBoundary | two hard-coded lists | Generate the disclosed set **programmatically** from the actual public signals |

Also delete: "Preview source outage", "Preview proving failure", "Preview expired proof", "Load a policy
that fails this demo profile", and "Load sample request" — or make the last seed a *real* account.

---

## 8. Honest trust assumptions (put these on a slide)

1. **Trusted setup.** A hackathon phase-2 means whoever ran it could forge proofs. ≥2 contributions,
   published transcript, stated plainly.
2. **Data honesty.** The proof shows the policy holds over data from Mobula. We prove honest *computation*,
   not honest *data*. Naming this earns credit.
3. **ENS resolution.** The Solana program cannot read ENS; it accepts the payout address the lender's client
   supplies. The payer is the party incentivised to resolve correctly, and the borrower detects
   misdirection immediately (no funds arrive). This is the softest edge in the design — name it first.
4. **One-time key compartmentalisation.** Deriving the payout key from a single ECDH secret means the
   viewing key can also spend (§3.1). Unlinkability is unaffected; compartmentalisation is.
5. **Gateway metadata.** Whoever operates the backend sees request timing and IPs even when it never sees
   plaintext.
6. **`groth16-solana` is unaudited** at 0.2.0 (only 0.0.1 was covered by the Light Protocol v3 audit). Say
   "widely used, 128k downloads, unaudited" — do **not** tell judges it is audited.

---

## 9. Open decisions

1. **Is Mobula in scope?** You named ENS and Solana. Mobula is worth **more than either** ($2,750 + $2,750
   credits), needs **no blockchain work**, and removes the hard-coded-witness disqualifier.
   **Recommendation: yes, and do it first.**
2. ~~Which chain settles the loan?~~ **Settled: Solana.** ENS derives the payout address (§3.1).
3. **Browser proving or server proving?** Browser keeps "the witness never leaves the device" true and is
   verified viable (§1 #6). Server proving is simpler but **makes the security page false**.
   **Recommendation: browser.**
4. **Sepolia name or mainnet name?** A Sepolia name is ~free but judges who resolve it on mainnet see
   nothing. ~$8 for a mainnet name with the same text record is the cheapest credibility purchase
   available — and since we deploy nothing on Ethereum, mainnet costs only the registration.
5. **Does anything still need Sepolia ETH?** Only ENS registration + `setText` (~0.004 ETH total). If you
   use a mainnet name you already own, the Sepolia dependency disappears entirely.

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

# groth16 setup (4.5s) + verifying key
npx snarkjs groth16 setup credit_policy.r1cs pot12_final.ptau cp_0000.zkey
npx snarkjs zkey beacon cp_0000.zkey cp_final.zkey 0102…1f20 10
npx snarkjs zkey export verificationkey cp_final.zkey verification_key.json
node to_solana.mjs        # -> vk_data.rs for the Anchor program

# Solana verification test in Docker — no local Rust
docker run --rm -v "$PWD:/work" -w /work rust:1.90-slim cargo run --release

# Anchor build/deploy in Docker — no local Rust, no WSL
docker run --rm -v "$PWD:/work" -w /work solanafoundation/anchor:v1.0.2 \
  sh -c "anchor build && anchor deploy --provider.cluster devnet"
```

### Pinned versions (checked against the live registries today)

| | |
|---|---|
| circom **2.2.3** · snarkjs **0.7.6** · circomlib **2.0.5** | poseidon-lite **0.3.0** (subpath imports) |
| groth16-solana **0.2.0** (field is `vk_gamme_g2`) | anchor-lang **0.32.1** (or 1.1.2 — do not mix) |
| @solana/web3.js **1.98.4** (pin in overrides) | @solana/wallet-adapter-react **0.15.39** |
| @coral-xyz/anchor **0.32.1** · @solana/spl-token **0.4.15** | viem **2.56.3** (ENS reads/writes only) |
| @noble/curves **2.4.0** · @noble/hashes **2.4.0** | @ethersphere/bee-js **13.0.0** |

### .gitignore fixes needed

`dist/`, `build/`, `out/`, **`target/`** and **`docs`** are all ignored or will be. Circuit artifacts under
`build/`, the Anchor `target/deploy/*.json` program keypair, and any `docs/` submission folder will be
silently untracked. Add negations before committing — **losing the program keypair means losing the ability
to upgrade the deployed program.**
