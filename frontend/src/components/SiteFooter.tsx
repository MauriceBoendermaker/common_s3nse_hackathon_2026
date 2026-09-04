import { ArrowUpRight, Github } from "lucide-react";
import { FOOTER_NAVIGATION, type SiteView } from "../config/navigation";
import { PRODUCT_CONFIG } from "../config/product";
import { RouteLink } from "./RouteLink";
import { BrandMark } from "./ui";

type SiteFooterProps = {
  onNavigate: (view: SiteView) => void;
};

export function SiteFooter({ onNavigate }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__main">
          <div className="footer-brand">
            <RouteLink view="overview" onNavigate={onNavigate} className="footer-brand__lockup">
              <BrandMark />
              <strong>{PRODUCT_CONFIG.name}</strong>
            </RouteLink>
            <p>A private credit marketplace on Solana, anchored to ENS.</p>
            <a
              className="footer-github"
              href="https://github.com/MauriceBoendermaker/common_s3nse_hackathon_2026"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={15} /> View source <ArrowUpRight size={13} />
            </a>
          </div>

          {Object.entries(FOOTER_NAVIGATION).map(([group, items]) => (
            <nav className="footer-nav" aria-label={`${group} links`} key={group}>
              <span>{group}</span>
              {items.map((item) => (
                <RouteLink key={item.view} view={item.view} onNavigate={onNavigate}>
                  {item.label}
                </RouteLink>
              ))}
            </nav>
          ))}

          <div className="footer-status">
            <span>Status</span>
            <strong><i aria-hidden="true" />Live on {PRODUCT_CONFIG.network}</strong>
            <p>Portfolios are read from Solana mainnet, proofs are Groth16 and verified on chain by the private_credit program, and ENS is read and written on Sepolia from your wallet. Unaudited; no real funds.</p>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>Built for Common S3nse 2026</span>
          <span>Experimental · Unaudited · No real funds</span>
        </div>
      </div>
    </footer>
  );
}
