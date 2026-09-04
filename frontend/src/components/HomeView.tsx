import { ArrowRight, Building2, Database, LockKeyhole, Radio } from "lucide-react";

import { PRODUCT_CONFIG } from "../config/product";
import type { AppView } from "../state/types";
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
            An applicant proves they meet a lender&apos;s policy without handing over balances, positions or
            holdings. Two browser tabs, two sessions, one API between them — the applicant&apos;s workspace
            and the lender&apos;s workspace share no state and load as separate bundles.
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
            <span>
              <span className="signal-icon">
                <Database size={14} />
              </span>
              Witness read live from Solana mainnet
            </span>
            <span>
              <span className="signal-icon">
                <Radio size={14} />
              </span>
              Two sessions over one API
            </span>
            <span>
              <span className="signal-icon">
                <LockKeyhole size={14} />
              </span>
              groth16-bn254 · proved in the browser
            </span>
          </div>

          <p className="home-honesty">
            <strong>Where this prototype actually is.</strong> Balances are read from{" "}
            {PRODUCT_CONFIG.readCluster} because that is where real portfolios live; settlement targets{" "}
            {PRODUCT_CONFIG.settleCluster} because no real value moves here. The policy is proved in the
            applicant&apos;s browser as a BN254 Groth16 proof over a 2 980-constraint circuit, and the
            server re-checks the pairing equation against a committed verifying key — the portfolio values
            themselves never leave the tab. The honest caveat: the trusted setup is a{" "}
            <strong>development ceremony</strong> run on one machine, so whoever ran it could forge proofs.
            Everything else is enforced today: the passport commitment is published before any policy
            challenge exists, the server recomputes the policy hash from its own copy, receipts expire, and
            a nullifier stops a receipt being presented twice. Not wired yet: on-chain verification and
            settlement.
          </p>
        </div>

        <PrivacyBoundary />
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="how-heading">
          <span className="eyebrow">One private credit flow</span>
          <h2 id="how-heading">From a real account to an active loan.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Read a portfolio</strong>
              <p>
                Paste a Solana mainnet address. The backend reads balances over a committed nine-mint
                allowlist and reports every endpoint it hit.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Publish a commitment</strong>
              <p>
                A Poseidon hash of the snapshot goes public with the loan terms — before any lender states
                a policy.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Answer a policy</strong>
              <p>
                Four thresholds arrive as a hashed challenge. A Groth16 proof, seven public signals and
                four booleans go back. The values never do.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <strong>Verify, fund, repay</strong>
              <p>
                The lender re-checks every binding server-side, funds an offer, and both sides watch the
                same loan row.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
