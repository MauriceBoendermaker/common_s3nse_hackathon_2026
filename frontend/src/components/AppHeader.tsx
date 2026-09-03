import { Check, ChevronDown, RotateCcw, WalletCards } from "lucide-react";
import { useState } from "react";
import { PRODUCT_CONFIG } from "../config/product";
import type { AppView } from "../state/demo";
import { BrandMark, Button, StatusPill } from "./ui";

type AppHeaderProps = {
  view: AppView;
  walletConnected: boolean;
  onNavigate: (view: AppView) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onReset: () => void;
};

const navigation: Array<{ view: AppView; label: string }> = [
  { view: "overview", label: "Overview" },
  { view: "borrower", label: "Borrower" },
  { view: "lender", label: "Lender" },
];

export function AppHeader({
  view,
  walletConnected,
  onNavigate,
  onConnect,
  onDisconnect,
  onReset,
}: AppHeaderProps) {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="header-inner">
        <button className="brand" type="button" onClick={() => onNavigate("overview")}>
          <BrandMark />
          <span>{PRODUCT_CONFIG.name}</span>
        </button>

        <nav className="primary-nav" aria-label="Product areas">
          {navigation.map((item) => (
            <button
              key={item.view}
              type="button"
              className={view === item.view ? "is-active" : undefined}
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <StatusPill tone="neutral">
            <span className="network-dot" aria-hidden="true" />
            Demo · {PRODUCT_CONFIG.network}
          </StatusPill>

          <div className="wallet-control">
            <Button
              variant={walletConnected ? "secondary" : "dark"}
              className="wallet-button"
              icon={walletConnected ? <ChevronDown size={15} /> : <WalletCards size={16} />}
              aria-expanded={walletMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                if (walletConnected) {
                  setWalletMenuOpen((open) => !open);
                } else {
                  onConnect();
                }
              }}
            >
              {walletConnected ? PRODUCT_CONFIG.borrower.ensName : "Connect wallet"}
            </Button>

            {walletMenuOpen ? (
              <div className="wallet-menu" role="menu">
                <div className="wallet-menu__identity">
                  <span className="wallet-avatar" aria-hidden="true">A</span>
                  <span>
                    <strong>{PRODUCT_CONFIG.borrower.ensName}</strong>
                    <small>{PRODUCT_CONFIG.borrower.walletAddress}</small>
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
                <small className="wallet-menu__note">MetaMask connection is simulated in this frontend.</small>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
