import { PRIMARY_NAVIGATION } from "../config/navigation";
import { PRODUCT_CONFIG } from "../config/product";
import type { AppView } from "../state/demo";
import { BrandMark } from "./ui";

type SiteFooterProps = {
  onNavigate: (view: AppView) => void;
};

export function SiteFooter({ onNavigate }: SiteFooterProps) {
  const navigate = (view: AppView) => {
    onNavigate(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__main">
          <div className="footer-brand">
            <button type="button" className="footer-brand__lockup" onClick={() => navigate("overview")}>
              <BrandMark />
              <strong>{PRODUCT_CONFIG.name}</strong>
            </button>
            <p>Privacy-preserving eligibility proofs for DeFi credit.</p>
          </div>

          <nav className="footer-nav" aria-label="Footer navigation">
            <span>Product</span>
            {PRIMARY_NAVIGATION.map((item) => (
              <button key={item.view} type="button" onClick={() => navigate(item.view)}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="footer-status">
            <span>Prototype status</span>
            <strong><i aria-hidden="true" />{PRODUCT_CONFIG.network} demo</strong>
            <p>ZK proof generation and fund settlement are simulated.</p>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>Built for Common S3nse 2026</span>
          <span>No proof or funds move onchain</span>
        </div>
      </div>
    </footer>
  );
}
