import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  Clock3,
  Code2,
  FileKey2,
  Fingerprint,
  Gauge,
  Landmark,
  LockKeyhole,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import type { SiteView } from "../../config/navigation";
import { PRODUCT_CONFIG } from "../../config/product";
import { RouteLink } from "../RouteLink";
import { ContentHero, ContentSection, PageCta } from "./ContentPageShell";

const borrowerSteps = [
  ["Connect an identity", "Sign with an EVM wallet and confirm the ENS identity attached to the request."],
  ["Select evidence sources", "Choose which supported portfolio and lending sources may contribute to the private snapshot."],
  ["Review public terms", "Confirm the amount, term, asset, and first-loss deposit that providers will see."],
  ["Generate a policy-bound proof", "Evaluate the requested claims without sending exact portfolio values to the provider."],
  ["Publish the request", "Share public terms, proof metadata, and the sealed verification payload."],
  ["Compare and choose", "Review APR, fees, deposit requirements, and provider identity before accepting an offer."],
];

const providerSteps = [
  ["Inspect public terms", "Review requested amount, asset, duration, deposit, and applicant ENS identity."],
  ["Configure a challenge", "Choose thresholds for assets, leverage, account history, and restricted exposure."],
  ["Verify sealed claims", "Receive one result per claim and reject expired, malformed, or policy-mismatched proofs."],
  ["Perform independent underwriting", "Assess credit, liquidity, legal, operational, and counterparty risks beyond the proof."],
  ["Price and fund", "Return an APR, fees, deposit, term, and expiry for the applicant to compare."],
  ["Monitor settlement", "Track acceptance, drawdown, repayment, and exception states in the target lifecycle."],
];

function NumberedJourney({ steps }: { steps: string[][] }) {
  return (
    <ol className="audience-journey">
      {steps.map(([title, body], index) => (
        <li key={title}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><h3>{title}</h3><p>{body}</p></div>
        </li>
      ))}
    </ol>
  );
}

export function ForBorrowersPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow="For borrowers"
        title="Ask for credit without handing over your portfolio."
        lead="Prove the eligibility facts a capital provider needs, keep exact positions out of the request, and compare offers against one consistent set of public terms."
        aside={
          <div className="audience-hero-card">
            <span className="audience-hero-card__icon"><LockKeyhole size={22} /></span>
            <strong>Applicant-controlled disclosure</strong>
            <p>Public terms and narrow claim results go forward. Raw financial inputs do not.</p>
            <ul>
              <li><Check size={14} /> No balance spreadsheet</li>
              <li><Check size={14} /> No transaction-graph handoff</li>
              <li><Check size={14} /> One proof expiry</li>
            </ul>
          </div>
        }
      >
        <RouteLink view="borrower" onNavigate={onNavigate} className="button button--primary">
          <span>Request credit</span><span className="button__icon"><ArrowRight size={16} /></span>
        </RouteLink>
        <RouteLink view="how-it-works" onNavigate={onNavigate} className="text-link">
          Follow the full flow <ArrowRight size={15} />
        </RouteLink>
      </ContentHero>

      <ContentSection eyebrow="Why it matters" title="A smaller disclosure surface">
        <div className="benefit-grid">
          <article><Fingerprint size={23} /><h3>Portable identity</h3><p>Use an ENS identity as a consistent public anchor while changing the private evidence behind each request.</p></article>
          <article><ShieldCheck size={23} /><h3>Policy-specific proof</h3><p>Answer the thresholds that matter for this request instead of exposing a reusable financial dossier.</p></article>
          <article><BarChart3 size={23} /><h3>Comparable offers</h3><p>Evaluate APR, fees, deposit, term, and provider identity from one shared request.</p></article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Before you begin" title="Prototype prerequisites">
        <div className="prerequisite-list">
          <div><WalletCards size={19} /><span><strong>EVM wallet</strong><small>The demo simulates MetaMask-style confirmations and Sepolia network switching.</small></span></div>
          <div><Fingerprint size={19} /><span><strong>ENS-compatible identity</strong><small>The prepared scenario uses {PRODUCT_CONFIG.borrower.ensName}; ENS records themselves remain public.</small></span></div>
          <div><FileKey2 size={19} /><span><strong>Eligible evidence</strong><small>Supported sources must cover the claims a provider requests. Current source values are fixtures.</small></span></div>
          <div><Scale size={19} /><span><strong>Risk awareness</strong><small>A passing proof is not approval, a promise of funding, or a recommendation to borrow.</small></span></div>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Application journey" title="From identity to applicant decision">
        <NumberedJourney steps={borrowerSteps} />
      </ContentSection>

      <ContentSection
        eyebrow="Counterparty view"
        title="What the capital provider sees"
        intro="The provider receives enough context to apply a policy and price an offer—not a copy of the portfolio."
      >
        <div className="visibility-comparison">
          <article>
            <span className="visibility-comparison__label"><BadgeCheck size={16} /> Shared</span>
            <ul>
              <li>ENS applicant identity</li>
              <li>Amount, asset, term, and deposit</li>
              <li>Claim labels and pass/fail results</li>
              <li>Proof identifier, policy binding, and expiry</li>
              <li>Applicant’s offer decision</li>
            </ul>
          </article>
          <article className="is-private">
            <span className="visibility-comparison__label"><LockKeyhole size={16} /> Not shared</span>
            <ul>
              <li>Exact assets and liabilities</li>
              <li>Wallet-by-wallet balances</li>
              <li>Positions, protocols, and counterparties</li>
              <li>Complete transaction graph</li>
              <li>Unused source data</li>
            </ul>
          </article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Validity window" title="Proofs are snapshots, not permanent passports">
        <div className="expiry-panel">
          <Clock3 size={25} />
          <div>
            <h3>Every proof needs an expiry and a policy binding</h3>
            <p>A provider should reject an expired proof, a proof generated for another policy, or a proof whose source coverage cannot be confirmed. The prepared receipt is valid until <strong>{PRODUCT_CONFIG.borrower.proofValidUntil}</strong>.</p>
          </div>
        </div>
      </ContentSection>

      <ContentSection eyebrow="After an offer" title="The applicant keeps the final decision">
        <div className="after-offer-grid">
          <article><span>01</span><h3>Compare</h3><p>Check total repayment—not APR alone—including fees and deposit requirements.</p></article>
          <article><span>02</span><h3>Accept or decline</h3><p>Confirm provider identity, offer expiry, settlement terms, and wallet action before signing.</p></article>
          <article><span>03</span><h3>Settle responsibly</h3><p>Draw and repay only through verified contracts in a production system. These actions are simulated here.</p></article>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Prepared applicant flow"
        title="Create the private request step by step."
        body="The demo makes public terms, proof status, offers, and lifecycle states explicit."
        primary={{ view: "borrower", label: "Start borrower demo" }}
        secondary={{ view: "faq", label: "Read the FAQ" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export function ForCapitalProvidersPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow="For capital providers"
        title="Underwrite the claim, not the applicant’s entire wallet history."
        lead="Define a transparent policy, verify narrow eligibility results, and retain responsibility for every risk that a zero-knowledge proof does not cover."
        aside={
          <div className="policy-preview-card">
            <span className="section-label">Example policy</span>
            <div><span>Minimum assets</span><strong>$100k</strong></div>
            <div><span>Maximum debt ratio</span><strong>40%</strong></div>
            <div><span>Account history</span><strong>12+ mo</strong></div>
            <div><span>Restricted exposure</span><strong>Clean</strong></div>
          </div>
        }
      >
        <RouteLink view="lender" onNavigate={onNavigate} className="button button--primary">
          <span>Open provider workspace</span><span className="button__icon"><ArrowRight size={16} /></span>
        </RouteLink>
        <RouteLink view="security" onNavigate={onNavigate} className="text-link">
          Review trust assumptions <ArrowRight size={15} />
        </RouteLink>
      </ContentHero>

      <ContentSection eyebrow="Underwriting flow" title="A policy-led provider workflow">
        <NumberedJourney steps={providerSteps} />
      </ContentSection>

      <ContentSection
        eyebrow="Policy controls"
        title="Configure the questions the proof must answer"
        intro="The prototype exposes four controls. A production policy should also define version, source coverage, time window, expiry, and failure behavior."
      >
        <div className="policy-control-grid">
          <article><Gauge size={21} /><span>Minimum portfolio assets</span><strong>$50k–$500k</strong><p>Point-in-time eligible assets, subject to source and valuation rules.</p></article>
          <article><BarChart3 size={21} /><span>Maximum debt ratio</span><strong>30%–50%</strong><p>A leverage threshold; not a guarantee against future borrowing.</p></article>
          <article><Clock3 size={21} /><span>Minimum account history</span><strong>6–18 months</strong><p>Evidence duration based on supported source coverage.</p></article>
          <article><ShieldCheck size={21} /><span>Restricted exposure</span><strong>Required / off</strong><p>A screening claim whose definitions and lists must be governed.</p></article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Verification semantics" title="Read each result precisely">
        <div className="semantics-grid">
          <article>
            <span className="semantics-mark semantics-mark--pass"><Check size={18} /></span>
            <h3>Satisfied</h3>
            <p>The witness met the encoded threshold for the bound policy and snapshot. Exact values remain undisclosed.</p>
          </article>
          <article>
            <span className="semantics-mark semantics-mark--fail">×</span>
            <h3>Not satisfied</h3>
            <p>The threshold failed. Do not infer the applicant’s exact value or how far it was from the requirement.</p>
          </article>
          <article>
            <span className="semantics-mark semantics-mark--unknown">?</span>
            <h3>Unavailable</h3>
            <p>Missing coverage, stale inputs, an expired proof, or a verification error is not equivalent to either pass or fail.</p>
          </article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Provider responsibility" title="Risks that remain yours">
        <div className="responsibility-panel">
          <SlidersHorizontal size={25} />
          <div>
            <h3>A proof is evidence—not an underwriting department</h3>
            <ul className="check-list">
              <li><Check size={15} />Validate identity, authority, jurisdiction, and counterparty terms.</li>
              <li><Check size={15} />Define accepted sources, valuations, timestamps, and unknown-state handling.</li>
              <li><Check size={15} />Assess repayment capacity, liquidity, collateral, fraud, and concentration risk.</li>
              <li><Check size={15} />Verify contracts, approvals, offer expiry, and settlement behavior independently.</li>
            </ul>
          </div>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Integration paths" title="Start with the workspace; design for verification anywhere">
        <div className="integration-table">
          <div><span><Landmark size={19} />Hosted workspace</span><strong className="status-label status-label--success">Demo available</strong><p>Review requests, configure policies, verify fixture proofs, and return simulated offers.</p></div>
          <div><span><Code2 size={19} />Verifier contract</span><strong className="status-label status-label--warning">Target design</strong><p>Verify proof and public inputs from an onchain settlement or lending contract.</p></div>
          <div><span><FileKey2 size={19} />API / SDK</span><strong className="status-label status-label--neutral">Planned</strong><p>Create policy challenges and consume typed verification results in an existing underwriting stack.</p></div>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Prepared provider flow"
        title="Apply a policy to the sample request."
        body="See sealed claims, verification outcomes, offer pricing, and applicant handoff in one workflow."
        primary={{ view: "lender", label: "Launch provider demo" }}
        secondary={{ view: "risk-disclosures", label: "Review the risks" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
