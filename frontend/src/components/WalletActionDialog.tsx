/**
 * The confirmation step before a state-changing call.
 *
 * It used to pretend to be a wallet: "Switch to Sepolia", "Simulate failure",
 * and a 1200ms `setTimeout` that stood in for a network confirmation. None of
 * that was true — no wallet is connected, no chain is written to.
 *
 * What it is now: a local confirmation that runs a REAL API call. `run()` is
 * awaited, its failure is surfaced verbatim, and the dialog cannot reach
 * "done" unless the server actually accepted the mutation. Wallet signing
 * arrives with the Solana program (workstream E); until then this dialog says
 * so instead of miming it.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";

import { ApiError } from "../shared/apiClient";
import { formatUsd } from "../shared/format";
import { Button, Spinner, StatusPill } from "./ui";

export type ConfirmAction = {
  title: string;
  detail: string;
  confirmLabel: string;
  /** Optional USD figure this action commits, shown before confirming. */
  amount?: number;
  /** The real mutation. Rejects on any server or transport failure. */
  run: () => Promise<void>;
  /** Copy shown once the server accepted it. */
  successDetail: string;
};

type DialogStatus = "ready" | "running" | "done" | "failed";

export function WalletActionDialog({
  action,
  onClose,
}: {
  action: ConfirmAction;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DialogStatus>("ready");
  const [error, setError] = useState<string | null>(null);

  const canClose = status !== "running";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [canClose, onClose]);

  const confirm = useCallback(async () => {
    setStatus("running");
    setError(null);
    try {
      await action.run();
      setStatus("done");
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.detail
            ? `${cause.message} — ${cause.detail}`
            : cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause);
      setError(message);
      setStatus("failed");
    }
  }, [action]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && canClose) onClose();
      }}
    >
      <section
        className="wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
      >
        <header className="wallet-dialog__header">
          <StatusPill tone="neutral">Local confirmation · no keys held</StatusPill>
          {canClose ? (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          ) : null}
        </header>

        <div
          className={`wallet-dialog__state wallet-dialog__state--${status}`}
          aria-live="polite"
        >
          <span className="wallet-dialog__icon" aria-hidden="true">
            {status === "ready" ? <ShieldCheck size={24} /> : null}
            {status === "running" ? <Spinner /> : null}
            {status === "done" ? <Check size={24} /> : null}
            {status === "failed" ? <AlertTriangle size={24} /> : null}
          </span>

          <div>
            <span className="section-label">
              {status === "failed" ? "The server rejected it" : "Confirm action"}
            </span>
            <h2 id="wallet-dialog-title">{action.title}</h2>
            <p>
              {status === "running"
                ? "Waiting for the backend to accept the change."
                : status === "done"
                  ? action.successDetail
                  : status === "failed"
                    ? (error ?? "The request failed. Nothing changed.")
                    : action.detail}
            </p>
          </div>
        </div>

        {typeof action.amount === "number" ? (
          <div className="wallet-dialog__amount">
            <span>Action value</span>
            <strong>{formatUsd(action.amount)} USDC</strong>
          </div>
        ) : null}

        <div className="wallet-dialog__actions">
          {status === "ready" ? (
            <>
              <span className="action-note">
                This prototype does not yet hold keys; wallet signing lands with the Solana program.
              </span>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void confirm()} icon={<ShieldCheck size={16} />}>
                {action.confirmLabel}
              </Button>
            </>
          ) : null}
          {status === "running" ? (
            <span className="action-note">Real HTTP request in flight — do not close.</span>
          ) : null}
          {status === "done" ? (
            <Button onClick={onClose} icon={<Check size={16} />}>
              Continue
            </Button>
          ) : null}
          {status === "failed" ? (
            <>
              <Button variant="quiet" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => void confirm()}>Try again</Button>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
