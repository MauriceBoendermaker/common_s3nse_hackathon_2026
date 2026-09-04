import {
  AlertTriangle,
  Check,
  Cloud,
  Code2,
  Database,
  Eye,
  FileWarning,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Radio,
  Server,
  ShieldCheck,
  Waypoints,
  X,
} from "lucide-react";
import type { SiteView } from "../../config/navigation";
import {
  deploymentSentence,
  shortAddress,
  useSettlementConfig,
} from "../../shared/useSettlementConfig";
import { PrivacyBoundary } from "../PrivacyBoundary";
import { ContentHero, ContentSection, PageCta } from "./ContentPageShell";

const informationRows = [
  {
    category: "Public request",
    revealed: "Amount, asset, term, and first-loss deposit",
    hidden: "Where the applicant’s liquidity is held",
    stored: "Backend in-memory store, wiped on restart",
    observable: "Anyone who receives or indexes the request",
  },
  {
    category: "ENS identity",
    revealed: "The ENS name, and its X25519 payout key if published",
    hidden: "The viewing scalar, and which payout addresses are the same person",
    stored: "The name only; the viewing key never leaves the applicant\u2019s tab",
    observable: "Sepolia RPC operators and anyone reading the public resolver",
  },
  {
    category: "Payout address",
    revealed: "A one-time Solana address, the ephemeral key R, and a view tag",
    hidden: "Any link between two payout addresses, or either to the ENS name",
    stored: "One announcement row per draw in the in-memory store",
    observable: "Anyone with the shared state; the link needs the viewing scalar",
  },
  {
    category: "Portfolio evidence",
    revealed: "A pass/fail per claim, plus the address it was read from",
    hidden: "Exact balances, per-token amounts, and USD totals",
    stored: "Browser memory only; no endpoint accepts it back",
    observable: "Our passport proxy and the Solana RPC it calls",
  },
  {
    category: "Offer and settlement",
    revealed: "Provider, APR, fees, deposit, term, and status",
    hidden: "No extra portfolio detail is unlocked by an offer",
    stored: "Backend in-memory store until the process restarts",
    observable: "Counterparties; public networks in a future onchain flow",
  },
];

const assumptions = [
  {
    icon: <Waypoints size={20} />,
    title: "ENS resolution by the payer \u2014 the softest edge here",
    body:
      "Nothing on Solana can read ENS. A settlement program has no way to check that a payout address was really derived from the borrower\u2019s privatecredit.payout-key[501] record; it will accept whatever address the payer\u2019s client supplies. Two things bound that, and neither is prevention. The payer is the party who wants a valid loan, so misdirecting the payout is against their own interest. And the borrower detects it immediately: their tab recomputes the address from the published R and shows the mismatch, and no funds arrive. This is detection after the fact, not enforcement, and it is the weakest link in the design.",
  },
  {
    icon: <KeyRound size={20} />,
    title: "One-time keys are not compartmentalised",
    body:
      "Full ERC-5564 stealth addresses separate a viewing key from a spending key, so scanning can be delegated without granting the ability to spend. This derives the whole one-time key from a single ECDH secret, which sidesteps ed25519 scalar arithmetic that standard Solana Keypair APIs will not do \u2014 at a real cost: whoever can scan can also spend. Unlinkability is unaffected; an observer without the viewing scalar still cannot connect two draws to one identity or either to the ENS name. What is lost is compartmentalisation, and that is a design trade, not an oversight.",
  },
  {
    icon: <HardDrive size={20} />,
    title: "Applicant environment",
    body: "The wallet, browser, device, and witness-building environment must not leak or alter private inputs.",
  },
  {
    icon: <Database size={20} />,
    title: "Data-source correctness",
    body: "A proof can faithfully evaluate wrong inputs. Balances come from Solana mainnet RPC and Jupiter prices, and nothing yet attests that the address supplied belongs to the applicant.",
  },
  {
    icon: <Server size={20} />,
    title: "Our backend and passport proxy",
    body: "The portfolio read is proxied through a server we operate. It sees the Solana address the applicant supplies, the balances and USD values read on their behalf, and request timing and IP metadata. Because it serves the passport, a malicious operator could return a snapshot that never existed. It is a single unaudited operator run by the project authors, with no signed attestation over what it returns.",
  },
  {
    icon: <Code2 size={20} />,
    title: "Circuit and verifier",
    body: "The proving circuit, parameters, and verifier must encode the stated policy and resist implementation errors. The circuit is 2 980 constraints with Num2Bits range checks on every value that reaches a comparator \u2014 without those it would be forgeable by field overflow while still appearing to work. The backend verifies with snarkjs against zk/build/verification_key.json and fails closed if that key is missing or differs from the copy the browser proved with.",
  },
  {
    icon: <KeyRound size={20} />,
    title: "Trusted setup",
    body: "A hackathon phase-2 ceremony: two contributions and a beacon, run by one person on one machine, transcript published at zk/build/ceremony-transcript.md. Whoever ran it holds toxic waste and could forge proofs that verify. This is not a real multi-party ceremony and must not be treated as one.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Provider judgement",
    body: "Eligibility is one underwriting input. The capital provider remains responsible for pricing and credit risk.",
  },
];

const limitations = [
  "On-chain verification is proven to work and is not deployed. The Rust test in prototype/solana-verify/ takes this circuit\u2019s proof through groth16-solana and verifies it \u2014 including the negation of proof.A, without which it is rejected, and a tampered-input case that is correctly rejected. groth16-solana 0.2.0 is widely used and unaudited: only 0.0.1 was in the Light Protocol v3 audit. Nothing is deployed on any Solana cluster, so this is a claim about the credential being chain-portable, not about a live program.",
  "The ENS payout leg does not claim standard compliance. The pending stealth-address ENSIP states that non-EVM scoping is out of scope, so this uses a custom record key (privatecredit.payout-key[501]) and deliberately does not reuse ERC-5564 schemeId 1, which is registered for secp256k1 and would misdescribe the curve in the payload. It is an early implementation of a direction ENS is standardising, not an implementation of a standard.",
  "A valid claim describes one policy at one point in time; it does not prove future solvency.",
  "A proof does not guarantee repayment, prevent liquidation, or replace independent underwriting.",
  "The receipt is a BN254 Groth16 proof, produced by a Web Worker in the applicant’s browser and verified server-side against a committed verifying key. The trusted setup behind that key is a development ceremony run by one person on one machine — two phase-2 contributions and a published transcript, but whoever ran it could forge proofs. Treat the soundness guarantee as a demonstration, not a production one.",
  "A zero-knowledge proof hides the witness—not public ENS records, transaction history, timing, IP, or request metadata.",
  "The Solana address the snapshot was read from travels with the request in the provenance strip. It is not hidden from the capital provider.",
  "Previously published or externally correlated information cannot be made private by generating a new proof.",
  "Source outages, stale prices, unpriced mints, and an account age the bounded scan cannot establish produce an unavailable result rather than a pass or a fail.",
];

export function SecurityPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  /*
   * The scorecard below used to be seven hard-coded rows. Three of them were
   * claims about a chain, and a claim about a chain written into JSX is a
   * claim that goes stale the day somebody deploys. These three now come from
   * `GET /api/settlement/config` — the same endpoint a judge can curl.
   */
  const { config, loading } = useSettlementConfig();
  const deployed = Boolean(config?.programId);

  return (
    <div className="content-page">
      <ContentHero
        eyebrow="Security & trust"
        title="Privacy is a boundary, not a slogan."
        lead="Private Credit is designed to minimize what crosses from an applicant’s financial context to a capital provider. This page documents that boundary, the parties you still trust, and the limits a proof cannot remove."
        aside={
          <div className="trust-scorecard">
            <span className="section-label">Prototype posture</span>
            <dl>
              <div><dt>Mainnet contracts</dt><dd><X size={14} /> None, by design</dd></div>
              <div><dt>Independent audit</dt><dd><X size={14} /> Not audited</dd></div>
              <div><dt>Real funds</dt><dd><X size={14} /> Test cluster only</dd></div>
              <div><dt>Portfolio data</dt><dd className="is-positive"><Check size={14} /> Live Solana mainnet</dd></div>
              <div><dt>ENS resolution</dt><dd className="is-positive"><Check size={14} /> Live Sepolia reads</dd></div>
              <div>
                <dt>Solana program</dt>
                <dd className={deployed ? "is-positive" : undefined} title={config?.programId ?? undefined}>
                  {deployed ? <Check size={14} /> : <X size={14} />}{" "}
                  {loading
                    ? "checking…"
                    : deployed
                      ? `${shortAddress(config?.programId)} · ${config?.cluster}`
                      : "Not deployed"}
                </dd>
              </div>
              <div>
                <dt>On-chain verification</dt>
                <dd className={config?.enabled ? "is-positive" : undefined}>
                  {config?.enabled ? <Check size={14} /> : <X size={14} />}{" "}
                  {config?.enabled ? "Groth16 in the program" : "Backend only"}
                </dd>
              </div>
            </dl>
          </div>
        }
      />

      <ContentSection
        eyebrow="Disclosure boundary"
        title="The verification output is intentionally small"
        intro="The existing product component below is the core promise. It does not mean every surrounding service is invisible."
      >
        <div className="security-boundary-wrap"><PrivacyBoundary /></div>
      </ContentSection>

      <ContentSection
        eyebrow="Data inventory"
        title="Revealed, hidden, stored, and observable"
        intro="“Hidden from the lender” and “unobservable to every infrastructure provider” are different claims."
      >
        <div className="information-table" role="table" aria-label="Information handling matrix">
          <div className="information-table__row information-table__header" role="row">
            <span role="columnheader">Information</span>
            <span role="columnheader"><Eye size={14} /> Revealed</span>
            <span role="columnheader"><LockKeyhole size={14} /> Hidden</span>
            <span role="columnheader"><HardDrive size={14} /> Stored</span>
            <span role="columnheader"><Radio size={14} /> Observable</span>
          </div>
          {informationRows.map((row) => (
            <div className="information-table__row" role="row" key={row.category}>
              <strong role="cell">{row.category}</strong>
              <span role="cell" data-label="Revealed">{row.revealed}</span>
              <span role="cell" data-label="Hidden">{row.hidden}</span>
              <span role="cell" data-label="Stored">{row.stored}</span>
              <span role="cell" data-label="Observable">{row.observable}</span>
            </div>
          ))}
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Trust model"
        title="What must still be trusted"
        intro="Zero-knowledge reduces disclosure. It does not eliminate software, infrastructure, or counterparty trust. Several parties still have to behave \u2014 one of them is the server we run ourselves, and the first one listed is the payer resolving an ENS name that no chain can check for them."
      >
        <div className="trust-grid">
          {assumptions.map((assumption) => (
            <article key={assumption.title}>
              <span className="icon-tile">{assumption.icon}</span>
              <h3>{assumption.title}</h3>
              <p>{assumption.body}</p>
            </article>
          ))}
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Proof limitations"
        title="What a passing proof does not mean"
      >
        <div className="limitation-panel">
          <span className="limitation-panel__icon"><AlertTriangle size={23} /></span>
          <ul>
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Retention and operators"
        title="Two tiers of data, held very differently"
        intro="There is a backend now. What it holds and what it deliberately never receives are separate questions."
      >
        <div className="retention-grid">
          <article>
            <span><HardDrive size={18} /> Tier 0 · portfolio snapshot</span>
            <h3>Browser memory, and nowhere else</h3>
            <p>The snapshot returned by the passport read—per-token balances, USD values, and the witness derived from them—lives in the applicant’s tab. It is never written to disk, never persisted by the backend, and no endpoint accepts it back. The published request carries a commitment and a provenance strip instead.</p>
          </article>
          <article>
            <span><Database size={18} /> Tier 1 · marketplace records</span>
            <h3>Deliberately public between the two parties</h3>
            <p>Requests, policy challenges, proof receipts, offers, and the loan lifecycle live in an in-memory store inside the backend process. Both parties are meant to read them. They contain no portfolio values, there is no database and no user account, and everything is gone when the process restarts.</p>
          </article>
          <article>
            <span><Cloud size={18} /> Service metadata</span>
            <h3>Infrastructure can still see traffic</h3>
            <p>Our own passport proxy, the Solana RPC endpoints it calls, the Jupiter price API, and the hosting layer can observe requests, IP addresses, timestamps, and the addresses queried.</p>
          </article>
          <article>
            <span><Code2 size={18} /> Prover worker · content security policy</span>
            <h3>Proving runs in a worker, and a CSP has to allow it</h3>
            <p>
              The Groth16 prover is a Web Worker created once when the applicant workspace mounts. It
              fetches <code>/zk/credit_policy.wasm</code> and <code>/zk/credit_policy.zkey</code> and keeps
              them in worker memory, so the portfolio values are arguments to a worker in the same tab and
              never enter a request body. A deployment that adds a Content-Security-Policy must allow{" "}
              <code>worker-src blob:</code> and <code>&apos;wasm-unsafe-eval&apos;</code>: ffjavascript
              spawns its own internal workers from blob URLs, and without those directives proving fails
              with an error that points nowhere near the policy.
            </p>
          </article>
          <article>
            <span><KeyRound size={18} /> Credentials</span>
            <h3>No secret belongs in the client</h3>
            <p>The current portfolio path is keyless: public Solana RPC and Jupiter pricing need no vendor account. Any credential a production deployment adds must stay server-side, be scoped to its purpose, and never be embedded in a browser bundle or a proof receipt.</p>
          </article>
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Assurance status"
        title="Audits and contract status"
      >
        <div className="assurance-panel">
          <FileWarning size={27} />
          <div>
            <h3>Experimental and unaudited</h3>
            <p>Balances are read live from Solana mainnet. ENS names are resolved live on Sepolia \u2014 registry owner, resolver, addr and a direct text() read of the payout record \u2014 and the one-time payout addresses are derived in the browser from the key that read returns. The proof is a real BN254 Groth16 proof, generated in the applicant\u2019s browser and verified by the backend with snarkjs against the same verifying key the browser proved with. On-chain verification is proven to work in a local Rust test against groth16-solana 0.2.0 (widely used, unaudited) but <strong>nothing is deployed on any Solana cluster</strong>: settlement targets devnet and is not wired, so no program exists to call, no independent audit has been done, and no real funds move. The trusted setup is a development ceremony, not a real one.</p>
            <p>What is enforced rather than illustrated: the passport commitment is published before the capital provider issues its policy challenge; the backend recomputes the policy hash instead of trusting the client, and so does the program, from its own stored account; receipts carry an expiry both the backend and the cluster clock check; and the nullifier is a program-derived account that gets created, so a second presentation of the same receipt is refused by the Solana runtime before a line of our code runs. That last one is the only guarantee in this project that requires trusting nobody at all.</p>
          </div>
          <span className="status-label status-label--warning">Prototype only</span>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Verify the boundary"
        title="See exactly what each side receives."
        body="Run the prepared workflow, then review the broader financial and technical risks before treating any result as a credit decision."
        primary={{ view: "borrower", label: "Open the market" }}
        secondary={{ view: "risk-disclosures", label: "Read risk disclosures" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
