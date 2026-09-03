import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Fingerprint } from "lucide-react";

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
      <Fingerprint size={18} strokeWidth={1.8} />
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
