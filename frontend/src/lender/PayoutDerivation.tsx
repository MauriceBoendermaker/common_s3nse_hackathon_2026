/**
 * Step 4 (continued) — where the money would actually go.
 *
 * LENDER-ONLY. This is the component that makes ENS load-bearing rather than
 * decorative: there is no field anywhere in the protocol carrying "the
 * borrower's Solana address". To pay, the lender's client MUST resolve the
 * borrower's ENS name, read the X25519 key out of that name's
 * `privatecredit.payout-key[501]` text record, and derive an address from it.
 * Remove ENS and this screen has nothing to display and no way to settle.
 *
 * WHAT ROTATION MEANS HERE. Every press of "Derive another" draws a fresh
 * ephemeral scalar `r`, so the shared secret changes and so does the address.
 * Two rows in the list below are two addresses for one identity that nobody
 * without the borrower's viewing scalar can connect — not to each other, and
 * not to the ENS name. That list, with two visibly different addresses in it,
 * is the demonstration.
 *
 * WHAT THE LENDER STILL HAS TO BE TRUSTED FOR — and it is the softest edge in
 * the whole design. Nothing on Solana can read ENS. A settlement program will
 * accept whatever payout address the payer's client hands it, so a lender who
 * resolves the wrong name, or simply invents an address, produces a
 * transaction the chain is happy with. Two things bound that: the payer is the
 * party who wants the loan to be valid, and the borrower's tab recomputes the
 * address from `R` and shows the mismatch immediately, before repayment is
 * owed. It is detection, not prevention, and it is stated as such.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, EyeOff, RefreshCw, Send, ShieldAlert } from "lucide-react";

import { Button, Spinner, StatusPill } from "../components/ui";
import { ApiError, announcePayout } from "../shared/apiClient";
import { readPayoutRecord } from "../shared/ensClient";
import {
  PAYOUT_RECORD_KEY,
  bytesToHex0x,
  derivePayoutAddress,
  hexToBytesStrict,
} from "../shared/ensPayout";
import type { CreditRequest, Offer, PayoutAnnouncement } from "../shared/protocol-types";

type PayoutDerivationProps = {
  request: CreditRequest;
  offer: Offer;
  sessionId: string;
  /** Every announcement already on this request, newest first. */
  payouts: PayoutAnnouncement[];
  onChanged: () => void;
};

type Evidence = {
  /** Verbatim `text(node, key)`, or null when no read succeeded. */
  value: string | null;
  blockNumber: string | null;
  resolver: string | null;
  source: "ens-text-record" | "local-demo";
  note: string;
};

export function PayoutDerivation({
  request,
  offer,
  sessionId,
  payouts,
  onChanged,
}: PayoutDerivationProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);

  const ensName = request.ensName;
  const mine = payouts.filter((row) => row.offerId === offer.id);

  const derive = useCallback(async () => {
    if (!ensName) {
      setError(
        "This request carries no ENS name, so there is nothing to resolve and no payout key to derive against.",
      );
      return;
    }
    setBusy(true);
    setError(null);

    try {
      /**
       * The real path first, always. Only if the chain read produces no usable
       * key does the demo fallback come into play, and the announcement then
       * records `local-demo` so nobody downstream can mistake the two.
       */
      const read = await readPayoutRecord(ensName);

      let recipientPublicKey: Uint8Array;
      let next: Evidence;

      if (read.ok && read.publicKey) {
        recipientPublicKey = read.publicKey;
        next = {
          value: read.value,
          blockNumber: String(read.blockNumber),
          resolver: read.resolver,
          source: "ens-text-record",
          note: `Read from ${PAYOUT_RECORD_KEY} on ${ensName} at block ${String(read.blockNumber)}.`,
        };
      } else if (request.payoutKey && request.payoutKeySource === "local-demo") {
        recipientPublicKey = hexToBytesStrict(request.payoutKey, "payoutKey");
        next = {
          value: read.ok ? read.value : null,
          blockNumber: read.ok ? String(read.blockNumber) : null,
          resolver: read.ok ? read.resolver : null,
          source: "local-demo",
          note: read.ok
            ? `${ensName} has no usable ${PAYOUT_RECORD_KEY} record${
                read.decodeError ? ` (${read.decodeError})` : ""
              }. Falling back to the key the applicant shipped with the request.`
            : `The ENS read failed: ${read.error}. Falling back to the key the applicant shipped with the request.`,
        };
      } else {
        setError(
          read.ok
            ? `${ensName} has no usable ${PAYOUT_RECORD_KEY} record${
                read.decodeError ? ` — ${read.decodeError}` : ""
              }, and the request carries no demo key either. There is no key to pay to.`
            : `Could not read ${ensName} on Sepolia: ${read.error}`,
        );
        return;
      }

      // A fresh ephemeral scalar per call. `derivePayoutAddress` draws one from
      // the platform CSPRNG unless a test hands it one; reusing one across two
      // draws under the same requestId would link them, which is the one thing
      // this leg exists to prevent.
      const announcement = derivePayoutAddress({
        recipientPublicKey,
        requestId: request.id,
      });

      await announcePayout({
        sessionId,
        requestId: request.id,
        offerId: offer.id,
        ensName,
        ephemeralPublicKey: bytesToHex0x(announcement.ephemeralPublicKey),
        viewTag: announcement.viewTag,
        payoutAddress: announcement.solanaAddress,
        keySource: next.source,
        ensBlockNumber: next.blockNumber,
        ensRecordValue: next.value,
      });

      setEvidence(next);
      onChanged();
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
  }, [ensName, offer.id, onChanged, request.id, request.payoutKey, request.payoutKeySource, sessionId]);

  /**
   * Derive once, automatically, the first time this offer has no payout
   * address. Funding without a payout destination is a half-finished action,
   * and making the lender press a second button to complete it would be an
   * invented step. Every later derivation is deliberate.
   */
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || busy || mine.length > 0 || !ensName) return;
    autoRan.current = true;
    void derive();
  }, [busy, derive, ensName, mine.length]);

  return (
    <section className="payout-panel">
      <div className="proof-section-heading">
        <span>
          <Send size={15} /> Payout destination · derived from ENS
        </span>
        <small>
          {mine.length === 0
            ? "None derived yet"
            : `${mine.length} one-time address${mine.length === 1 ? "" : "es"} for this request`}
        </small>
      </div>

      {!ensName ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>This request carries no ENS identity</strong>
            <span>
              The payout address is derived from the applicant&apos;s ENS name and nothing else.
              Without one there is no key to resolve, and this client has no other way to learn where
              to send funds — there is no borrower-address field in the protocol.
            </span>
          </div>
        </div>
      ) : (
        <p className="provenance-note">
          Resolving <strong>{ensName}</strong> is the only way to obtain the address below. The
          protocol has no field carrying the applicant&apos;s Solana address, and the addresses in
          this list are unlinkable to it and to each other: without the applicant&apos;s X25519
          viewing scalar, <code>R</code> is an unrelated curve point and the view tag is one byte of
          a hash only the two parties can compute.
        </p>
      )}

      {evidence ? (
        <dl className="identity-details">
          <div>
            <dt>Key source</dt>
            <dd>{evidence.source}</dd>
          </div>
          <div>
            <dt>Resolver</dt>
            <dd title={evidence.resolver ?? undefined}>
              {evidence.resolver ? `${evidence.resolver.slice(0, 10)}…${evidence.resolver.slice(-6)}` : "—"}
            </dd>
          </div>
          <div>
            <dt>text() returned at block {evidence.blockNumber ?? "—"}</dt>
            <dd title={evidence.value ?? undefined}>
              {evidence.value === null
                ? "no read"
                : evidence.value === ""
                  ? '"" (empty string)'
                  : `${evidence.value.slice(0, 24)}…`}
            </dd>
          </div>
        </dl>
      ) : null}

      {evidence?.source === "local-demo" ? (
        <div className="inline-state" role="note">
          <ShieldAlert size={19} />
          <div>
            <strong>Derived against a demo key, not an ENS record</strong>
            <span>
              {evidence.note} Nothing on chain attests that key, so this particular derivation proves
              the mechanism rather than the trust model. In production this fallback does not exist:
              the lender resolves the name or does not pay.
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>The payout address could not be derived</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {mine.length > 0 ? (
        <ul className="payout-list">
          {mine.map((row, index) => (
            <li key={row.id}>
              <div className="payout-list__head">
                <strong className="mono-value">{row.payoutAddress}</strong>
                <StatusPill tone={index === 0 ? "success" : "neutral"}>
                  draw {mine.length - index}
                </StatusPill>
              </div>
              <dl className="payout-list__facts">
                <div>
                  <dt>Ephemeral key R</dt>
                  <dd title={row.ephemeralPublicKey}>
                    {row.ephemeralPublicKey.slice(0, 14)}…{row.ephemeralPublicKey.slice(-6)}
                  </dd>
                </div>
                <div>
                  <dt>View tag</dt>
                  <dd>0x{row.viewTag.toString(16).padStart(2, "0")}</dd>
                </div>
                <div>
                  <dt>Key source</dt>
                  <dd>{row.keySource}</dd>
                </div>
                <div>
                  <dt>Derived at</dt>
                  <dd>{new Date(row.createdAt).toISOString().slice(11, 19)}Z</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}

      {mine.length > 1 ? (
        <p className="provenance-note">
          <strong>Same ENS name, different addresses.</strong> Every row above was derived from the
          one X25519 key published under {ensName}, and no two of them share an address. An observer
          watching Solana sees unrelated accounts; only the holder of the viewing scalar can tell
          they belong to one identity.
        </p>
      ) : null}

      <div className="task-card__action">
        <span className="action-note">
          <EyeOff size={15} /> The applicant&apos;s own Solana address is never sent to this client
        </span>
        <Button
          variant="secondary"
          disabled={busy || !ensName}
          icon={busy ? <Spinner /> : <RefreshCw size={15} />}
          onClick={() => void derive()}
        >
          {busy ? "Deriving" : mine.length === 0 ? "Derive a payout address" : "Derive another"}
        </Button>
      </div>
    </section>
  );
}
