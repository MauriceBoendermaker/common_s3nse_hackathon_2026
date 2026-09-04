# ZKredit

**Borrow against what you can prove.** A private credit marketplace on Solana, anchored to ENS.

A borrower proves that their real Solana portfolio satisfies a lender's policy with a
zero-knowledge proof generated in the browser. The lender verifies the proof, competes on rate,
and pays out to a one-time address derived from the borrower's ENS name. Nobody ever sees a
balance, and no two loans to the same person are linkable on chain.

Built for Common S3nse 2026 by Maurice Boendermaker, Yassine Abderrazik, Thijs van Steenbeek and Mathijs de Niet.

## How a loan happens

1. **List.** The borrower connects Phantom, signs once to prove the address is theirs, and the
   backend reads live mainnet balances into a four-value passport. Only a Poseidon hash of it is
   listed, together with amount, term and the borrower's ENS name.
2. **Prove.** A lender sends four thresholds (collateral, quality, history, restricted exposure).
   The borrower's browser produces a Groth16 proof that the hidden passport satisfies them.
3. **Fund and settle.** The lender verifies, funds an offer, and the `private_credit` program on
   Solana re-verifies the proof on chain, spends a nullifier so the receipt can never be reused,
   and moves the escrow to a fresh address derived from the key under the borrower's ENS name.

## What is live

| | |
|---|---|
| Portfolio | Live Solana mainnet reads, priced with Jupiter. Read only after a Phantom signature from the address. |
| Proof | Groth16 BN254 over a 2,980-constraint circuit, proved in a Web Worker in ~0.5 s, verified by the server and again on chain. |
| Identity | ENS on Sepolia, ENSv2 first with v1 fallback. The payout key is a text record the borrower publishes from their own wallet. |
| Settlement | Anchor program on **Solana devnet**: `69qmzHFdDMP8hGFNcJcKpduGbdjEnAhdrvLrLaydvvRc` ([explorer](https://explorer.solana.com/address/69qmzHFdDMP8hGFNcJcKpduGbdjEnAhdrvLrLaydvvRc?cluster=devnet)). |
| Marketplace | Every listing, policy, proof, offer and loan is a real row served over HTTP to two independent browser sessions. |

Not yet: the trusted setup is a development ceremony, the settlement token is a test mint, the
Solana leg is signed by operator keys the backend holds, nothing is audited.

## Run it

```bash
npm install
npm run zk:build      # compile the circuit, run the dev ceremony, emit artifacts (~40 s)
npm run dev           # frontend on :5173, backend on :3001
```

Open the Borrow page in one window and the Lend page in another. You need:

- **MetaMask on Sepolia** holding an ENS name you own (register at <https://app.ens.dev>).
  Connecting signs one message; if the name has no payout-key record yet, one button publishes it.
- **Phantom** with the Solana wallet whose portfolio you want to prove. Any balance of at least $1
  in an allowlisted asset passes the loosest policy.

Settlement uses the devnet program above via `.solana/deployment.json`. To run against a local
validator instead: `npm run solana:build && npm run solana:up`. To redeploy to devnet:
`npm run solana:deploy -- --cluster devnet && npm run solana:setup -- --cluster devnet`.

## Verify it

```bash
npm run zk:test           # 35 circuit checks, including every negative case
npm run ens:selftest      # payout derivation: three draws, three unlinkable addresses, all recovered
node backend/src/protocol/store.ts     # store self-test, including the trust boundary
node backend/src/protocol/policy.ts    # policy self-test
curl localhost:3001/api/health         # verifying-key hashes, ceremony note
```

## Layout

```
frontend/   React SPA. borrower/ and lender/ are separate lazy chunks; the witness never reaches the lender bundle.
backend/    Express API. In-memory marketplace store, Groth16 verifier, Solana settlement adapter.
zk/         circom circuit, dev ceremony, artifact export.
solana/     Anchor program private_credit (on-chain Groth16 verify, nullifier PDA, SPL escrow).
scripts/    e2e, ENS and Solana tooling.
```

## License

[MIT](LICENSE) (`SPDX-License-Identifier: MIT`)
