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
          <h1>Verify credit eligibility without sharing portfolio data.</h1>
          <p>
            Credit applicants prove that they meet a funding policy without exposing
            balances, positions, or wallet history. Their reputation stays portable through ENS.
          </p>

          <div className="hero-actions">
            <Button onClick={() => onStart("borrower")} icon={<ArrowRight size={16} />}>
              Request credit
            </Button>
            <Button
              variant="secondary"
              onClick={() => onStart("lender")}
              icon={<Building2 size={16} />}
            >
              Provide capital
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
          <h2 id="how-heading">From private evidence to an active loan.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div><strong>Build a passport</strong><p>Connect financial sources to a verified ENS identity.</p></div>
          </li>
          <li>
            <span>02</span>
            <div><strong>Receive a policy</strong><p>A provider sends the exact underwriting requirements.</p></div>
          </li>
          <li>
            <span>03</span>
            <div><strong>Generate a ZK proof</strong><p>Return only policy-bound pass or fail outputs.</p></div>
          </li>
          <li>
            <span>04</span>
            <div><strong>Choose and repay</strong><p>Compare funded offers, draw USDC, and track repayment.</p></div>
          </li>
        </ol>
      </section>
    </div>
  );
}
