import {
  ArrowRight,
  Check,
  Database,
  Fingerprint,
  Landmark,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import type { SiteView } from "../../config/navigation";
import { PRODUCT_CONFIG } from "../../config/product";
import { RouteLink } from "../RouteLink";
import { ContentHero, ContentSection, PageCta } from "./ContentPageShell";

const journey = [
  {
    title: "Anchor the applicant identity",
    body: "The applicant connects an EVM wallet and confirms the ENS identity used for the request.",
    boundary: "Wallet + ENS",
  },
  {
    title: "Assemble a private passport",
    body: "The applicant supplies a Solana address. Balances for the allowlisted mints are read from mainnet, priced, and reduced to a private snapshot. The commitment over that snapshot is published before any policy is issued.",
    boundary: "Private inputs",
  },
  {
    title: "Issue an underwriting challenge",
    body: "The capital provider defines thresholds for assets, collateral quality, account history, and restricted exposure. The backend recomputes the policy hash rather than trusting the client.",
    boundary: "Public policy",
  },
  {
    title: "Generate a sealed result",
    body: "The four comparisons happen inside a Groth16 circuit, proved by a Web Worker in the applicant’s browser. Seven public signals and a ~1.2 KB proof are published; the values behind them are not.",
    boundary: "Proof layer",
  },
  {
    title: "Verify and price the request",
    body: "The provider verifies each claim, assesses the remaining risks, and returns an APR, deposit, fee, and term.",
    boundary: "Provider workspace",
  },
  {
    title: "Applicant chooses what happens next",
    body: "The applicant compares offers and can accept, draw, and repay through the target settlement flow.",
    boundary: "Applicant decision",
  },
];

const boundaries = [
  {
    icon: <LockKeyhole size={20} />,
    label: "Local / private",
    title: "Where the witness belongs",
    items: [
      "Wallet consent and signatures",
      "The raw snapshot, held in browser memory only",
      "Witness construction and policy evaluation, in the browser",
    ],
  },
  {
    icon: <Server size={20} />,
    label: "Offchain",
    title: "Where services coordinate",
    items: [
      "The portfolio read itself, proxied through our backend",
      "Requests, challenges, receipts, and offer delivery",
      "Hosting, RPC, and provider metadata",
    ],
  },
  {
    icon: <Landmark size={20} />,
    label: "Onchain",
    title: "Where public state can live",
    items: [
      "ENS identity and resolver records",
      "Verifier and settlement contracts in the target design",
      "Transactions, timestamps, and addresses remain public",
    ],
  },
];

export function HowItWorksPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow="How it works"
        title="One proof connects private context to a credit decision."
        lead="The applicant controls the underlying financial data. The capital provider defines the policy. A sealed result connects the two without turning the portfolio into an underwriting dossier."
        aside={
          <div className="hero-proof-card">
            <span className="hero-proof-card__icon"><ShieldCheck size={22} /></span>
            <span className="section-label">Verification output</span>
            <strong>4 claims</strong>
            <p>Pass or fail, bound to one policy and one snapshot.</p>
            <span className="mono-value">groth16-bn254</span>
          </div>
        }
      >
        <RouteLink view="borrower" onNavigate={onNavigate} className="button button--primary">
          <span>Request credit</span><span className="button__icon"><ArrowRight size={16} /></span>
        </RouteLink>
        <RouteLink view="security" onNavigate={onNavigate} className="text-link">
          Read the security model <ArrowRight size={15} />
        </RouteLink>
      </ContentHero>

      <ContentSection
        eyebrow="Borrower to provider"
        title="A complete private-credit journey"
        intro="Each step has a clear owner and a deliberately narrow information boundary."
      >
        <ol className="story-timeline">
          {journey.map((step, index) => (
            <li key={step.title}>
              <span className="story-timeline__number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <span className="boundary-tag">{step.boundary}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </ContentSection>

      <ContentSection
        eyebrow="Data flow"
        title="Raw data stops before the lender"
        intro="The snapshot is real and the values in it are read from Solana mainnet. What crosses to the capital provider is a commitment, four outcomes, and a provenance strip—never the numbers behind them."
      >
        <div className="data-flow" aria-label="Private credit data flow">
          <div className="data-flow__node">
            <WalletCards size={20} />
            <span>Applicant</span>
            <strong>Wallet consent</strong>
          </div>
          <ArrowRight className="data-flow__arrow" aria-hidden="true" />
          <div className="data-flow__node data-flow__node--private">
            <Database size={20} />
            <span>Private passport</span>
            <strong>Raw portfolio witness</strong>
          </div>
          <ArrowRight className="data-flow__arrow" aria-hidden="true" />
          <div className="data-flow__node data-flow__node--proof">
            <LockKeyhole size={20} />
            <span>Sealed proof</span>
            <strong>Policy results only</strong>
          </div>
          <ArrowRight className="data-flow__arrow" aria-hidden="true" />
          <div className="data-flow__node">
            <Landmark size={20} />
            <span>Capital provider</span>
            <strong>Verify and offer</strong>
          </div>
        </div>
        <div className="flow-legend">
          <span><i className="legend-dot legend-dot--private" />Private financial inputs</span>
          <span><i className="legend-dot legend-dot--proof" />Narrow verification output</span>
          <span><i className="legend-dot" />Public or counterparty-visible actions</span>
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Execution boundaries"
        title="What happens where"
        intro="Privacy depends on the full path—not only the proof payload. Evaluation is local, but the read that feeds it is not: the balance and price calls go through a server we operate, which therefore sees the address and the values."
      >
        <div className="boundary-grid">
          {boundaries.map((boundary) => (
            <article className="boundary-card" key={boundary.label}>
              <span className="icon-tile">{boundary.icon}</span>
              <span className="section-label">{boundary.label}</span>
              <h3>{boundary.title}</h3>
              <ul className="check-list">
                {boundary.items.map((item) => <li key={item}><Check size={15} />{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </ContentSection>

      <ContentSection
        eyebrow="Protocol roles"
        title="Three layers, three different jobs"
      >
        <div className="role-grid">
          <article>
            <Fingerprint size={24} />
            <div><span className="section-label">ENS</span><h3>Portable identity anchor</h3></div>
            <p>Links the request to a human-readable identity. ENS records are public and should never be treated as private storage.</p>
          </article>
          <article>
            <Network size={24} />
            <div><span className="section-label">Portfolio data</span><h3>Private underwriting input</h3></div>
            <p>Balances from Solana mainnet RPC, prices from Jupiter—both keyless, no vendor account. Only the nine mints on the allowlist committed in this repo count. Account age comes from a bounded signature scan that reports “cannot establish” rather than guessing.</p>
          </article>
          <article>
            <ShieldCheck size={24} />
            <div><span className="section-label">Proof layer</span><h3>Minimal verification output</h3></div>
            <p>Discloses one outcome per claim and nothing else—the browser proves a BN254 Groth16 statement over a snapshot that never leaves the tab. The trusted setup is single-party, so this shows the mechanism, not a security guarantee, and it says nothing about repayment, future solvency, or the correctness of the source data.</p>
          </article>
        </div>
      </ContentSection>

      <aside className="prototype-banner">
        <span className="prototype-banner__mark">LIVE</span>
        <div>
          <strong>What is live</strong>
          <p>Balances are read from Solana mainnet, ENS is read and written on Sepolia from your own wallet, and every request, policy, proof, offer and loan is a real row in the marketplace backend. The proof is a BN254 Groth16 proof produced in the browser, verified by the server and again by the <code>private_credit</code> program on chain, which spends a nullifier and releases the escrow to a one-time ENS-derived address. Still to do: a multi-party trusted setup, real USDC, and per-party wallet signing for the Solana leg.</p>
        </div>
      </aside>

      <PageCta
        eyebrow="See both sides"
        title="Run the workflow as applicant and provider."
        body="The prepared scenario makes every disclosure boundary and decision visible."
        primary={{ view: "borrower", label: "Request credit" }}
        secondary={{ view: "lender", label: "Provide capital" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
