/**
 * Step 1 — read a real portfolio.
 *
 * BORROWER-ONLY. Imports `witnessStore`.
 *
 * There is deliberately NO prefilled address. A hard-coded sample account is
 * the same disqualifying artefact as a hard-coded witness wearing a different
 * hat: it lets the demo work without the machinery working. The field starts
 * empty, and the 1-4 seconds it takes to answer are real Solana RPC and real
 * Jupiter pricing, not a spinner on a timer.
 *
 * The ENS block that used to sit here as a "Workstream D · pending"
 * placeholder now lives in `EnsIdentityPanel` and is mounted by
 * `BorrowerView` alongside this card, so it stays on screen across step 1 and
 * step 2 — the subject commitment it displays needs the blinding factor, which
 * only exists once the passport has been read.
 *
 * TWO IDENTIFIERS, NEVER CONFLATED. The Solana address on this card is where
 * the PORTFOLIO is read. The ENS name is WHO the applicant is, and is the only
 * input to the payout address. They answer different questions.
 */

import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, RefreshCw, Search } from "lucide-react";

import { PRODUCT_CONFIG } from "../config/product";
import { Button, Card, Spinner } from "../components/ui";
import { isLikelySolanaAddress, useWitness } from "./witnessStore";

export function ConnectAccount({ onLoaded }: { onLoaded: () => void }) {
  const witness = useWitness();
  const [draft, setDraft] = useState(witness.address);
  const [formatError, setFormatError] = useState<string | null>(null);

  const loading = witness.status === "loading";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = draft.trim();
    if (!isLikelySolanaAddress(candidate)) {
      setFormatError(
        "That is not a Solana address. Expect 32-44 base58 characters (no 0, O, I or l).",
      );
      return;
    }
    setFormatError(null);
    await witness.load(candidate);
    onLoaded();
  };

  return (
    <Card className="task-card">
      <div className="task-card__heading">
        <span className="task-icon">
          <Search size={22} />
        </span>
        <div>
          <span className="section-label">Step 1 of 6</span>
          <h2>Connect the portfolio account</h2>
          <p>
            The passport is derived from an account that exists. Paste one and the backend reads it live.
          </p>
        </div>
      </div>

      <form className="address-form" onSubmit={(event) => void submit(event)}>
        <label className="form-field">
          <span>Solana address</span>
          <input
            className="text-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
            value={draft}
            disabled={loading}
            onChange={(event) => {
              setDraft(event.target.value);
              if (formatError) setFormatError(null);
            }}
          />
        </label>
        <small className="address-form__help">
          Paste any Solana mainnet address, including your own. Balances are read live from mainnet;
          settlement will be on devnet.
        </small>

        {formatError ? (
          <div className="inline-state inline-state--danger" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>Address format</strong>
              <span>{formatError}</span>
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
            <Button
              variant="secondary"
              type="button"
              onClick={() => void witness.load(draft.trim())}
              icon={<RefreshCw size={15} />}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="generating-state" role="status" aria-live="polite">
            <Spinner />
            <div>
              <strong>Reading {PRODUCT_CONFIG.readCluster}</strong>
              <span>
                getBalance → getTokenAccountsByOwner (both token programs) → Jupiter price/v3 →
                getSignaturesForAddress, paged backwards under a hard cap
              </span>
            </div>
          </div>
        ) : null}

        <div className="task-card__action">
          <span className="action-note">
            Read-only. The portfolio read asks for no signature and holds no key.
          </span>
          <Button type="submit" disabled={loading} icon={loading ? <Spinner /> : <ArrowRight size={16} />}>
            {loading ? "Reading the chain" : "Read the passport"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
