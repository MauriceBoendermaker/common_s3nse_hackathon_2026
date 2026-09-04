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
    title: "ENS resolution by the payer \u2014 the weakest link",
    body:
      "Nothing on Solana can read ENS, so a settlement program accepts whatever payout address the payer supplies. The borrower\u2019s tab recomputes it from the published R and flags a mismatch immediately \u2014 detection, not prevention.",
  },
  {
    icon: <KeyRound size={20} />,
    title: "One-time keys are not compartmentalised",
    body:
      "The whole one-time key comes from one ECDH secret, so whoever can scan can also spend. Unlinkability holds \u2014 without the viewing scalar, two draws cannot be tied to each other or to the ENS name. The trade avoids ed25519 scalar arithmetic Solana\u2019s Keypair APIs will not do.",
  },
  {
    icon: <HardDrive size={20} />,
    title: "Applicant environment",
    body: "The wallet, browser, device, and witness-building environment must not leak or alter private inputs.",
  },
  {
    icon: <Database size={20} />,
    title: "Data-source correctness",
    body: "A proof can faithfully evaluate wrong inputs. Balances come from Solana mainnet RPC and prices from a single quote source, Jupiter; neither response is signed.",
  },
  {
    icon: <Server size={20} />,
    title: "Our backend and passport proxy",
    body: "The portfolio read goes through a server we run. It sees the address, balances, USD values, timing and IP metadata \u2014 and could return a snapshot that never existed. One unaudited operator, nothing signed.",
  },
  {
    icon: <Code2 size={20} />,
    title: "Circuit and verifier",
    body: "2 980 constraints, with Num2Bits range checks on every value reaching a comparator \u2014 without those, field overflow would make proofs forgeable. The backend verifies with snarkjs and fails closed if the verifying key is missing or differs from the browser\u2019s.",
  },
  {
    icon: <KeyRound size={20} />,
    title: "Trusted setup",
    body: "Two phase-2 contributions and a beacon, all run by one person on one machine; transcript at zk/build/ceremony-transcript.md. Whoever ran it could forge proofs that verify. Not a multi-party ceremony.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Provider judgement",
    body: "Eligibility is one underwriting input. The capital provider remains responsible for pricing and credit risk.",
  },
];

const limitations = [
  "On-chain verification rests on groth16-solana 0.2.0 — widely used, unaudited. The Rust test in prototype/solana-verify/ runs this proof through it and rejects tampered inputs.",
  "The ENS payout leg is not standard-compliant. The pending stealth-address ENSIP puts non-EVM chains out of scope, so this uses a custom record key and does not reuse ERC-5564 schemeId 1, which would misdescribe the curve.",
  "A claim describes one policy at one point in time. It does not prove future solvency, guarantee repayment, or replace independent underwriting.",
  "Soundness rests on a development trusted setup. Treat it as a demonstration, not a production guarantee.",
  "A proof hides the witness — not public ENS records, transaction history, timing, IP, or request metadata.",
  "The Solana address the snapshot was read from is visible to the capital provider in the provenance strip.",
  "A new proof cannot make previously published or externally correlated information private again.",
  "Source outages, stale prices, unpriced mints, and an account age the scan cannot establish produce an unavailable result, not a pass or a fail.",
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
        title="Reliable credit with privacy as a core principle."
        lead="This page documents what crosses from an applicant to a capital provider, who you still have to trust, and what a proof cannot do."
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
        intro="This is the core promise. It does not make the surrounding services invisible."
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
        intro="Zero-knowledge reduces disclosure. It does not remove software, infrastructure, or counterparty trust, including trust in the server we run ourselves."
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
        intro="What the backend holds, and what it never receives."
      >
        <div className="retention-grid">
          <article>
            <span><HardDrive size={18} /> Tier 0 · portfolio snapshot</span>
            <h3>Browser memory, and nowhere else</h3>
            <p>Per-token balances, USD values, and the witness derived from them stay in the applicant’s tab. Never written to disk, never persisted, and no endpoint accepts them back. The published request carries a commitment instead.</p>
          </article>
          <article>
            <span><Database size={18} /> Tier 1 · marketplace records</span>
            <h3>Deliberately public between the two parties</h3>
            <p>Requests, policy challenges, proof receipts, offers, and the loan lifecycle live in an in-memory store both parties are meant to read. No portfolio values, no database, no user accounts, and everything is gone when the process restarts.</p>
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
              The Groth16 prover is a Web Worker in the same tab, so portfolio values are worker arguments
              and never enter a request body. A deployment that adds a Content-Security-Policy must
              allow <code>worker-src blob:</code> and <code>&apos;wasm-unsafe-eval&apos;</code> —
              ffjavascript spawns its own workers from blob URLs, and without those directives proving
              fails with an error that points nowhere near the policy.
            </p>
          </article>
          <article>
            <span><KeyRound size={18} /> Credentials</span>
            <h3>No secret belongs in the client</h3>
            <p>The portfolio path is keyless: public Solana RPC and Jupiter pricing need no vendor account. Any credential a production deployment adds stays server-side, never in a browser bundle or a proof receipt.</p>
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
            <p>Balances are read live from Solana mainnet, ENS names are resolved live on Sepolia, and the proof is a real BN254 Groth16 proof verified by the backend against the same verifying key the browser proved with. <strong>No independent audit has been done, and no real funds move.</strong></p>
            {!loading && <p>{deploymentSentence(config)}</p>}
            <p>What is enforced rather than illustrated: the passport commitment is published before the provider issues its policy challenge; the backend recomputes the policy hash instead of trusting the client; receipts carry an expiry that is checked; and the nullifier is a program-derived account, so a second presentation of the same receipt is refused by the Solana runtime before any of our code runs.</p>
          </div>
          <span className="status-label status-label--warning">Prototype only</span>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Verify the boundary"
        title="See exactly what each side receives."
        body="Run the workflow, then read the risk disclosures before treating any result as a credit decision."
        primary={{ view: "borrower", label: "Open the market" }}
        secondary={{ view: "risk-disclosures", label: "Read risk disclosures" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
