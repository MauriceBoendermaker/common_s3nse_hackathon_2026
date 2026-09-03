import type { MouseEvent, ReactNode } from "react";
import { VIEW_PATHS, type SiteView } from "../config/navigation";

type RouteLinkProps = {
  view: SiteView;
  onNavigate: (view: SiteView) => void;
  children: ReactNode;
  className?: string;
  ariaCurrent?: "page";
};

export function RouteLink({
  view,
  onNavigate,
  children,
  className,
  ariaCurrent,
}: RouteLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onNavigate(view);
  };

  return (
    <a
      href={VIEW_PATHS[view]}
      className={className}
      aria-current={ariaCurrent}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
