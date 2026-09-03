import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { SiteView } from "../../config/navigation";
import { RouteLink } from "../RouteLink";

export function ContentHero({
  eyebrow,
  title,
  lead,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={aside ? "content-hero content-hero--split" : "content-hero"}>
      <div className="content-hero__copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{lead}</p>
        {children ? <div className="content-hero__actions">{children}</div> : null}
      </div>
      {aside ? <div className="content-hero__aside">{aside}</div> : null}
    </header>
  );
}

export function ContentSection({
  eyebrow,
  title,
  intro,
  children,
  id,
  className,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section className={`content-section${className ? ` ${className}` : ""}`} id={id}>
      <div className="content-section__heading">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {intro ? <p>{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PageCta({
  eyebrow,
  title,
  body,
  primary,
  secondary,
  onNavigate,
}: {
  eyebrow: string;
  title: string;
  body: string;
  primary: { view: SiteView; label: string };
  secondary?: { view: SiteView; label: string };
  onNavigate: (view: SiteView) => void;
}) {
  return (
    <section className="page-cta">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <div className="page-cta__actions">
        {secondary ? (
          <RouteLink view={secondary.view} onNavigate={onNavigate} className="button button--secondary">
            <span>{secondary.label}</span>
          </RouteLink>
        ) : null}
        <RouteLink view={primary.view} onNavigate={onNavigate} className="button button--primary">
          <span>{primary.label}</span>
          <span className="button__icon"><ArrowRight size={16} /></span>
        </RouteLink>
      </div>
    </section>
  );
}
