import {
  ArrowRight,
  Building2,
  Fingerprint,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { PRODUCT_CONFIG } from "../config/product";
import type { AppView } from "../state/demo";
import { PrivacyBoundary } from "./PrivacyBoundary";
import { Button } from "./ui";

type HomeViewProps = {
  onStart: (view: Extract<AppView, "borrower" | "lender">) => void;
};

export function HomeView({ onStart }: HomeViewProps) {
  return (
    <div className="home-page" id="top">
      <section className="home-hero">
        <div className="home-copy">
          <span className="eyebrow">{PRODUCT_CONFIG.category}</span>
          <h1>Private DeFi credit, verified with ZK proofs.</h1>
          <p>
            Borrowers prove that they meet a lending policy without exposing balances,
            positions, or wallet history. Their reputation stays portable through ENS.
          </p>

          <div className="hero-actions">
            <Button onClick={() => onStart("borrower")} icon={<ArrowRight size={16} />}>
              I need credit
            </Button>
            <Button
              variant="secondary"
              onClick={() => onStart("lender")}
              icon={<Building2 size={16} />}
            >
              I fund loans
            </Button>
          </div>

          <div className="protocol-signals" aria-label="Protocol foundations">
            <span><span className="signal-icon"><LockKeyhole size={14} /></span>ZK policy proof</span>
            <span><span className="signal-icon"><Fingerprint size={14} /></span>ENS identity</span>
            <span><span className="signal-icon"><UserRound size={14} /></span>No wallet surveillance</span>
          </div>
        </div>

        <PrivacyBoundary />
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="how-heading">
          <span className="eyebrow">One private credit flow</span>
          <h2 id="how-heading">From sealed data to a priced loan.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div><strong>Build a passport</strong><p>Connect financial sources to an ENS identity.</p></div>
          </li>
          <li>
            <span>02</span>
            <div><strong>Generate a ZK proof</strong><p>Prove only the lender’s required thresholds.</p></div>
          </li>
          <li>
            <span>03</span>
            <div><strong>Receive an offer</strong><p>Lenders compete without seeing the raw portfolio.</p></div>
          </li>
        </ol>
      </section>
    </div>
  );
}
