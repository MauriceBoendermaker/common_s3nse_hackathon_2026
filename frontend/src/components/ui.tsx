import { ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

const classNames = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "dark";
  icon?: ReactNode;
};

export function Button({
  variant = "primary",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames("button", `button--${variant}`, className)}
      {...props}
    >
      <span>{children}</span>
      {icon ? <span className="button__icon">{icon}</span> : null}
    </button>
  );
}

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "section" | "div";
};

export function Card({ as: Element = "section", className, ...props }: CardProps) {
  return <Element className={classNames("card", className)} {...props} />;
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "dark" | "warning" | "danger";
}) {
  return <span className={classNames("status-pill", `status-pill--${tone}`)}>{children}</span>;
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 44 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          className="brand-mark__inputs"
          d="M2 5.5h7.5L18 14M2 16h12M2 26.5h7.5L18 18"
        />
        <path
          className="brand-mark__gate"
          d="m18 11.5 4.5-4.5 4.5 4.5v9L22.5 25 18 20.5v-9Z"
        />
        <path className="brand-mark__output" d="M27 16h12" />
        <circle className="brand-mark__node" cx="41" cy="16" r="2" />
      </svg>
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/**
 * A collapsed drawer for the evidence behind a claim.
 *
 * This app has an unusual amount of load-bearing detail: raw `text(node, key)`
 * return values, per-mint holdings, the exact bindings the verifier re-checked,
 * seven public signals. All of it is the answer to "how do I know this isn't
 * hard-coded?", so none of it can be deleted — but rendered flat it buries the
 * one sentence that actually says what happened, and a reader who has to skim
 * paragraphs of cryptography to find the button stops reading.
 *
 * So: the claim stays in the open, the proof of the claim goes in here. Native
 * `<details>` on purpose — it is keyboard-accessible, findable by the browser's
 * in-page search in modern engines, and needs no state.
 */
export function Disclosure({
  summary,
  count,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  /** Optional right-aligned hint, e.g. "4 reads" or "7 signals". */
  count?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={classNames("disclosure", className)} open={defaultOpen}>
      <summary className="disclosure__summary">
        <ChevronRight size={14} className="disclosure__chevron" aria-hidden="true" />
        <span className="disclosure__label">{summary}</span>
        {count ? <span className="disclosure__count">{count}</span> : null}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}

/**
 * The one-line answer at the top of a panel: what state this thing is in, in
 * plain language, before any of the machinery that produced it.
 */
export function Verdict({
  tone = "neutral",
  icon,
  title,
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "pending";
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={classNames("verdict", `verdict--${tone}`)}>
      {icon ? <span className="verdict__icon">{icon}</span> : null}
      <div className="verdict__text">
        <strong>{title}</strong>
        {children ? <span>{children}</span> : null}
      </div>
    </div>
  );
}
