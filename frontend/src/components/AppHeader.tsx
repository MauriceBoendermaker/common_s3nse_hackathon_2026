import {
  ArrowRight,
  Check,
  ChevronDown,
  Menu,
  RotateCcw,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  APP_NAVIGATION,
  isApplicationView,
  PUBLIC_NAVIGATION,
  type SiteView,
} from "../config/navigation";
import { PRODUCT_CONFIG } from "../config/product";
import { BrandMark, Button, StatusPill } from "./ui";
import { RouteLink } from "./RouteLink";

type AppHeaderProps = {
  view: SiteView;
  walletConnected: boolean;
  walletIdentity: {
    ensName: string;
    walletAddress: string;
  };
  onNavigate: (view: SiteView) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onReset: () => void;
};

export function AppHeader({
  view,
  walletConnected,
  walletIdentity,
  onNavigate,
  onConnect,
  onDisconnect,
  onReset,
}: AppHeaderProps) {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const walletControlRef = useRef<HTMLDivElement>(null);
  const appView = isApplicationView(view);
  const navigation = appView ? APP_NAVIGATION : PUBLIC_NAVIGATION;

  useEffect(() => {
    setMobileMenuOpen(false);
    setWalletMenuOpen(false);
  }, [view]);

  useEffect(() => {
    if (!walletMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!walletControlRef.current?.contains(event.target as Node)) {
        setWalletMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

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
          <StatusPill tone="neutral">
            <span className="network-dot" aria-hidden="true" />
            Demo · {PRODUCT_CONFIG.network}
          </StatusPill>

          {appView ? (
            <div className="wallet-control" ref={walletControlRef}>
              <Button
                variant={walletConnected ? "secondary" : "dark"}
                className="wallet-button"
                icon={walletConnected ? <ChevronDown size={15} /> : <WalletCards size={16} />}
                aria-expanded={walletMenuOpen}
                aria-haspopup="menu"
                aria-controls={walletConnected ? "wallet-menu" : undefined}
                onClick={() => {
                  if (walletConnected) setWalletMenuOpen((open) => !open);
                  else onConnect();
                }}
              >
                {walletConnected ? walletIdentity.ensName : "Connect wallet"}
              </Button>

              {walletMenuOpen ? (
                <div className="wallet-menu" id="wallet-menu" role="menu">
                  <div className="wallet-menu__identity">
                    <span className="wallet-avatar" aria-hidden="true">
                      {walletIdentity.ensName.charAt(0).toUpperCase()}
                    </span>
                    <span>
                      <strong>{walletIdentity.ensName}</strong>
                      <small>{walletIdentity.walletAddress}</small>
                    </span>
                    <Check size={16} className="success-icon" aria-label="Connected" />
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onReset();
                      setWalletMenuOpen(false);
                    }}
                  >
                    <RotateCcw size={15} /> Reset demo
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onDisconnect();
                      setWalletMenuOpen(false);
                    }}
                  >
                    Disconnect
                  </button>
                  <small className="wallet-menu__note">Wallet confirmations are simulated in this frontend.</small>
                </div>
              ) : null}
            </div>
          ) : (
            <RouteLink view="borrower" onNavigate={onNavigate} className="button button--dark header-launch">
              <span>Launch demo</span><span className="button__icon"><ArrowRight size={15} /></span>
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
              {item.label}<ArrowRight size={15} />
            </RouteLink>
          ))}
          <RouteLink view="about" onNavigate={onNavigate}>About<ArrowRight size={15} /></RouteLink>
        </nav>
      ) : null}
    </header>
  );
}
