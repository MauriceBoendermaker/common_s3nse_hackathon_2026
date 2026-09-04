/**
 * Step 1 — the portfolio. BORROWER-ONLY.
 *
 * Connect Phantom, sign one message proving control of the address, and the
 * backend reads that address's mainnet balances into a passport. The signature
 * is the reason nobody can build a passport over a portfolio they do not own.
 */

import { useState } from "react";
import { AlertTriangle, ArrowRight, Database, RefreshCw, Wallet } from "lucide-react";

import { PRODUCT_CONFIG } from "../config/product";
import { Button, Card, Spinner } from "../components/ui";
import { portfolioAuthMessage } from "../shared/passportAuth";
import {
  bytesToBase64,
  connectPhantom,
  describeWalletError,
  shortAddress,
  signWithPhantom,
} from "../shared/wallets";
import { useWitness } from "./witnessStore";

export function ConnectAccount({ onLoaded }: { onLoaded: () => void }) {
  const witness = useWitness();
  const [phase, setPhase] = useState<"idle" | "connecting" | "signing">("idle");
  const [walletError, setWalletError] = useState<string | null>(null);

  const loading = witness.status === "loading";
  const busy = loading || phase !== "idle";

  const run = async () => {
    setWalletError(null);
    let address: string;
    let issuedAt: string;
    let signature: Uint8Array;
    try {
      setPhase("connecting");
      address = await connectPhantom();
      setPhase("signing");
      issuedAt = new Date().toISOString();
      signature = await signWithPhantom(portfolioAuthMessage(address, issuedAt));
    } catch (cause) {
      setPhase("idle");
      setWalletError(describeWalletError(cause));
      return;
    }
    setPhase("idle");
    await witness.load({ address, issuedAt, signature: bytesToBase64(signature) });
    onLoaded();
  };

  return (
    <Card className="task-card task-card--auto">
      <div className="task-card__heading">
        <span className="task-icon">
          <Database size={22} />
        </span>
        <div>
          <span className="section-label">Step 1 · Portfolio</span>
          <h2>Read your Solana portfolio</h2>
          <p>
            Sign once with Phantom to prove the address is yours. Balances are read live from{" "}
            {PRODUCT_CONFIG.readCluster} and stay in this tab.
          </p>
        </div>
      </div>

      <div className="wallet-row">
        {witness.address ? (
          <span className="wallet-chip">
            <Wallet size={14} /> {shortAddress(witness.address)}
            <small>Solana</small>
          </span>
        ) : null}
        <Button
          type="button"
          disabled={busy}
          icon={
            busy ? <Spinner /> : witness.address ? <RefreshCw size={15} /> : <ArrowRight size={16} />
          }
          onClick={() => void run()}
        >
          {phase === "connecting"
            ? "Connecting Phantom"
            : phase === "signing"
              ? "Sign in Phantom"
              : loading
                ? "Reading the chain"
                : witness.address
                  ? "Read again"
                  : "Connect Phantom and read"}
        </Button>
      </div>

      {walletError ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Wallet</strong>
            <span>{walletError}</span>
          </div>
        </div>
      ) : null}

      {witness.status === "error" ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>The passport read failed</strong>
            <span>{witness.error}</span>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="generating-state" role="status" aria-live="polite">
          <Spinner />
          <div>
            <strong>Reading {PRODUCT_CONFIG.readCluster}</strong>
            <span>Balances, token accounts, Jupiter prices, signature history. A few seconds.</span>
          </div>
        </div>
      ) : null}

      <small className="address-form__help">
        The signature authorises a read only. It never leaves this session and moves nothing.
      </small>
    </Card>
  );
}
