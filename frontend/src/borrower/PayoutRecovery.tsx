/**
 * Step 6 — the borrower recovers the one-time payout addresses.
 *
 * BORROWER-ONLY. This is the only component that touches the X25519 viewing
 * scalar, which is why it lives here and not in `components/`.
 *
 * For each announcement the lender published, this recomputes
 *
 *   ss   = X25519(x, R)
 *   seed = HKDF-SHA256(ss, salt = requestId, info = "privatecredit/v1/sol-payout")
 *
 * and derives the ed25519 keypair from that seed. Two things are then shown
 * side by side: the address the LENDER announced, and the address THIS TAB
 * derived. They must be the same string. That comparison is the whole security
 * argument for the payout leg — the server cannot check it (it has no key
 * material), so the borrower does, and a lender who announces an address it
 * cannot back is caught here rather than after the money is gone.
 *
 * NO FUNDS MOVE. There is no Solana program, no SPL escrow and no transfer
 * anywhere in this repository — that is workstream E and it is not
 * implemented. A freshly derived payout address is an address nobody has ever
 * sent anything to: zero lamports, no associated token account. Even with a
 * program deployed it could not be swept until somebody funds it with roughly
 * 0.002 SOL of rent for the ATA plus a fee payer, and that funding transaction
 * is itself a link an observer can follow. Naming the trap is the honest
 * thing; hiding it behind a "Sweep" button that does nothing is not.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Coins, KeyRound, X } from "lucide-react";

import { Button, StatusPill } from "../components/ui";
import {
  PAYOUT_KEY_SIGN_MESSAGE,
  hexToBytesStrict,
  recoverPayoutKeypair,
  solanaAddressFromSecretKey,
} from "../shared/ensPayout";
import type { PayoutAnnouncement } from "../shared/protocol-types";
import { useEnsIdentity } from "./ensIdentity";

type PayoutRecoveryProps = {
  requestId: string;
  /** Every announcement on this request, newest first. */
  payouts: PayoutAnnouncement[];
};

type Recovery =
  | { kind: "match"; recovered: string; controls: string; viewTag: number }
  | { kind: "mismatch"; recovered: string; controls: string; viewTag: number }
  | { kind: "not-mine" }
  | { kind: "error"; message: string };

function recover(
  announcement: PayoutAnnouncement,
  requestId: string,
  viewingPrivateKey: Uint8Array,
): Recovery {
  try {
    const result = recoverPayoutKeypair({
      viewingPrivateKey,
      ephemeralPublicKey: hexToBytesStrict(announcement.ephemeralPublicKey, "R"),
      requestId,
      viewTag: announcement.viewTag,
    });
    if (!result) return { kind: "not-mine" };

    // Not "does the string match" but "does the recovered SECRET key actually
    // control that address": the public key is re-derived from the 64-byte
    // secret rather than trusted from the object that produced it.
    const controls = solanaAddressFromSecretKey(result.secretKey);
    const matches =
      result.solanaAddress === announcement.payoutAddress && controls === result.solanaAddress;
    return {
      kind: matches ? "match" : "mismatch",
      recovered: result.solanaAddress,
      controls,
      viewTag: result.viewTag,
    };
  } catch (cause) {
    return { kind: "error", message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function PayoutRecovery({ requestId, payouts }: PayoutRecoveryProps) {
  const ens = useEnsIdentity();
  const [signature, setSignature] = useState("");
  const viewingPrivateKey = ens.viewing?.privateKey ?? null;

  const rows = useMemo(
    () =>
      viewingPrivateKey
        ? payouts.map((announcement) => ({
            announcement,
            recovery: recover(announcement, requestId, viewingPrivateKey),
          }))
        : [],
    [payouts, requestId, viewingPrivateKey],
  );

  const matched = rows.filter((row) => row.recovery.kind === "match").length;

  return (
    <section className="payout-panel">
      <div className="proof-section-heading">
        <span>
          <KeyRound size={15} /> One-time payout addresses
        </span>
        <small>
          {payouts.length === 0
            ? "None announced yet"
            : `${matched} of ${payouts.length} recovered in this tab`}
        </small>
      </div>

      {payouts.length === 0 ? (
        <p className="provenance-note">
          The capital provider has not derived a payout address for this request yet. It happens on
          their side, from the X25519 key in this identity&apos;s{" "}
          <code>privatecredit.payout-key[501]</code> record — this tab cannot make one appear.
        </p>
      ) : !viewingPrivateKey ? (
        <>
          <div className="inline-state inline-state--danger" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>This tab holds no viewing key</strong>
              <span>
                Without the X25519 scalar there is nothing to recompute the shared secret with. The
                key is never stored, so a reload loses it — and losing it costs nothing, because it
                is derived, not generated. Sign the message below with the same wallet and paste the
                result: RFC 6979 makes that signature deterministic, so the identical key comes back.
              </span>
            </div>
          </div>
          <pre className="sign-message">{PAYOUT_KEY_SIGN_MESSAGE}</pre>
          <div className="ens-panel">
            <label className="form-field">
              <span>personal_sign output (65 bytes of hex)</span>
              <input
                className="text-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={signature.trim().length === 0}
              onClick={() => ens.deriveFromSignature(signature.trim())}
            >
              Re-derive the viewing key
            </Button>
          </div>
          {ens.viewingError ? (
            <p className="provenance-note provenance-note--flag">{ens.viewingError}</p>
          ) : null}
        </>
      ) : (
        <ul className="payout-list">
          {rows.map(({ announcement, recovery }) => (
            <li key={announcement.id}>
              <div className="payout-list__head">
                <strong className="mono-value">{announcement.payoutAddress}</strong>
                {recovery.kind === "match" ? (
                  <StatusPill tone="success">
                    <Check size={13} /> recovered
                  </StatusPill>
                ) : recovery.kind === "not-mine" ? (
                  <StatusPill tone="warning">view tag did not match</StatusPill>
                ) : (
                  <StatusPill tone="danger">
                    <X size={13} /> mismatch
                  </StatusPill>
                )}
              </div>
              <dl className="payout-list__facts">
                <div>
                  <dt>Announced by</dt>
                  <dd>{announcement.lenderLabel}</dd>
                </div>
                <div>
                  <dt>Ephemeral key R</dt>
                  <dd title={announcement.ephemeralPublicKey}>
                    {announcement.ephemeralPublicKey.slice(0, 14)}…
                    {announcement.ephemeralPublicKey.slice(-6)}
                  </dd>
                </div>
                <div>
                  <dt>View tag</dt>
                  <dd>
                    0x{announcement.viewTag.toString(16).padStart(2, "0")}
                    {recovery.kind === "match" || recovery.kind === "mismatch"
                      ? ` · recomputed 0x${recovery.viewTag.toString(16).padStart(2, "0")}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Key source</dt>
                  <dd>{announcement.keySource}</dd>
                </div>
                <div>
                  <dt>Recovered address</dt>
                  <dd className="mono-value">
                    {recovery.kind === "match" || recovery.kind === "mismatch"
                      ? recovery.recovered
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Secret key controls</dt>
                  <dd className="mono-value">
                    {recovery.kind === "match" || recovery.kind === "mismatch"
                      ? recovery.controls
                      : "—"}
                  </dd>
                </div>
              </dl>

              {recovery.kind === "match" ? (
                <p className="provenance-note">
                  Announced and recovered are the same string, and the 64-byte secret key this tab
                  derived produces that same public key — so this tab can sign for the address, not
                  merely recognise it.
                </p>
              ) : recovery.kind === "not-mine" ? (
                <p className="provenance-note provenance-note--flag">
                  The view tag recomputed from this tab&apos;s viewing key does not match the
                  announced one, so this announcement was derived against a different payout key.
                  That is the ordinary outcome when scanning somebody else&apos;s draws — and here it
                  means the lender resolved a key this tab does not hold.
                </p>
              ) : recovery.kind === "mismatch" ? (
                <p className="provenance-note provenance-note--flag">
                  The view tag matched but the address does not. The announced address is not the one
                  this shared secret produces, so nothing sent there would be recoverable. Do not
                  treat this announcement as a payout instruction.
                </p>
              ) : (
                <p className="provenance-note provenance-note--flag">{recovery.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="inline-state" role="note">
        <Coins size={19} />
        <div>
          <strong>No funds move, and the address is not yet sweepable</strong>
          <span>
            Deriving an address is not funding one. There is no Solana program, no SPL escrow and no
            transfer in this repository — that is workstream E and it is not implemented. Every
            address above holds zero lamports and has no associated token account, so even with the
            program deployed it could not be swept until somebody pays roughly 0.002 SOL of ATA rent
            plus a transaction fee into it. That funding transaction is itself a link an observer can
            follow, which is a design problem worth naming rather than discovering later.
          </span>
        </div>
      </div>
    </section>
  );
}
