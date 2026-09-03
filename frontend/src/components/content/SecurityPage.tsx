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
  ShieldCheck,
  X,
} from "lucide-react";
import type { SiteView } from "../../config/navigation";
import { PrivacyBoundary } from "../PrivacyBoundary";
import { ContentHero, ContentSection, PageCta } from "./ContentPageShell";

const informationRows = [
  {
    category: "Public request",
    revealed: "Amount, asset, term, and first-loss deposit",
    hidden: "Where the applicant’s liquidity is held",
    stored: "Demo state in the current browser tab",
    observable: "Anyone who receives or indexes the request",
  },
  {
    category: "ENS identity",
    revealed: "Selected ENS name and its public records",
    hidden: "Nothing already published through ENS",
    stored: "No separate production identity database exists",
    observable: "RPC operators and public chain observers",
  },
  {
    category: "Portfolio evidence",
    revealed: "A pass/fail result for each policy claim",
    hidden: "Exact balances, positions, protocols, and graph",
    stored: "Fixture values in this frontend prototype",
    observable: "A live data provider could observe queries and metadata",
  },
  {
    category: "Offer and settlement",
    revealed: "Provider, APR, fees, deposit, term, and status",
    hidden: "No extra portfolio detail is unlocked by an offer",
    stored: "In-memory demo state until reset or reload",
    observable: "Counterparties; public networks in a future onchain flow",
  },
];

const assumptions = [
  {
    icon: <HardDrive size={20} />,
    title: "Applicant environment",
    body: "The wallet, browser, device, and witness-building environment must not leak or alter private inputs.",
  },
  {
    icon: <Database size={20} />,
    title: "Data-source correctness",
    body: "A proof can faithfully evaluate bad or stale inputs. Adapters and attestations still require validation.",
  },
  {
    icon: <Code2 size={20} />,
    title: "Circuit and verifier",
    body: "The proving circuit, parameters, and verifier must encode the stated policy and resist implementation errors.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Provider judgement",
    body: "Eligibility is one underwriting input. The capital provider remains responsible for pricing and credit risk.",
  },
];

const limitations = [
  "A valid claim describes one policy at one point in time; it does not prove future solvency.",
  "A proof does not guarantee repayment, prevent liquidation, or replace independent underwriting.",
  "Zero knowledge hides the witness—not public ENS records, transaction history, timing, IP, or request metadata.",
  "Previously published or externally correlated information cannot be made private by generating a new proof.",
  "Source outages, stale data, unsupported positions, and incomplete coverage can produce an unavailable or rejected result.",
];

export function SecurityPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
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
              <div><dt>Production contracts</dt><dd><X size={14} /> None</dd></div>
              <div><dt>Independent audit</dt><dd><X size={14} /> Not audited</dd></div>
              <div><dt>Real funds</dt><dd><X size={14} /> Disabled</dd></div>
              <div><dt>Disclosure model</dt><dd className="is-positive"><Check size={14} /> Documented</dd></div>
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
        intro="Zero-knowledge reduces disclosure. It does not eliminate software, infrastructure, or counterparty trust."
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
        title="Current prototype data handling"
      >
        <div className="retention-grid">
          <article>
            <span><HardDrive size={18} /> Browser state</span>
            <h3>Temporary demo session</h3>
            <p>Application state lives in the current browser session and is cleared by reset or reload. There is no user account or production persistence layer.</p>
          </article>
          <article>
            <span><Cloud size={18} /> Service metadata</span>
            <h3>Infrastructure can still see traffic</h3>
            <p>Hosting, RPC, wallet, and portfolio providers may observe requests, IP addresses, timestamps, and queried public identifiers in a live implementation.</p>
          </article>
          <article>
            <span><KeyRound size={18} /> Credentials</span>
            <h3>No secret belongs in the client</h3>
            <p>Production provider credentials must remain server-side, be scoped to their purpose, and never be embedded in a browser bundle or proof receipt.</p>
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
            <p>This hackathon build has no production smart-contract deployment or independent security audit. The displayed proof, verifier reference, wallet confirmations, and settlement states are demonstration fixtures.</p>
          </div>
          <span className="status-label status-label--warning">Prototype only</span>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Verify the boundary"
        title="See exactly what each side receives."
        body="Run the prepared workflow, then review the broader financial and technical risks before treating any result as a credit decision."
        primary={{ view: "borrower", label: "Open the demo" }}
        secondary={{ view: "risk-disclosures", label: "Read risk disclosures" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
