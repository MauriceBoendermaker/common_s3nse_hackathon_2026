/**
 * The marketplace. The first screen, and the one that says what this is:
 * a live board of credit requests, two doors (borrow / lend), and the three
 * facts that make it different (proof, not portfolio; ENS identity; on-chain
 * settlement).
 *
 * The board polls `GET /api/market`, which needs no session — it is the same
 * public data both parties already see, condensed.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Database,
  Landmark,
  LockKeyhole,
  Radio,
  Store,
} from "lucide-react";

import { fetchMarket } from "../shared/apiClient";
import { formatPercent, formatRelativeTime, formatUsd } from "../shared/format";
import type { MarketBoard, MarketListing } from "../shared/protocol-types";
import { useSettlementConfig } from "../shared/useSettlementConfig";
import type { AppView } from "../state/types";
import { Button, Disclosure, StatusPill } from "./ui";

type HomeViewProps = {
  onStart: (view: Extract<AppView, "borrower" | "lender">) => void;
};

const POLL_MS = 4_000;

function listingState(row: MarketListing): {
  label: string;
  tone: "neutral" | "success" | "warning" | "dark" | "danger";
} {
  if (row.settled) return { label: "Settled on Solana", tone: "success" };
  if (row.loanStatus === "repaid") return { label: "Repaid", tone: "dark" };
  if (row.loanStatus === "active") return { label: "Loan active", tone: "success" };
  if (row.loanStatus === "repayment_due" || row.loanStatus === "default_risk") {
    return { label: "Repayment due", tone: "warning" };
  }
  if (row.loanStatus === "funded") return { label: "Funded", tone: "success" };
  if (row.offers > 0) return { label: `${row.offers} offer${row.offers === 1 ? "" : "s"}`, tone: "success" };
  if (row.verifiedReceipts > 0) return { label: "Proof verified", tone: "dark" };
  if (row.underwriting > 0) return { label: "Underwriting", tone: "warning" };
  return { label: "Seeking lenders", tone: "neutral" };
}

export function HomeView({ onStart }: HomeViewProps) {
  const { config } = useSettlementConfig();
  const [board, setBoard] = useState<MarketBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const next = await fetchMarket();
        if (!live) return;
        setBoard(next);
        setBoardError(null);
        setNow(Date.now());
      } catch (cause) {
        if (!live) return;
        setBoardError(cause instanceof Error ? cause.message : String(cause));
      }
      if (live) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const listings = board?.listings ?? [];
  const totals = board?.totals ?? null;

  return (
    <div className="home-page" id="top">
      <section className="home-hero">
        <div className="home-copy">
          <span className="eyebrow">Private credit marketplace · Solana + ENS</span>
          <h1>Borrow against what you can prove.</h1>
          <p>
            Borrowers list a credit request backed by a zero-knowledge passport of their Solana
            portfolio. Lenders verify the proof, compete on rate, and pay out to a one-time
            address derived from the borrower&apos;s ENS name. Nobody sees a balance.
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
              Lend
            </Button>
          </div>

          <div className="protocol-signals" aria-label="Protocol foundations">
            <span>
              <span className="signal-icon">
                <Database size={14} />
              </span>
              Balances read live from Solana mainnet
            </span>
            <span>
              <span className="signal-icon">
                <LockKeyhole size={14} />
              </span>
              Groth16 proof, generated in your browser
            </span>
            <span>
              <span className="signal-icon">
                <Landmark size={14} />
              </span>
              Verified again on chain at settlement
            </span>
            <span>
              <span className="signal-icon">
                <Radio size={14} />
              </span>
              Paid to a fresh address from your ENS name
            </span>
          </div>
        </div>

        <aside className="market-stats" aria-label="Market totals">
          <div className="market-stats__header">
            <Store size={18} />
            <div>
              <strong>Market right now</strong>
              <span>
                {board
                  ? `live · ${config?.cluster ?? "solana"} settlement`
                  : boardError
                    ? "backend unreachable"
                    : "connecting"}
              </span>
            </div>
            <span className={board ? "network-dot network-dot--live" : "network-dot"} aria-hidden="true" />
          </div>
          <dl className="market-stats__grid">
            <div>
              <dt>Open requests</dt>
              <dd>{totals ? totals.open : "—"}</dd>
            </div>
            <div>
              <dt>Requested</dt>
              <dd>{totals ? formatUsd(totals.requestedUsd) : "—"}</dd>
            </div>
            <div>
              <dt>Funded loans</dt>
              <dd>{totals ? totals.funded : "—"}</dd>
            </div>
            <div>
              <dt>Active lenders</dt>
              <dd>{totals ? totals.lenders : "—"}</dd>
            </div>
          </dl>
          <ol className="market-stats__how">
            <li>
              <span>1</span> Borrower lists terms + a hash of their portfolio
            </li>
            <li>
              <span>2</span> Lender sends a policy; borrower answers with a proof
            </li>
            <li>
              <span>3</span> Lender funds; the program pays a one-time ENS-derived address
            </li>
          </ol>
        </aside>
      </section>

      <section className="market-board" aria-labelledby="market-heading">
        <div className="market-board__header">
          <div>
            <span className="eyebrow">Live board</span>
            <h2 id="market-heading">Credit requests</h2>
          </div>
          <StatusPill tone={board ? "success" : boardError ? "danger" : "neutral"}>
            {board ? `${listings.length} listed` : boardError ? "offline" : "loading"}
          </StatusPill>
        </div>

        {boardError && !board ? (
          <div className="market-empty">
            <strong>The marketplace backend is not reachable.</strong>
            <span>{boardError}</span>
          </div>
        ) : listings.length === 0 ? (
          <div className="market-empty">
            <strong>No requests listed yet.</strong>
            <span>Be the first borrower, or open the lender side and wait for one.</span>
            <div className="hero-actions">
              <Button onClick={() => onStart("borrower")} icon={<ArrowRight size={15} />}>
                List a request
              </Button>
              <Button variant="secondary" onClick={() => onStart("lender")}>
                Open lender view
              </Button>
            </div>
          </div>
        ) : (
          <ul className="market-rows">
            {listings.map((row) => {
              const state = listingState(row);
              return (
                <li className="market-row" key={row.requestId}>
                  <div className="market-row__who">
                    <span className="avatar" aria-hidden="true">
                      {row.ensName.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <strong>{row.ensName}</strong>
                      <small>
                        listed {formatRelativeTime(new Date(row.createdAt).toISOString(), now)}
                      </small>
                    </div>
                  </div>
                  <div className="market-row__cell">
                    <strong>{formatUsd(row.amount)}</strong>
                    <small>
                      {row.termDays} days · {formatUsd(row.collateral)} first-loss
                    </small>
                  </div>
                  <div className="market-row__cell">
                    <strong>
                      {row.bestApr !== null
                        ? `${formatPercent(row.bestApr, 1)} APR`
                        : row.underwriting > 0
                          ? `${row.underwriting} underwriting`
                          : "No offers yet"}
                    </strong>
                    <small>
                      {row.offers > 0
                        ? `best of ${row.offers} offer${row.offers === 1 ? "" : "s"}`
                        : row.verifiedReceipts > 0
                          ? "eligibility proven"
                          : "awaiting a policy"}
                    </small>
                  </div>
                  <div className="market-row__state">
                    <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    {row.loanStatus === null ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onStart("lender")}
                      >
                        Underwrite <ArrowRight size={13} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="how-heading">
          <span className="eyebrow">How a loan happens</span>
          <h2 id="how-heading">Prove it without showing it.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>List</strong>
              <p>
                Connect Phantom, read your portfolio, and publish the amount, term and a Poseidon
                hash of the snapshot. Your ENS name is the only identity on the listing.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Prove</strong>
              <p>
                A lender sends four thresholds. Your browser produces a Groth16 proof that the
                hidden snapshot satisfies them. The values never leave the tab.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Get funded</strong>
              <p>
                Lenders compete on APR. The Solana program re-verifies the proof, spends a
                nullifier, and pays a fresh address derived from your ENS payout key.
              </p>
            </div>
          </li>
        </ol>

        <Disclosure summary="What is real here, and what is not yet" className="home-honesty-drawer">
          <p>
            <strong>Real.</strong> Balances come from Solana mainnet. The proof is a BN254 Groth16
            proof over a 2,980-constraint circuit, produced in the browser, checked by the server
            and then by the settlement program on chain. ENS is read and written on Sepolia from
            your own wallet. Every request, offer and loan is a row in the marketplace backend.
          </p>
          <p>
            <strong>Not yet.</strong> The trusted setup is a development ceremony. Settlement runs
            against {config?.cluster ?? "a test cluster"} with a token this project minted, signed
            by operator keys the backend holds rather than by each party&apos;s wallet. Nothing
            is audited.
          </p>
        </Disclosure>
      </section>
    </div>
  );
}
