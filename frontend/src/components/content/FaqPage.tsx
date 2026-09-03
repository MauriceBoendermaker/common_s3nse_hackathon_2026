import { ChevronDown, HelpCircle, MessageCircleQuestion } from "lucide-react";
import type { SiteView } from "../../config/navigation";
import { ContentHero, PageCta } from "./ContentPageShell";

const faqGroups = [
  {
    title: "Access and evidence",
    questions: [
      {
        question: "Which wallets and networks are supported?",
        answer: "The prototype presents an EVM wallet flow and uses Sepolia as its demo network. Wallet connection and network switching are simulated; production wallet compatibility has not been certified.",
      },
      {
        question: "Do I need an ENS name?",
        answer: "The demonstrated journey uses an ENS name as its portable identity anchor. ENS records are public. A production system could support other identity methods, but this prototype has not implemented them.",
      },
      {
        question: "Where does portfolio data come from?",
        answer: "The interface models onchain wallet, lending-history, and optional attestation sources. Values in the current build are fixtures. A production version would need documented adapters, coverage rules, timestamps, and provider-specific failure handling.",
      },
      {
        question: "What happens when a source is missing or unavailable?",
        answer: "The result should remain unavailable or incomplete—not be silently converted into a pass, fail, or zero balance. The applicant may need to reconnect, choose another supported source, or wait for recovery.",
      },
    ],
  },
  {
    title: "Proofs and decisions",
    questions: [
      {
        question: "What does a passing proof establish?",
        answer: "Only that the supplied witness satisfied the encoded claims for a specific policy and snapshot. It does not guarantee repayment, future solvency, data-provider correctness, legal eligibility, or funding.",
      },
      {
        question: "Can one proof be reused with several lenders?",
        answer: "Only when those lenders accept the same policy, source coverage, public inputs, verifier, and validity window. Safer implementations bind proofs to a versioned challenge so reuse cannot change their meaning.",
      },
      {
        question: "Why do proofs expire?",
        answer: "Portfolio and debt conditions change. Expiry limits how long a point-in-time claim can be treated as current. A provider should reject an expired proof and request a new snapshot.",
      },
      {
        question: "What happens if proof generation or verification fails?",
        answer: "A technical failure is an unknown result, not a failed eligibility claim. The product should show whether the cause is expiry, unsupported data, user rejection, malformed inputs, or verifier failure before offering a retry.",
      },
      {
        question: "Why might an eligible applicant still be rejected?",
        answer: "Capital providers remain responsible for liquidity, pricing, jurisdiction, counterparty, concentration, fraud, and repayment risk. Passing the configured claims is necessary only when the provider says it is—not sufficient for approval.",
      },
    ],
  },
  {
    title: "Privacy, cost, and settlement",
    questions: [
      {
        question: "What stays private from the capital provider?",
        answer: "The intended proof hides exact balances, wallet-by-wallet positions, protocols, counterparties, and the transaction graph. Public request terms, ENS records, proof metadata, and claim outcomes remain visible.",
      },
      {
        question: "Does zero knowledge make the whole interaction anonymous?",
        answer: "No. Hosting, RPC, wallet, and portfolio providers may observe IP addresses, timestamps, queries, and public identifiers. ENS and transaction records are public, and counterparties can correlate repeated behavior.",
      },
      {
        question: "What does it cost?",
        answer: "The prototype charges nothing and moves no funds. A production flow could include proof-generation infrastructure, provider, gas, origination, financing, and settlement costs; none are finalized here.",
      },
      {
        question: "Is the product non-custodial?",
        answer: "The current prototype cannot custody anything because it has no live settlement. The target experience is non-custodial, but that claim must be reassessed against the deployed contracts, upgrade controls, approvals, and recovery mechanisms.",
      },
      {
        question: "Are offers and loan settlement live?",
        answer: "No. Offer funding, acceptance, drawdown, repayment, and lifecycle states are simulated. No proof or funds move onchain in this hackathon build.",
      },
    ],
  },
];

export function FaqPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow="Frequently asked questions"
        title="Clear answers before you connect."
        lead="The short version: this is an experimental Sepolia-facing prototype. It demonstrates a privacy boundary and a complete decision flow, not production lending or an audited proof system."
        aside={
          <div className="faq-hero-mark">
            <HelpCircle size={30} />
            <strong>14 answers</strong>
            <span>Across access, proofs, privacy, costs, and settlement.</span>
          </div>
        }
      />

      <div className="faq-groups">
        {faqGroups.map((group) => (
          <section className="faq-group" key={group.title}>
            <div className="faq-group__heading">
              <MessageCircleQuestion size={20} />
              <h2>{group.title}</h2>
            </div>
            <div className="faq-list">
              {group.questions.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<ChevronDown size={18} /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <PageCta
        eyebrow="Still exploring?"
        title="See the answers in context."
        body="The guided demo shows what the applicant publishes and what the provider actually receives."
        primary={{ view: "how-it-works", label: "See how it works" }}
        secondary={{ view: "security", label: "Read security & trust" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
