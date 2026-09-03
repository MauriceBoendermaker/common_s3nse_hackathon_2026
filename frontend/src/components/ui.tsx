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
