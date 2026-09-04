# Private Credit

A privacy-preserving credit protocol. An applicant proves a real Solana portfolio satisfies a
lender's underwriting policy — **without** revealing the portfolio, the wallet address, or any
of the four numbers the policy is written over — and gets paid to a fresh Solana address derived
from an ENS name, so two loans to the same person are not linkable on chain.

Built for the Common S3nse hackathon 2026. **Read the [Honest limitations](#honest-limitations)
section before you evaluate any claim in this README.** It is not an appendix; it is the part
that decides whether the rest is worth reading.

---

## What is actually real

| | |
|---|---|
| The portfolio | Live **Solana mainnet** RPC + Jupiter pricing. Keyless — no vendor account. There is no `DEMO_WITNESS` constant anywhere in this repo, by construction. |
| The proof | A real **Groth16 BN254** proof of `zk/circuits/credit_policy.circom` (1 390 non-linear + 1 590 linear constraints), produced in the applicant's browser by a Web Worker in ~550 ms, verified server-side by `snarkjs.groth16.verify` in ~11 ms. |
| The verification | Eight bindings the server **re-derives** from state it already held. The client is trusted for nothing: `policyHash` and `verifierCommitment` are recomputed from the stored policy and the calling lender's own session, never read from a request body. |
| The replay guard | `nullifier = Poseidon(salt, policyHash, verifierCommitment)`, spendable exactly once. In-memory here; the same value and semantics a nullifier PDA would carry on chain. |
| The payout | ERC-5564-*style* stealth derivation over X25519, producing a fresh **Solana ed25519** address per draw, recoverable only by the holder of the viewing key. Read live from a Sepolia ENS text record. |
| The ENS reads | Live Sepolia: `owner`, `resolver`, `addr`, `text(node, key)` against the deployed ENS registry and PublicResolver. `npm run ens:probe` obtains a positive control by finding somebody else's custom dotted text record on chain and reading it back. |

## What is **not** real

- **Nothing is deployed on Solana.** On-chain Groth16 verification is *proven to work* in a
  local Rust test (`prototype/solana-verify/`: `proof.A NEGATED : VERIFIED` /
  `proof.A as-is : rejected` / `TAMPERED inputs: correctly rejected`). That is a claim about the
  credential being **chain-portable**, not a claim about a deployment. There is no program id.
- **The trusted setup is a development ceremony.** See below.
- **No ENS name is registered.** Registering `privatecredit.eth` needs funded Sepolia ETH.
  `scripts/ens-setup.mjs` is staged and its exact register+setText payload has been verified
  against the deployed controller's `makeCommitment`, but the commit→register transaction pair
  has never been executed.
- The marketplace store is **in memory**. Restarting the backend clears it.

---

## Run it

```bash
npm install
npm run zk:build      # ~40 s: compiles the circuit, runs the dev ceremony, emits every artifact
npm run build         # type-check + build the SPA and the backend
npm run dev           # frontend on :5173 (proxying /api), backend on :3001
```

Open two tabs — one applicant, one lender. Sessions are per-tab (`sessionStorage`), so the two
tabs really are two parties.

> **Order matters.** `zk/build.mjs` writes the browser's proving key into `frontend/public/zk/`,
> and `vite build` copies that into `frontend/dist/`. Running `zk:build` *after* `build` leaves
> the served SPA on an older ceremony and every proof fails with an unhelpful pairing error. The
> backend hashes the served copy at boot and prints a `STALE BUILT SPA` banner if this happened;
> `GET /api/health` reports it as `verifier.servedArtifactsAgree`. Re-run `npm run build`.

## Verify it yourself

Every one of these is a command, not a screenshot.

```bash
node zk/build.mjs         # rebuild from scratch; asserts the public-signal layout
                          # against the COMPILED .r1cs/.sym, not against a comment
npm run zk:test           # 35 checks incl. every negative case: tampered signals,
                          # cross-policy, cross-lender, mangled proof points,
                          # and two inputs that are UNPROVABLE because of range checks
npm run e2e:curl          # the whole two-party flow over HTTP with curl and a real proof:
                          # live mainnet read -> commitment -> policy -> Groth16 proof ->
                          # 8-check verification -> offer -> loan -> repaid, plus the
                          # tampered / cross-policy / ineligible / replay / legacy refusals
npm run ens:selftest      # 20 checks: three draws, three different Solana addresses,
                          # all three recovered, each recovered key really controls its address
npm run ens:probe         # live Sepolia reads; obtains a positive control
npm run zk:fixtures && \
node backend/src/protocol/verifier.ts   # the server-side verifier's own 7 self-tests
node backend/src/protocol/store.ts      # the store's own self-test, incl. the trust boundary
curl localhost:3001/api/health          # circuit, verifying-key hashes, ceremony note
```

The strongest single check is the last-but-one line of `e2e:curl`: `GET /api/state` for a
**lender** session, grepped for `collateralQuality`, `historyMonths`, `restrictedExposure`,
`holdings`, `passportSalt`, `blindingFactor`. It returns nothing, because the backend has no
field that could hold one of those values — `routes/api.ts` imports no witness module at all.

---

## Honest limitations

Read this section as if you were trying to break the demo. That is how it was written.

### 1. The trusted setup is a development ceremony. Whoever ran it could forge proofs.

`zk/build.mjs` runs the whole setup — powers of tau, two phase-2 contributions, a beacon — in
**one process, on one machine, by one person**. The contributions drew fresh
`crypto.randomBytes(32)` each and the entropy was never written to disk, which is good hygiene
and is **not a security argument**: you have only the script's word for it, and the script wrote
the transcript.

**The practical consequence: anyone who retained the toxic waste from that run can produce a
proof of a false statement — an "eligible" credential for a portfolio that does not satisfy the
policy — and it would verify against this key, in the browser and on Solana alike.**

Treat every proof here as a demonstration of the mechanism, not as a security guarantee. Do not
put value behind it. A production deployment must re-run phase 2 as a real multi-party ceremony
on top of Perpetual Powers of Tau. The full transcript, with per-artifact sha256 and timings, is
in [`zk/build/ceremony-transcript.md`](zk/build/ceremony-transcript.md), and the UI says all of
this on screen — it is not buried in a file.

### 2. `groth16-solana` 0.2.0 is unaudited

The on-chain verifier crate the Solana path targets is **widely used but unaudited**. Only
version 0.0.1 was in scope for the Light Protocol v3 audit; 0.2.0 was not. It is also the reason
`zk/build/vk_data.rs` carries a comment about the crate's misspelled `vk_gamme_g2` struct field.

### 3. The ENS payout scheme is not standard-compliant, and does not claim to be

The pending stealth-address ENSIP explicitly scopes non-EVM chains **out**. This is therefore an
early implementation of a direction ENS is standardising, not an implementation of a standard:

- It uses a **clearly custom record key**, `privatecredit.payout-key[501]` (501 is the SLIP-44
  coin type for Solana), with its own `pcv1:sol:x25519:` value prefix.
- It deliberately does **not** reuse ERC-5564 `schemeId 1`, which is registered for secp256k1
  and must not be made to carry an X25519 key. An ERC-5564 `st:eth:` meta-address is *rejected*
  by the decoder, and `ens:selftest` asserts that.
- Key agreement is X25519 per [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748) (with the §5
  clamp), key derivation is HKDF-SHA256 per [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869),
  and the payout key is ed25519 per [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

### 4. The viewing key can also spend

The payout private key is derived from a **single** ECDH shared secret, so whoever can *scan*
for payments can also *spend* them. Full ERC-5564 separates the two. What this costs is **key
compartmentalisation**; what it does *not* cost is unlinkability — the addresses are still
unlinkable to everyone else, which is the property the product claims. It is a real weakening
and it is documented at the top of `frontend/src/shared/ensPayout.ts` as well as here.

Related: the view tag is an **optimisation, not a security boundary**. `ens:selftest` check 18
disables the tag filter and shows a stranger still derives a different address.

### 5. A real mainnet wallet is often *not* eligible, on purpose

`historyMonths` is `null` when the bounded signature scan (10 pages × 1 000) cannot reach the
account's first transaction. That fails the history check **closed** — "cannot establish" never
silently becomes "old enough" — so a high-activity wallet can never be eligible under any
positive `minimumHistoryMonths`. That is the honest encoding, not a bug, and it means the demo
needs either a lower-activity wallet or a policy calibrated to the real portfolio.
`scripts/e2e-curl.sh` documents the wallet it uses and why.

### 6. Everything else

- `payoutKeySource: "local-demo"` exists only because no ENS name is registered yet. The lender
  **always** reads ENS first and only falls back; the backend refuses `payoutKey` together with
  `payoutKeySource: "ens-text-record"` so a client cannot claim an on-chain source for a key it
  shipped in a request body. In production the field does not exist: the lender resolves the
  name or cannot pay.
- Balances are read from **mainnet**; settlement (unbuilt) targets **devnet**. Both cluster names
  ride on every `provenance` object so the UI has to say it out loud.
- `viem` is ~401 kB in a chunk shared by both lazy views. It is not in the entry bundle, but
  loading either workspace pulls it.

---

## Layout

```
backend/src/protocol/    types.ts (the wire contract) · hashing · policy · store · verifier
backend/src/adapters/    keyless Solana RPC + Jupiter pricing — the only witness source
backend/src/routes/      api.ts (lender-safe by construction) · passport.ts (the only door)
frontend/src/borrower/   witness, prover worker, ENS identity — never imported by the lender
frontend/src/lender/     policy, verification checklist, payout derivation
frontend/src/shared/     apiClient, session, policy mirror, ENS payout math, generated layout
zk/                      circuit, dev ceremony, artifact export, 35-check negative test suite
prototype/               recovered prior art: the working Rust on-chain verification test
scripts/                 sync:types, the curl end-to-end run, the ENS probe/selftest/setup
```

`backend/src/protocol/types.ts` is the single source of truth for the wire contract;
`npm run sync:types` mirrors it to `frontend/src/shared/protocol-types.ts`. Edit the backend
copy only. `zk/build.mjs` re-derives the public-signal order from the compiled circuit and
**fails the build** if it stops matching that file.

## License

MIT (`SPDX-License-Identifier: MIT`).
