import { useEffect } from "react";
import {
  AlertTriangle,
  Check,
  CircleX,
  Network,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { formatCurrency } from "../config/product";
import type { WalletActionKind, WalletActionState } from "../state/demo";
import { Button, Spinner, StatusPill } from "./ui";

type WalletActionDialogProps = {
  action: WalletActionState;
  amount: number;
  onSwitchNetwork: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onFail: () => void;
  onRetry: () => void;
  onClose: () => void;
};

const ACTION_COPY: Record<WalletActionKind, { title: string; detail: string; confirm: string }> = {
  "connect-applicant": {
    title: "Verify the ENS controller",
    detail: "Connect the wallet that controls alice.eth. No asset approval is requested.",
    confirm: "Approve connection",
  },
  "connect-provider": {
    title: "Connect the capital provider",
    detail: "Connect the wallet authorized by vault.lender.eth.",
    confirm: "Approve connection",
  },
  "publish-request": {
    title: "Publish the credit request",
    detail: "Only the requested amount, term, deposit and passport commitment become public.",
    confirm: "Sign and publish",
  },
  "fund-offer": {
    title: "Fund the capital offer",
    detail: "Commit testnet USDC to the selected credit terms.",
    confirm: "Fund offer",
  },
  "accept-offer": {
    title: "Accept the selected offer",
    detail: "Confirm the provider, cost and maturity before accepting.",
    confirm: "Accept offer",
  },
  "draw-loan": {
    title: "Draw the credit line",
    detail: "Release the funded testnet USDC to the applicant wallet.",
    confirm: "Draw USDC",
  },
  "repay-loan": {
    title: "Repay the active loan",
    detail: "Approve repayment of principal, accrued interest and fees.",
    confirm: "Repay loan",
  },
};

export function WalletActionDialog({
  action,
  amount,
  onSwitchNetwork,
  onConfirm,
  onReject,
  onFail,
  onRetry,
  onClose,
}: WalletActionDialogProps) {
  const copy = ACTION_COPY[action.kind];
  const canClose = action.status !== "confirming";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [canClose, onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && canClose) onClose();
      }}
    >
      <section className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
        <header className="wallet-dialog__header">
          <StatusPill tone="neutral">Frontend simulation</StatusPill>
          {canClose ? (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close wallet action">
              <X size={18} />
            </button>
          ) : null}
        </header>

        <div className={`wallet-dialog__state wallet-dialog__state--${action.status}`} aria-live="polite">
          <span className="wallet-dialog__icon" aria-hidden="true">
            {action.status === "wrong_network" ? <Network size={24} /> : null}
            {action.status === "awaiting_signature" ? <WalletCards size={24} /> : null}
            {action.status === "confirming" ? <Spinner /> : null}
            {action.status === "confirmed" ? <Check size={24} /> : null}
            {action.status === "rejected" ? <CircleX size={24} /> : null}
            {action.status === "failed" ? <AlertTriangle size={24} /> : null}
          </span>

          <div>
            <span className="section-label">
              {action.status === "wrong_network" ? "Network required" : "Wallet action"}
            </span>
            <h2 id="wallet-dialog-title">
              {action.status === "wrong_network" ? "Switch to Sepolia" : copy.title}
            </h2>
            <p>
              {action.status === "wrong_network"
                ? "This prototype uses Sepolia. Switch networks before continuing."
                : action.status === "rejected"
                  ? "The wallet request was rejected. Nothing changed."
                  : action.status === "failed"
                    ? "The simulated transaction failed before confirmation. Nothing was committed."
                    : action.status === "confirming"
                      ? "Waiting for one simulated network confirmation."
                      : action.status === "confirmed"
                        ? "Confirmed. The shared demo state has been updated."
                        : copy.detail}
            </p>
          </div>
        </div>

        {action.kind !== "connect-applicant" && action.kind !== "connect-provider" ? (
          <div className="wallet-dialog__amount">
            <span>Action value</span>
            <strong>{formatCurrency(amount)} USDC</strong>
          </div>
        ) : null}

        <div className="wallet-dialog__actions">
          {action.status === "wrong_network" ? (
            <>
              <Button variant="quiet" onClick={onClose}>Cancel</Button>
              <Button onClick={onSwitchNetwork} icon={<Network size={16} />}>Switch network</Button>
            </>
          ) : null}
          {action.status === "awaiting_signature" ? (
            <>
              <button type="button" className="text-button text-button--danger" onClick={onFail}>
                Simulate failure
              </button>
              <Button variant="secondary" onClick={onReject}>Reject</Button>
              <Button onClick={onConfirm} icon={<ShieldCheck size={16} />}>{copy.confirm}</Button>
            </>
          ) : null}
          {action.status === "confirming" ? <span className="action-note">Do not close this window</span> : null}
          {action.status === "confirmed" ? <Button onClick={onClose} icon={<Check size={16} />}>Continue</Button> : null}
          {action.status === "rejected" || action.status === "failed" ? (
            <>
              <Button variant="quiet" onClick={onClose}>Close</Button>
              <Button onClick={onRetry}>Try again</Button>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
