/**
 * The header.
 *
 * The old "Demo · Sepolia" pill was a constant string, and next to it sat a
 * "Connect wallet" button that connected to nothing. Both are gone.
 *
 * What sits there now is the live state of THIS tab's long-poll plus the short
 * form of the session id the server issued it. Open the applicant workspace in
 * one tab and the provider workspace in another and the two pills read
 * different ids — which is the entire trust-boundary claim, demonstrated in one
 * glance rather than asserted in a paragraph.
 */

import { ArrowRight, Menu, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  APP_NAVIGATION,
  isApplicationView,
  PUBLIC_NAVIGATION,
  type SiteView,
} from "../config/navigation";
import { PRODUCT_CONFIG } from "../config/product";
import type { ConnectionStatus } from "../shared/useProtocolState";
import { usePartyStatus } from "../state/connectionStatus";
import { shortId } from "../state/shortId";
import { RouteLink } from "./RouteLink";
import { BrandMark, Button, Spinner, StatusPill } from "./ui";

type AppHeaderProps = {
  view: SiteView;
  resetting: boolean;
  onNavigate: (view: SiteView) => void;
  onReset: () => void;
};

const CONNECTION_COPY: Record<ConnectionStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  connecting: { label: "connecting", tone: "neutral" },
  live: { label: "live", tone: "success" },
  reconnecting: { label: "reconnecting", tone: "warning" },
  error: { label: "offline", tone: "danger" },
};

export function AppHeader({ view, resetting, onNavigate, onReset }: AppHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const appView = isApplicationView(view);
  const navigation = appView ? APP_NAVIGATION : PUBLIC_NAVIGATION;
  const party = usePartyStatus();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [view]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const connection = party ? CONNECTION_COPY[party.connection] : null;

  return (
    <header className="app-header">
      <div className="header-inner">
        <RouteLink view="overview" onNavigate={onNavigate} className="brand">
          <BrandMark />
          <span>{PRODUCT_CONFIG.name}</span>
        </RouteLink>

        <nav
          className={`primary-nav${appView ? " primary-nav--app" : " primary-nav--public"}`}
          aria-label={appView ? "Application areas" : "Main navigation"}
        >
          {navigation.map((item) => (
            <RouteLink
              key={item.view}
              view={item.view}
              onNavigate={onNavigate}
              className={view === item.view ? "is-active" : undefined}
              ariaCurrent={view === item.view ? "page" : undefined}
            >
              {item.label}
            </RouteLink>
          ))}
        </nav>

        <div className="header-actions">
          {party && connection ? (
            <StatusPill tone={connection.tone}>
              <span className={`network-dot network-dot--${party.connection}`} aria-hidden="true" />
              {connection.label} · {party.role}{" "}
              <code className="session-chip">
                {party.sessionId ? shortId(party.sessionId) : "no session"}
              </code>
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">
              <span className="network-dot" aria-hidden="true" />
              Reads Solana mainnet · settles {PRODUCT_CONFIG.settleCluster.replace("Solana ", "")}
            </StatusPill>
          )}

          {appView ? (
            <Button
              variant="secondary"
              className="wallet-button"
              disabled={resetting}
              onClick={onReset}
              icon={resetting ? <Spinner /> : <RotateCcw size={15} />}
            >
              {resetting ? "Resetting" : "Reset"}
            </Button>
          ) : (
            <RouteLink
              view="borrower"
              onNavigate={onNavigate}
              className="button button--dark header-launch"
            >
              <span>Open the market</span>
              <span className="button__icon">
                <ArrowRight size={15} />
              </span>
            </RouteLink>
          )}

          {!appView ? (
            <button
              type="button"
              className="mobile-menu-button"
              aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          ) : null}
        </div>
      </div>

      {mobileMenuOpen && !appView ? (
        <nav className="mobile-navigation" id="mobile-navigation" aria-label="Mobile navigation">
          {PUBLIC_NAVIGATION.map((item) => (
            <RouteLink
              key={item.view}
              view={item.view}
              onNavigate={onNavigate}
              className={view === item.view ? "is-active" : undefined}
              ariaCurrent={view === item.view ? "page" : undefined}
            >
              {item.label}
              <ArrowRight size={15} />
            </RouteLink>
          ))}
          <RouteLink view="about" onNavigate={onNavigate}>
            About
            <ArrowRight size={15} />
          </RouteLink>
        </nav>
      ) : null}
    </header>
  );
}
