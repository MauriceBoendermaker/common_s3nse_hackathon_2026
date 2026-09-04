# `zk/` — the Groth16 credential

The third npm workspace. It compiles one circom circuit, runs a **development**
trusted setup, and emits the artifacts two very different consumers need: the
borrower's browser and (later) a Solana program.

Nothing in here talks to a network at run time. The only network call in the
whole workspace is the circom download in `getcircom.mjs`, and on this machine
even that is skipped in favour of a locally verified binary.

---

## Read this before you believe any proof this produces

**The trusted setup is a development ceremony. Whoever ran it could forge
proofs.**

Groth16 needs a per-circuit trusted setup. `build.mjs` runs one: two phase-1
contributions, a beacon, `prepare phase2`, then **two independent phase-2
contributions** with fresh 32-byte entropy each, then a final `zkey beacon`,
then `snarkjs zkey verify`. Every one of those steps ran **in a single process,
on a single machine, under a single person**. That is not a multi-party
ceremony; it is one party pretending to be several.

The practical consequence: the toxic waste passed through one process. Anyone
who retained it can produce a proof of a false statement — an "eligible"
credential for a portfolio that does not satisfy the policy — and that forged
proof verifies against this verification key, in the browser and on Solana
alike. The entropy was never written to disk and the run ends with a beacon,
which is correct hygiene, but hygiene is not a security argument when you have
only the script's word for it.

The beacon itself is a **hardcoded constant** in `build.mjs`, not a value drawn
from a public randomness source after the last contribution. It buys
reproducibility, not unpredictability.

Full disclosure, with per-step hashes and timestamps:
**[`build/ceremony-transcript.md`](./build/ceremony-transcript.md)**.

A production deployment must re-run phase 2 as a real multi-party ceremony over
a real phase-1 transcript (Perpetual Powers of Tau), and re-issue **both** the
browser artifacts and the Solana program's `VK_*` constants from it.

Related honesty note that belongs in the same breath: `groth16-solana` **0.2.0
is unaudited**. Only 0.0.1 was covered by the Light Protocol v3 audit. It is
widely used. It is not audited.

---

## Reproduce

```bash
npm install             # from the repo root — links the zk workspace
node zk/getcircom.mjs   # circom 2.2.3 -> zk/bin/
node zk/build.mjs       # compile + ceremony + artifacts   (~33 s)
node zk/prove.mjs       # one proof, with timings
node zk/verify-test.mjs # the negative tests
```

Or, from the root: `npm run zk:circom && npm run zk:build && npm run zk:prove
&& npm run zk:test`.

`build.mjs` deletes and recreates `zk/build/` every run. Artifact hashes differ
between runs — fresh entropy means a fresh zkey — but the **circuit** is
deterministic and the derived public-signal layout must be identical every
time.

---

## Measured on the build machine (Node v22.22.3, Windows 11)

### Circuit

| | |
|---|---|
| circom | 2.2.3 |
| template instances | 300 |
| **non-linear constraints** | **1 390** |
| **linear constraints** | **1 590** |
| total constraints (r1cs) | 2 980 |
| wires | 2 978 |
| labels | 4 538 |
| public outputs / public inputs / private inputs | 2 / 5 / 11 |
| powers of tau | 2^12 = 4 096 |

The old `credit_policy` prototype was 221 instances / 1 090 + 1 301. The growth
is the `Num2Bits` range checks, the two `<= 100` clamps and the added
`Poseidon(2)` subject commitment — i.e. it is all soundness and all contract.

### Timings

| step | wall clock |
|---|---|
| circom compile | 2.1 s |
| ptau new (2^12) | 0.6 s |
| ptau contribute ×2 | 1.6 s + 1.9 s |
| ptau beacon | 1.6 s |
| **ptau prepare phase2** | **15.4 s** |
| ptau verify | 1.5 s |
| groth16 setup | 2.1 s |
| zkey contribute ×2 | 0.7 s + 0.7 s |
| zkey beacon | 0.7 s |
| zkey verify | 2.1 s |
| export vkey | 0.5 s |
| **whole build** | **32.6 s** |
| **`groth16.fullProve`** | **~560–600 ms** |
| **`groth16.verify`** | **~11–15 ms** |

### Artifacts

| file | size |
|---|---|
| `frontend/public/zk/credit_policy.wasm` | 3.30 MB |
| `frontend/public/zk/credit_policy.zkey` | 1.29 MB |
| `frontend/public/zk/verification_key.json` | 3.9 KB |
| `frontend/public/zk/signal_layout.json` | 0.9 KB |
| `frontend/src/shared/signalLayout.ts` (generated) | 3.0 KB |
| `zk/build/vk_data.rs` (Solana `VK_*`) | 6.2 KB |
| `zk/build/ceremony-transcript.md` | 6.8 KB |
| `zk/build/credit_policy.r1cs` | 413.8 KB |
| `zk/build/pot12_final.ptau` | 4.50 MB |

Browser cost per proof: a 3.3 MB wasm and a 1.29 MB zkey, fetched once and
cached, then ~600 ms of proving.

---

## Who consumes these artifacts

| consumer | reads | entry point |
|---|---|---|
| the applicant's browser | `frontend/public/zk/credit_policy.{wasm,zkey}` | `frontend/src/borrower/proverWorker.ts` — one Web Worker, created at workspace mount, artifacts fetched once and reused |
| the backend verifier | `zk/build/verification_key.json` + `zk/build/signal_layout.json` | `backend/src/protocol/verifier.ts` — loads at boot, **fails closed** if either file is missing or if the browser's copy of the verifying key does not hash identically |
| a future Solana program | `zk/build/vk_data.rs` | workstream E, not written |

The backend hashes both copies of the verifying key at startup and refuses to
report `ready` when they differ, because a stale zkey produces proofs that are
perfectly well formed and verify against nothing — the single most confusing
failure mode in this workstream. `GET /api/health` publishes both hashes so the
running server can be tied to the committed artifact without trusting the UI.

Regenerate the backend's test fixtures after any rebuild:

```
npm run zk:fixtures                     # two honest proofs, two policies, ~1s
node backend/src/protocol/verifier.ts   # valid verifies, tampered rejected, cross-policy rejected
```

---

## ONE BUILD STEP, TWO OUTPUTS

> **Regenerating the zkey changes the verifying key, so the browser artifacts
> and the Solana program's `VK_*` constants MUST always be regenerated
> together — otherwise every proof fails on-chain with no useful error.**

That is why `build.mjs` writes `frontend/public/zk/*` **and** `build/vk_data.rs`
in the same run, and why neither has a standalone script. If you ever find
yourself regenerating one of them alone, stop.

---

## The public signal contract

Seven public signals, in wire order:

| idx | signal | kind | meaning |
|---|---|---|---|
| 0 | `passportCommitment` | output | `Poseidon5(assets, collateralQuality, historyMonths, restrictedExposure, salt)` — published with the credit request, **before** any policy challenge |
| 1 | `eligible` | output | the one bit of underwriting that is disclosed |
| 2 | `policyHash` | input | `Poseidon4(minAssets, minCollateralQuality, minHistoryMonths, screenExposure)` |
| 3 | `subjectCommitment` | input | `Poseidon2(utf8ToField(subjectId), blindingFactor)` — **salted**, never a raw namehash |
| 4 | `expiry` | input | unix seconds |
| 5 | `nullifier` | input | `Poseidon3(salt, policyHash, verifierCommitment)` — the replay guard |
| 6 | `verifierCommitment` | input | `Poseidon2(utf8ToField(lenderLabel), utf8ToField(lenderSessionId))` |

This same list appears in four places: the circuit header,
`backend/src/protocol/types.ts` (`PublicSignals`), the generated
`frontend/src/shared/signalLayout.ts`, and `build/vk_data.rs`. Only the first
two are hand-written.

**Two signals people get wrong, and why:**

- **`subjectCommitment` must be salted.** A raw ENS namehash is an unsalted,
  publicly computable function of the name. A rainbow table over any ENS name
  list inverts it instantly, and this value is submitted as Solana instruction
  data, in the clear, forever. Unsalted, the claim "the name never appears
  on-chain" is simply false.
- **`verifierCommitment` must be public.** It feeds the nullifier at [5]. If it
  were private, the prover could compute the nullifier against a verifier of
  their own choosing and the "this receipt is bound to one lender" claim would
  mean nothing at all. Public, the circuit forces the nullifier to be derived
  from the commitment the lender actually published.

### The layout is derived, never assumed

snarkjs orders the public witness as `[outputs…, public inputs…]`, and within
each group by declaration order inside the template. That is easy to state and
easy to get silently wrong, and getting it wrong produces "proof invalid" with
no diagnostic.

So `build.mjs` does not assume it. It reads `nPubOut` / `nPubIn` out of the
**`.r1cs` header**, maps witness indices `1..nPublic` to signal names via the
**`.sym` symbol table**, and compares the result to the documented contract.
**A mismatch fails the build.** The derived order is then emitted as
`build/signal_layout.json` and as a generated
`frontend/src/shared/signalLayout.ts`, so TypeScript and Rust both consume the
same derived indices rather than a hand-typed guess.

A second, independent check runs in the same build: it proves a known witness
and asserts that all seven emitted signals equal the values `poseidon-lite`
computes for the same inputs. That catches a Poseidon **arity or argument
order** drift between the circuit and `backend/src/protocol/policy.ts` — the
other failure mode that surfaces only as an unexplained invalid proof.

---

## Circuit rules that must not be "simplified" away

**1. Every private amount is range-checked with `Num2Bits` before it reaches a
comparator.** circomlib's `LessThan`/`GreaterEqThan` are sound only when both
inputs are known to fit in *n* bits. Without the guards a prover supplies
`p - 1` (the field's "−1"), the comparator's internal `Num2Bits` overflows, and
the comparison silently flips. The circuit still compiles, still produces a
proof, and the proof still verifies. This is soundness, not decoration.
`verify-test.mjs` asserts it directly: `minAssets = p-1` must be **unprovable**,
and so must `collateralQuality = 250`.

Widths: `assets` 40 bits, `collateralQuality` 7 bits (plus an explicit
`<= 100`), `historyMonths` 16 bits, `expiry` 40 bits. The **policy thresholds
are range-checked too** — they are private inputs here, so the prover controls
them exactly as much as the witness.

**2. `eligible` is an output BIT, not an assertion.** Do not tighten it to
`=== 1`. The lender must be able to receive a *valid* proof that says "not
eligible" — that is what makes "the provider only ever received failed public
outputs, never the values that caused them" a true sentence. Asserting
eligibility instead would mean a rejected applicant produces no proof at all,
and the lender learns nothing it can check.

**3. `expiry` is range-checked so it appears in a constraint.** A public input
that occurs in no constraint has a zero IC coefficient, and the verifier then
accepts *any* value for it. The binding would be cosmetic.

**4. `debtRatio` is gone.** Workstream B replaced it with `collateralQuality`
(percent of the portfolio in allowlisted stablecoins and liquid staking tokens)
because real borrow positions cannot be honestly read from Solana RPC. The
comparison **flips**: `debtRatio <= maxDebtRatio` became
`collateralQuality >= minCollateralQuality`.

---

## Negative tests — `node zk/verify-test.mjs`

35 cases, all passing. The interesting ones:

- every one of the seven public signals, tampered individually → **rejected**
- a proof for policy A checked against policy B's signals → **rejected** (both
  directions)
- a proof issued to lender A checked against lender B's signals → **rejected**
- one flipped bit in `pi_a`, `pi_b` or `pi_c` → **rejected**
- `pi_a` swapped with `pi_c` → **rejected**
- an ineligible proof relabelled `eligible = 1` → **rejected**
- an **ineligible proof VERIFIES** with `eligible = 0` → this one must pass
- exactly-at-threshold is eligible (`>=`, not `>`); one dollar under is not
- `collateralQuality = 250` and `minAssets = p-1` are **unprovable**
- all four in-circuit Poseidon results equal `poseidon-lite`'s

---

## Files

| file | what it is |
|---|---|
| `circuits/credit_policy.circom` | the circuit |
| `getcircom.mjs` | puts circom 2.2.3 in `bin/`; prefers the verified local copy, downloads only if absent, always asserts `--version` |
| `build.mjs` | compile → ceremony → layout assertion → both artifact sets |
| `prove.mjs` | CLI prover with timings; `--ineligible`, `--assets/--quality/--history/--exposed`, `--input file.json` |
| `verify-test.mjs` | the negative tests and the cross-language equality checks |
| `to_solana.mjs` | the snarkjs → groth16-solana converter (also runnable standalone) |
| `protocol.mjs` | JS mirror of `backend/src/protocol/{hashing,policy}.ts`, so the tests can prove the two agree |
| `paths.mjs` | path resolution that does not depend on `process.cwd()` |
| `make-fixtures.mjs` | two honest proofs under two DIFFERENT policies, into `build/fixtures/`, for the backend verifier's self-test (`npm run zk:fixtures`) |

---

## Environment traps that cost real time

- **Every Hermez/zkevm ptau mirror is 403/404**, and circomkit 0.3.4 hardcodes
  the dead bucket. `build.mjs` generates the ptau locally (~18 s to power 12).
  Do not add a `curl …ptau` step; it fails looking like a network problem.
- **Never spawn `npx.cmd`.** Node ≥ 18.20 throws `EINVAL` on `.cmd` via
  `execFile`. `build.mjs` calls
  `node node_modules/snarkjs/build/cli.cjs` instead.
- **snarkjs leaves its ffjavascript worker pool alive**, so a script that
  finishes never exits. Each CLI here ends with an explicit
  `process.stdout.write("", () => process.exit(…))` — the flush callback
  matters, because Windows stdout pipes are asynchronous and a bare
  `process.exit()` truncates the output.
- **`poseidon-lite` by subpath only** (`poseidon-lite/poseidon4`). The barrel
  import pulls all sixteen permutations: 33 KB → 433 KB gzipped. Never
  `circomlibjs` in the browser — it drags in ethers v5.
- **`build/` is in the boilerplate `.gitignore`.** The repo `.gitignore`
  negates `zk/build/**` back in, and re-ignores the `.ptau` and the
  intermediate ceremony zkeys. Check `git check-ignore` before assuming the
  transcript is committed.

---

## `to_solana.mjs` — the conversion recipe

Three rules, all verified end-to-end by the Rust test in
`prototype/solana-verify/`, which printed
`proof.A NEGATED : VERIFIED` / `proof.A as-is : rejected` /
`TAMPERED inputs: correctly rejected`:

1. **`proof.A` must be negated** — `(x, p − y)`. Non-negated A is rejected.
2. **G2 coordinates swap.** snarkjs emits `[[x.c0, x.c1], [y.c0, y.c1]]`;
   arkworks (and therefore groth16-solana) wants **c1 before c0**.
3. **Everything is 32-byte big-endian**, and the encoder **throws** rather than
   truncating. The classic bug is `padStart(64)` on a value that is already
   longer than 64 hex characters: it silently no-ops.

Unit checks the converter performs on every run (16 of them): `vk.IC.length ===
nPublic + 1`, `vk.nPublic` agrees with the signals, protocol/curve are
`groth16`/`bn128`, every G1 blob is exactly 64 bytes, every G2 blob exactly 128,
every public input exactly 32, and the A-negation both changes Y and round-trips
mod p.

Published-crate traps, verified: `groth16-solana` **0.2.0 is not GitHub
master**. The struct field is misspelled **`vk_gamme_g2`** (writing
`vk_gamma_g2` is a compile error), there are no feature flags, no `vk::circom`
module and no `proof_parser.rs`, and VK generation is a bundled Node script.
Every online tutorial describes master.

**Nothing is deployed on Solana.** Workstream E has not happened. On-chain
verification is *proven to work in a local Rust test* — that is a claim about
the credential being chain-portable, not a claim about a deployment.
