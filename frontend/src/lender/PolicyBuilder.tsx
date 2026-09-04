/**
 * Step 2 — choose the four thresholds and send the challenge.
 *
 * The "Load a policy that fails this demo profile" button is gone. It set
 * `minimumAssets` to 500_000 precisely because the file next door hard-coded
 * the borrower's assets as 340_000 — the lender's UI knew the borrower's secret
 * and used it to stage a failure. It was the single most damning line in the
 * repository.
 *
 * A lender who wants a failing outcome selects a strict threshold from the
 * dropdown, which produces a real failure over a real witness the lender cannot
 * see. Same demo, no cheating.
 *
 * The second field is minimum collateral quality, not a maximum debt ratio: a
 * debt ratio cannot be honestly sourced from Solana RPC in the time available,
 * and inventing one is exactly the disqualifying move.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, EyeOff, Send } from "lucide-react";

import { Button, Card, Spinner, StatusPill } from "../components/ui";
import { ApiError, createChallenge } from "../shared/apiClient";
import { formatPercent, formatUsd } from "../shared/format";
import { policyHash, POLICY_OPTIONS, shortHash } from "../shared/policy";
import type { CreditRequest, LendingPolicy } from "../shared/protocol-types";

const VALIDITY_MINUTES = 10;

export function PolicyBuilder({
  request,
  sessionId,
  onSent,
}: {
  request: CreditRequest;
  sessionId: string;
  onSent: () => void;
}) {
  /**
   * Pinned by VALUE, not by index into POLICY_OPTIONS.
   *
   * These were `POLICY_OPTIONS.x[1]` until a lower tier was prepended to two of
   * the lists, which silently moved the defaults. A default policy is what a
   * judge sees first; it should change only when somebody decides to change it.
   */
  const [policy, setPolicy] = useState<LendingPolicy>({
    minimumAssets: 10_000,
    minimumCollateralQuality: 50,
    minimumHistoryMonths: 3,
    screenRestrictedExposure: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hash = useMemo(() => policyHash(policy), [policy]);

  const update = <Key extends keyof LendingPolicy>(key: Key, value: LendingPolicy[Key]) => {
    setPolicy((current) => ({ ...current, [key]: value }));
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await createChallenge({
        sessionId,
        requestId: request.id,
        policy,
        validityMinutes: VALIDITY_MINUTES,
      });
      onSent();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.detail
            ? `${cause.message} — ${cause.detail}`
            : cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="task-card policy-task-card">
      <div className="task-card__heading">
        <span className="task-icon">
          <Send size={22} />
        </span>
        <div>
          <span className="section-label">Step 2 of 5</span>
          <h2>Define the underwriting policy</h2>
          <p>
            Four thresholds. The receipt the applicant returns will be bound to the Poseidon hash of
            exactly these numbers.
          </p>
        </div>
      </div>

      <div className="request-ticket request-ticket--compact">
        <div>
          <span className="section-label">Reviewed request</span>
          <strong>{formatUsd(request.amount)} USDC</strong>
          <small>
            {request.termDays} days · {request.borrowerLabel} · {formatUsd(request.collateral)} first-loss
          </small>
        </div>
        <StatusPill tone="neutral">commitment {shortHash(request.passportCommitment)}</StatusPill>
      </div>

      <div className="policy-grid">
        <label className="form-field">
          <span>Minimum allowlisted collateral</span>
          <select
            value={policy.minimumAssets}
            onChange={(event) => update("minimumAssets", Number(event.target.value))}
          >
            {POLICY_OPTIONS.minimumAssets.map((value) => (
              <option value={value} key={value}>
                {formatUsd(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Minimum collateral quality (%)</span>
          <select
            value={policy.minimumCollateralQuality}
            onChange={(event) => update("minimumCollateralQuality", Number(event.target.value))}
          >
            {POLICY_OPTIONS.minimumCollateralQuality.map((value) => (
              <option value={value} key={value}>
                {value === 0
                  ? "No quality floor — any allowlisted collateral"
                  : `${formatPercent(value)} in stables and LSTs`}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Minimum account history</span>
          <select
            value={policy.minimumHistoryMonths}
            onChange={(event) => update("minimumHistoryMonths", Number(event.target.value))}
          >
            {POLICY_OPTIONS.minimumHistoryMonths.map((value) => (
              <option value={value} key={value}>
                {value} months
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="policy-toggle"
          role="switch"
          aria-checked={policy.screenRestrictedExposure}
          onClick={() => update("screenRestrictedExposure", !policy.screenRestrictedExposure)}
        >
          <span>
            <strong>Restricted exposure screen</strong>
            <small>Reject any denylisted mint held with a non-zero balance</small>
          </span>
          <span
            className={policy.screenRestrictedExposure ? "toggle is-on" : "toggle"}
            aria-hidden="true"
          >
            <span />
          </span>
        </button>
      </div>

      <div className="policy-preview">
        <div>
          <span>Policy hash</span>
          <strong className="mono-value">{shortHash(hash)}</strong>
        </div>
        <div>
          <span>Receipt validity</span>
          <strong>{VALIDITY_MINUTES} minutes</strong>
        </div>
        <div>
          <span>Bound verifier</span>
          <strong>this session</strong>
        </div>
        <StatusPill tone="neutral">poseidon4 · recomputed server-side</StatusPill>
      </div>

      <p className="provenance-note">
        The hash above was computed in this tab from the four thresholds. The backend recomputes it from
        the policy it stores, and the applicant recomputes it a third time before answering — a policy hash
        nobody can forge because nobody is trusted for it.
      </p>

      {error ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>The challenge was not created</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <div className="task-card__action">
        <span className="action-note">
          <EyeOff size={15} /> This requests four pass/fail outputs, not source data
        </span>
        <Button
          onClick={() => void send()}
          disabled={busy}
          icon={busy ? <Spinner /> : <Send size={16} />}
        >
          {busy ? "Sending" : "Send policy challenge"}
        </Button>
      </div>
    </Card>
  );
}
