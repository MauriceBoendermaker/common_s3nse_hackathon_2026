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

import { useMemo } from "react";
import { AlertTriangle, Check, Coins, KeyRound, X } from "lucide-react";

import { Button, StatusPill } from "../components/ui";
import {
  hexToBytesStrict,
  recoverPayoutKeypair,
  solanaAddressFromSecretKey,
} from "../shared/ensPayout";
import type { PayoutAnnouncement } from "../shared/protocol-types";
import { useEnsIdentity } from "./ensIdentity";
import { WalletPicker } from "./WalletPicker";
import { shortAddress } from "../shared/wallets";

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
          The lender has not derived a payout address yet. It happens on their side, from the key
          published under your ENS domain.
        </p>
      ) : !viewingPrivateKey ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>This tab holds no viewing key</strong>
            <span>
              The key is derived from your wallet signature and never stored, so a reload loses
              it. Sign again with the same wallet to recover every address below.
            </span>
          </div>
          {ens.wallet ? (
            <Button variant="secondary" type="button" onClick={() => void ens.signViewingKey()}>
              Sign to re-derive
            </Button>
          ) : (
            <WalletPicker />
          )}
        </div>
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
                <>
                  <p className="provenance-note provenance-note--flag">
                    This tab&apos;s viewing key does not match the key published under{" "}
                    {ens.name || announcement.ensName}. The lender paid to the key on chain, so sign
                    the viewing-key message with the wallet that published it
                    {ens.resolution?.owner ? <> ({shortAddress(ens.resolution.owner)})</> : null}.
                    {ens.walletName ? <> This tab is currently signed with {ens.walletName}.</> : null}
                  </p>
                  <div className="wallet-row">
                    <WalletPicker label="Sign with" />
                  </div>
                </>
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

      <p className="provenance-note">
        <Coins size={13} /> Deriving an address does not fund it. Settlement creates the token
        account, moves the escrow into it and adds 0.002 SOL so you can sweep.
      </p>
    </section>
  );
}
