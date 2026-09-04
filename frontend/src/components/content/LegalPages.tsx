import { AlertTriangle, FileText, Scale, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { SiteView } from "../../config/navigation";
import { RouteLink } from "../RouteLink";
import { ContentHero } from "./ContentPageShell";

const updated = "3 September 2026";

function LegalLayout({
  eyebrow,
  title,
  lead,
  icon,
  children,
  onNavigate,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  icon: ReactNode;
  children: ReactNode;
  onNavigate: (view: SiteView) => void;
}) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow={eyebrow}
        title={title}
        lead={lead}
        aside={<div className="legal-mark">{icon}<span>Last updated</span><strong>{updated}</strong></div>}
      />
      <div className="legal-layout">
        <aside className="legal-nav" aria-label="Legal pages">
          <span className="section-label">Legal</span>
          <RouteLink view="privacy" onNavigate={onNavigate}>Privacy notice</RouteLink>
          <RouteLink view="terms" onNavigate={onNavigate}>Terms of use</RouteLink>
          <RouteLink view="risk-disclosures" onNavigate={onNavigate}>Risk disclosures</RouteLink>
          <RouteLink view="security" onNavigate={onNavigate}>Security & trust</RouteLink>
        </aside>
        <article className="legal-copy">{children}</article>
      </div>
    </div>
  );
}

export function PrivacyPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <LegalLayout
      eyebrow="Legal · Privacy"
      title="Privacy notice"
      lead="This notice describes the current hackathon prototype—not a production service with user accounts, lending operations, or persistent portfolio storage. It does read real balances from a public blockchain for an address you supply, so read section 2."
      icon={<ShieldCheck size={28} />}
      onNavigate={onNavigate}
    >
      <section>
        <h2>1. Prototype scope</h2>
        <p>Private Credit is an experimental application created for Common S3nse 2026. No real loan application is submitted and no real money is involved: settlement happens on a Solana test cluster, in a token this project minted, signed by operator keypairs the backend holds. Portfolio balances, by contrast, are read for real from Solana mainnet, ENS names are resolved for real on Sepolia, and the marketplace records that pass between the two parties are held by a backend we operate.</p>
      </section>
      <section>
        <h2>2. Information used by the app</h2>
        <p>The address you supply is sent to our backend, which reads its balances from Solana mainnet RPC and prices them through Jupiter. That address, the values read for it, and the timing and network metadata of the request are visible to us. The resulting snapshot is returned to your browser and no endpoint accepts it back. Identities, policies, offers, and loan terms shown alongside it are demonstration values.</p>
      </section>
      <section>
        <h2>3. Storage and retention</h2>
        <p>Two tiers. The portfolio snapshot and the witness derived from it exist only in your browser’s memory: they are never persisted and never sent back to the backend. The marketplace records—requests, policy challenges, proof receipts, offers, and loan lifecycle states—are kept in an in-memory store inside the backend process, are deliberately readable by both parties, contain no portfolio values, and are lost when the process restarts. There is no user account and no database. This does not override logs that a hosting platform, browser, network, or development environment may retain.</p>
      </section>
      <section>
        <h2>4. Public and third-party visibility</h2>
        <p>ENS records and blockchain transactions are public. The backend we operate, the Solana RPC endpoints it calls, the Jupiter price API, and any hosting or analytics layer can observe public identifiers, IP addresses, timestamps, request metadata, and query patterns even when portfolio values are hidden from a capital provider. The Solana address a snapshot was read from also travels with the published request, in the provenance strip.</p>
      </section>
      <section>
        <h2>5. No promise of anonymity</h2>
        <p>Zero-knowledge techniques can minimize the contents disclosed by a proof. They do not make a browser session anonymous, erase previously published information, hide public chain activity, or prevent correlation by counterparties and infrastructure operators.</p>
      </section>
      <section>
        <h2>6. Production changes</h2>
        <p>Any production release would require a new notice describing actual controllers, processors, purposes, legal bases, retention periods, security measures, user rights, and contact details. This prototype notice should not be relied on for a future deployment.</p>
      </section>
      <section>
        <h2>7. Contact</h2>
        <p>Questions about the repository or this notice can be raised through the project’s public GitHub issue tracker linked from the About page.</p>
      </section>
    </LegalLayout>
  );
}

export function TermsPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <LegalLayout
      eyebrow="Legal · Terms"
      title="Terms of use"
      lead="Use this experimental prototype for evaluation and demonstration only. It is not a lending platform, financial product, or production security system."
      icon={<FileText size={28} />}
      onNavigate={onNavigate}
    >
      <section>
        <h2>1. Acceptance and purpose</h2>
        <p>By using this prototype, you acknowledge that it is provided solely to demonstrate a possible privacy-preserving credit workflow. Do not use it to make, fund, accept, service, or settle a real loan.</p>
      </section>
      <section>
        <h2>2. Experimental status</h2>
        <p>The software is incomplete, unaudited, and subject to change. Balances are read live from Solana mainnet, ENS names are resolved live on Sepolia, and requests, challenges, receipts, offers, and lifecycle states are real records in a backend store. The receipt is a real BN254 Groth16 proof, generated in the browser, verified by the backend, and verified again on chain by a deployed Anchor program that also recomputes the policy hash, spends a nullifier account and moves an SPL escrow to a one-time payout address. It is produced under a development trusted setup rather than a real ceremony &mdash; whoever ran that ceremony could forge proofs that verify, on chain included. The Groth16 verifier the program uses is itself unaudited. Settlement is on a test cluster, in a token we minted, signed by custodial demo keypairs rather than by user wallets.</p>
      </section>
      <section>
        <h2>3. No financial, legal, or tax advice</h2>
        <p>Nothing in the interface or documentation is financial, investment, credit, legal, compliance, accounting, or tax advice. Eligibility results are not recommendations, credit approvals, or guarantees of funding or repayment.</p>
      </section>
      <section>
        <h2>4. Non-custodial target; no current custody</h2>
        <p>The prototype does not custody assets because it cannot move funds. The intended architecture is non-custodial, but that description cannot be treated as a production guarantee until deployed contracts, permissions, upgrade controls, and operational processes are reviewed.</p>
      </section>
      <section>
        <h2>5. User responsibilities</h2>
        <p>You are responsible for protecting your wallet and device, reviewing every signature, confirming network and contract addresses, understanding public-chain visibility, and obtaining professional advice before any real financial activity.</p>
      </section>
      <section>
        <h2>6. Prohibited reliance</h2>
        <p>Do not rely on the prototype for identity verification, sanctions screening, credit scoring, portfolio valuation, security assurance, regulatory compliance, or loss prevention.</p>
      </section>
      <section>
        <h2>7. Disclaimer</h2>
        <p>The prototype is provided “as is” without warranties of availability, accuracy, security, fitness, non-infringement, or suitability for any purpose. To the maximum extent permitted by law, contributors are not liable for losses arising from use or reliance.</p>
      </section>
    </LegalLayout>
  );
}

export function RiskDisclosuresPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <LegalLayout
      eyebrow="Legal · Risk disclosures"
      title="Risk disclosures"
      lead="Private credit, blockchains, data providers, and zero-knowledge systems each introduce risks. A proof narrows disclosure; it does not remove those risks."
      icon={<AlertTriangle size={28} />}
      onNavigate={onNavigate}
    >
      <div className="legal-alert"><Scale size={21} /><p><strong>Important:</strong> this is a non-exhaustive educational summary for an unaudited prototype, not a substitute for professional due diligence.</p></div>
      <section>
        <h2>1. Credit and liquidity risk</h2>
        <p>Borrowers may be unable to repay. Capital providers may lose some or all deployed capital. A passing eligibility proof cannot predict future asset values, borrowing, cash flow, fraud, liquidation, or willingness to repay. The claims measured here describe what a portfolio holds; they say nothing about what is owed against it, which is not read at all.</p>
      </section>
      <section>
        <h2>2. Proof-system risk</h2>
        <p>Circuit, witness, setup, parameter, cryptographic, verifier, or integration defects could produce incorrect or unverifiable results. Zero-knowledge proofs are generated in the browser and verified by the backend, but under a development trusted setup: two phase-2 contributions on one machine, so whoever ran the ceremony could forge proofs. Nothing here has been independently audited.</p>
      </section>
      <section>
        <h2>3. Smart-contract and wallet risk</h2>
        <p>Future contracts could contain defects or unsafe upgrade controls. Wallet compromise, malicious approvals, wrong-network actions, address substitution, and irreversible transactions can cause loss. No production contracts are offered here.</p>
      </section>
      <section>
        <h2>4. Data, valuation, and oracle risk</h2>
        <p>Provider data may be stale, incomplete, duplicated, manipulated, unavailable, or valued differently from authoritative chain state. Prices come from a single quote source and thin-liquidity mints are unreliable. Only allowlisted mints are counted, so a portfolio can be worth far more than the figure the claims are computed over. Unsupported assets and positions remain unknown rather than being assumed absent. Nothing in this build attests that the address supplied belongs to the applicant.</p>
      </section>
      <section>
        <h2>5. Privacy and metadata risk</h2>
        <p>Public ENS records, transaction graphs, timing, IP addresses, request terms, proof reuse, and provider queries can support correlation. The backend that proxies the portfolio read sees both the address and the values read for it, and that address is published with the request in the provenance strip. Zero-knowledge protection of a witness is not equivalent to network anonymity or deletion of historical exposure.</p>
      </section>
      <section>
        <h2>6. Counterparty and operational risk</h2>
        <p>Applicants and providers may misrepresent authority, intent, jurisdiction, or terms. Service outages, key loss, provider failure, governance decisions, and human error may block verification or settlement.</p>
      </section>
      <section>
        <h2>7. Regulatory, legal, and tax risk</h2>
        <p>Credit, privacy, identity, financial-promotion, securities, sanctions, consumer-protection, and tax rules vary and may change. A technically valid transaction may still be restricted or create obligations for each party.</p>
      </section>
      <section>
        <h2>8. Prototype risk</h2>
        <p>Settlement runs on a Solana test cluster against an unaudited program, using a token this project minted and operator keypairs the backend holds; the backend itself is a single unaudited process operated by the project authors. Interface states may not represent the failure modes, latency, costs, finality, or adversarial conditions of a real deployment.</p>
      </section>
    </LegalLayout>
  );
}
