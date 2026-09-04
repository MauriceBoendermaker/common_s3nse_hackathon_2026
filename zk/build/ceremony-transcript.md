# Trusted setup transcript — `credit_policy`

**Generated:** 2026-09-03T22:04:00.119Z
**Circuit:** `zk/circuits/credit_policy.circom` compiled with circom compiler 2.2.3
**Constraints:** 1390 non-linear + 1590 linear (2980 total)
**Public signals:** 7 — passportCommitment, eligible, policyHash, subjectCommitment, expiry, nullifier, verifierCommitment
**Powers of tau:** 2^12, generated locally
**Final zkey:** `credit_policy_final.zkey` · sha256 `9ded0bf090f72f748f50382fc96a248279acb0977e596464bdf23a718150c488`
**Verification key:** sha256 `251cf26a7971932a09d69657cab4013b57a92e978d61d5e73727c20049c6a1c5`

---

## READ THIS FIRST — this is NOT a real ceremony

This is a **development trusted setup**. Every step below was run by **one person, on one
machine, in one process**, inside a single invocation of `zk/build.mjs`. The phase-1 and
phase-2 contributions are "independent" only in the sense that each drew fresh entropy from
`node:crypto`'s `randomBytes(32)`; they were not made by independent parties who could not
collude, because there was only ever one party.

**The practical consequence, stated plainly: whoever ran this build could forge proofs.**
The Groth16 toxic waste (the trapdoor from every contribution, and the beacon) passed through
a single process on a single machine. Nothing here prevents that process from having retained
it. Anyone who did retain it can produce a proof for a statement that is false — an "eligible"
credential for a portfolio that does not satisfy the policy — and that forged proof would
verify against this verification key, in the browser and on Solana alike.

The entropy was discarded (never written to disk, never logged) and the run ends with a public
beacon, which is what a real ceremony does. That is good hygiene. It is **not** a security
argument, because you have only this document's word for it, and this document was written by
the same script.

**What a real setup requires:** many independent participants, at least one of whom is honest
and destroys their contribution; a public, verifiable, append-only transcript that third
parties attested to at the time; a beacon drawn from a source fixed after the last contribution.
Perpetual Powers of Tau supplies phase 1 for exactly this reason. This build supplies neither
phase properly.

**Therefore:** treat every proof produced against this key as a demonstration of the mechanism,
not as a security guarantee. Do not put value behind it. A production deployment must re-run
phase 2 as a real multi-party ceremony over a real phase-1 transcript, and re-issue both the
browser artifacts and the Solana program's `VK_*` constants from it.

---

## Steps

| phase | step | artifact | bytes | sha256 | timestamp (UTC) |
|---|---|---|---|---|---|
| phase 1 | initialise | `pot12_0000.ptau` | 1,573,072 | `18dd67751dd0659bcd6f58d961ef478d855f1695325ad9db9cd68e30e411e24a` | 2026-09-03T22:03:31.902Z |
| phase 1 | contribution #1 (phase1-dev-1) | `pot12_0001.ptau` | 1,574,590 | `6a882e89b966c617e0915d9eddddf99ee9a2d2942af805dae589b6e5391e1a28` | 2026-09-03T22:03:33.530Z |
| phase 1 | contribution #2 (phase1-dev-2) | `pot12_0002.ptau` | 1,576,108 | `5c96ad1494d4b1c7a94ef320230f19434ebb2a14a2647e22101e40f16341a13c` | 2026-09-03T22:03:34.939Z |
| phase 1 | beacon | `pot12_beacon.ptau` | 1,577,663 | `1e6f0dafb5f39c169c5fea46d77df4d2cc70bd276af4e44465913fcffae7346f` | 2026-09-03T22:03:36.354Z |
| phase 1 | prepare phase2 | `pot12_final.ptau` | 4,723,119 | `bad4bab5a01aabdc15194f25f46d2e2b15256b1fa63a9025574ead2cca2b17de` | 2026-09-03T22:03:51.022Z |
| phase 2 | setup (zkey_0000) | `credit_policy_0000.zkey` | 1,349,864 | `4ba162798df83fd2f9f0ac25d0a9054142fb7e777c4971b84056ca94c93f133e` | 2026-09-03T22:03:54.494Z |
| phase 2 | contribution #1 (phase2-dev-1) | `credit_policy_0001.zkey` | 1,350,270 | `5a6522298c22107cdd9b6e3dafa91092b580d7a7ddd6e0adb2705d15b325f7fb` | 2026-09-03T22:03:55.184Z |
| phase 2 | contribution #2 (phase2-dev-2) | `credit_policy_0002.zkey` | 1,350,676 | `1d995c6a34e348e51eb4dc5392f93aa4c8b49ec75e11ee829fdd9c088b454548` | 2026-09-03T22:03:55.869Z |
| phase 2 | beacon (final) | `credit_policy_final.zkey` | 1,351,119 | `9ded0bf090f72f748f50382fc96a248279acb0977e596464bdf23a718150c488` | 2026-09-03T22:03:56.593Z |
| phase 2 | verification key export | `verification_key.json` | 4,025 | `251cf26a7971932a09d69657cab4013b57a92e978d61d5e73727c20049c6a1c5` | 2026-09-03T22:03:59.275Z |

### Beacon

Both phases were finalised with `beacon`, hash
`0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20`, 10 iterations
(2^10 applications of SHA-256 as the delay function).

This beacon value is a **fixed constant in `zk/build.mjs`**, not a value drawn from a public
randomness source after the last contribution. A real ceremony draws it from something nobody
could have predicted or influenced — a future block hash, a drand round, an NIST beacon pulse.
Using a hardcoded constant means the beacon adds reproducibility, not unpredictability. It is
listed here so nobody mistakes it for the real thing.

### Contributions

| phase | name | entropy |
|---|---|---|
| 1 | `phase1-dev-1` | `crypto.randomBytes(32)`, generated in-process, never persisted |
| 1 | `phase1-dev-2` | `crypto.randomBytes(32)`, generated in-process, never persisted |
| 1 | `phase1-beacon` | fixed constant above |
| 2 | `phase2-dev-1` | `crypto.randomBytes(32)`, generated in-process, never persisted |
| 2 | `phase2-dev-2` | `crypto.randomBytes(32)`, generated in-process, never persisted |
| 2 | `phase2-beacon` | fixed constant above |

Two independent phase-2 contributions plus a beacon, as required. `snarkjs zkey verify`
re-checked the full phase-2 chain against the r1cs and the phase-1 transcript and reported
`ZKey Ok`.

## Timings on the build machine

| step | wall clock |
|---|---|
| circom | 2.3s |
| ptau new | 0.7s |
| ptau contribute #1 | 1.6s |
| ptau contribute #2 | 1.4s |
| ptau beacon | 1.4s |
| ptau prepare phase2 | 14.7s |
| ptau verify | 1.5s |
| groth16 setup | 2.0s |
| zkey contribute #1 | 0.7s |
| zkey contribute #2 | 0.7s |
| zkey beacon | 0.7s |
| zkey verify | 2.1s |
| export vkey | 0.6s |
| **total** | **31.2s** |

## Reproduce

```bash
npm install            # links the zk workspace
node zk/getcircom.mjs  # circom 2.2.3 into zk/bin/
node zk/build.mjs      # this transcript, regenerated
```

The artifact hashes will differ from the table above: every run draws fresh entropy, so every
run produces a different zkey and a different verification key. That is expected. What must
reproduce is the **circuit** — `credit_policy.r1cs` is deterministic — and the derived public
signal layout.

## One build step, two outputs

`build.mjs` writes the browser artifacts (`frontend/public/zk/`) and the Solana program's
verifying key (`zk/build/vk_data.rs`) in the same run, on purpose. Regenerating the zkey
changes the verifying key, so if the two are ever regenerated separately every proof fails
on-chain with no useful error.
