import {
  ArrowUpRight,
  Code2,
  Github,
  HeartHandshake,
  LockKeyhole,
  MessageSquare,
  Network,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { SiteView } from "../../config/navigation";
import { ContentHero, ContentSection, PageCta } from "./ContentPageShell";

const repositoryUrl = "https://github.com/MauriceBoendermaker/common_s3nse_hackathon_2026";
const issuesUrl = `${repositoryUrl}/issues`;

export function AboutPage({ onNavigate }: { onNavigate: (view: SiteView) => void }) {
  return (
    <div className="content-page">
      <ContentHero
        eyebrow="About Private Credit"
        title="Make credit evidence useful without making it public."
        lead="Private Credit explores a simple idea: applicants should be able to prove the facts required by an underwriting policy without surrendering a reusable map of their financial life."
        aside={
          <div className="about-mark">
            <span><Sparkles size={22} /></span>
            <strong>Common S3nse 2026</strong>
            <p>Experimental DeFi credit infrastructure built as a jury-ready hackathon prototype.</p>
          </div>
        }
      />

      <ContentSection eyebrow="Mission" title="Turn disclosure into verification">
        <div className="mission-statement">
          <blockquote>“A lender should learn whether a policy is satisfied—not receive every number used to answer it.”</blockquote>
          <p>The project combines a portable ENS identity, private portfolio evidence, and policy-bound claim results in one end-to-end borrower and capital-provider journey.</p>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Design principles" title="The standards guiding the prototype">
        <div className="principle-grid">
          <article><LockKeyhole size={23} /><span>01</span><h3>Minimize disclosure</h3><p>Share the narrowest output that can support the stated decision.</p></article>
          <article><ShieldCheck size={23} /><span>02</span><h3>Preserve unknowns</h3><p>Missing, stale, and unsupported data must not become a confident result.</p></article>
          <article><Network size={23} /><span>03</span><h3>Show the boundary</h3><p>Document what remains visible to providers, infrastructure, and public networks.</p></article>
          <article><HeartHandshake size={23} /><span>04</span><h3>Keep agency</h3><p>Applicants control source selection and the final offer decision.</p></article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Team" title="Built by a real, accountable contributor">
        <article className="team-card">
          <span className="team-card__avatar"><UserRound size={30} /></span>
          <div className="team-card__identity">
            <span className="section-label">Creator and full-stack prototype owner</span>
            <h3>Maurice Boendermaker</h3>
            <p>Responsible for product framing, interaction design, React and TypeScript implementation, and modelling the borrower-to-provider credit lifecycle in this repository.</p>
            <div className="team-card__skills">
              <span><Code2 size={14} /> Product engineering</span>
              <span><ShieldCheck size={14} /> Privacy UX</span>
              <span><Network size={14} /> Web3 workflows</span>
            </div>
          </div>
          <a href="https://github.com/MauriceBoendermaker" target="_blank" rel="noreferrer" className="external-link">
            GitHub <ArrowUpRight size={15} />
          </a>
        </article>
      </ContentSection>

      <ContentSection eyebrow="Hackathon context" title="Built to make the boundary demonstrable">
        <div className="hackathon-grid">
          <article><strong>Common S3nse 2026</strong><p>The prototype is a focused hackathon submission—not a launched lending service.</p></article>
          <article><strong>Two-sided experience</strong><p>Borrower and provider decisions are shown in the same reproducible scenario.</p></article>
          <article><strong>Open repository</strong><p>The source and product status can be inspected directly rather than inferred from marketing claims.</p></article>
        </div>
      </ContentSection>

      <ContentSection eyebrow="Open development" title="Inspect the work or start a conversation">
        <div className="contact-grid">
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            <Github size={23} />
            <span><strong>View the repository</strong><small>Read the source, history, and current prototype.</small></span>
            <ArrowUpRight size={18} />
          </a>
          <a href={issuesUrl} target="_blank" rel="noreferrer">
            <MessageSquare size={23} />
            <span><strong>Contact via GitHub</strong><small>Open an issue for questions, feedback, or collaboration.</small></span>
            <ArrowUpRight size={18} />
          </a>
        </div>
      </ContentSection>

      <PageCta
        eyebrow="Explore the product"
        title="Start with the story, then test the workflow."
        body="Understand the boundaries before stepping through the prepared private-credit scenario."
        primary={{ view: "how-it-works", label: "See how it works" }}
        secondary={{ view: "security", label: "Read security & trust" }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
