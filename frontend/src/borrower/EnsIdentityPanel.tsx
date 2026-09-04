/**
 * Step 1 — the identity. BORROWER-ONLY.
 *
 * Connect an Ethereum wallet on Sepolia, sign once to derive the viewing key,
 * and make sure the wallet's ENS name publishes that key. If the record is
 * missing, one button sends the real `setText` from the wallet. The evidence
 * for every claim (the four reads, the raw record, the tx hash) sits behind
 * one disclosure.
 */

import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Fingerprint,
  KeyRound,
  Search,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";

import { Button, Card, Disclosure, Spinner, StatusPill, Verdict } from "../components/ui";
import { PAYOUT_RECORD_KEY, bytesToHex0x } from "../shared/ensPayout";
import { ENS_CHAIN } from "../shared/ensClient";
import { ethereumWalletName, shortAddress } from "../shared/wallets";
import { isLikelyEnsName, useEnsIdentity } from "./ensIdentity";

const ENS_APP = "https://app.ens.dev";

export function EnsIdentityPanel() {
  const ens = useEnsIdentity();
  const [draft, setDraft] = useState("");

  const resolving = ens.status === "resolving";
  const resolution = ens.resolution;
  const registered = Boolean(resolution?.owner) || resolution?.registry === "ensv2";
  const onChainKey = ens.onChainPayoutKey;
  const busy = ens.walletStatus === "connecting" || ens.walletStatus === "signing";
  const publishing = ens.publishStatus !== "idle";
  const typed = ens.name || draft;

  const pill = ens.ready ? (
    <StatusPill tone="success">
      <Check size={13} /> Ready
    </StatusPill>
  ) : ens.wallet ? (
    <StatusPill tone="warning">Setup needed</StatusPill>
  ) : (
    <StatusPill tone="neutral">Not connected</StatusPill>
  );

  return (
    <Card className="task-card task-card--auto">
      <div className="task-card__heading">
        <span className="task-icon">
          <Fingerprint size={22} />
        </span>
        <div>
          <span className="section-label">Step 1 · Identity</span>
          <h2>Your ENS domain</h2>
          <p>
            Lenders never learn your address. They pay a one-time Solana address derived from a
            key published under your ENS domain on {ENS_CHAIN.name}.
          </p>
        </div>
        {pill}
      </div>

      {/* ------------------------------------------------------- 1. wallet */}

      <div className="wallet-row">
        {ens.wallet ? (
          <>
            <span className="wallet-chip">
              <Wallet size={14} /> {shortAddress(ens.wallet)}
              <small>{ethereumWalletName()} · Sepolia</small>
            </span>
            <span className={ens.viewing ? "wallet-chip wallet-chip--ok" : "wallet-chip"}>
              <KeyRound size={14} />
              {ens.viewing ? "Viewing key derived" : "Viewing key not signed"}
            </span>
            {!ens.viewing ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                icon={busy ? <Spinner /> : <KeyRound size={15} />}
                onClick={() => void ens.signViewingKey()}
              >
                Sign to derive key
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            type="button"
            disabled={busy}
            icon={busy ? <Spinner /> : <Wallet size={16} />}
            onClick={() => void ens.connectWallet()}
          >
            {ens.walletStatus === "connecting"
              ? "Connecting"
              : ens.walletStatus === "signing"
                ? "Sign in your wallet"
                : `Connect ${ethereumWalletName()}`}
          </Button>
        )}
      </div>

      {ens.walletError ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Wallet</strong>
            <span>{ens.walletError}</span>
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- 2. name */}

      {ens.wallet ? (
        <>
          <div className="ens-panel">
            <label className="form-field">
              <span>ENS name this wallet owns</span>
              <input
                className="text-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="yourname.eth"
                value={typed}
                disabled={resolving || publishing}
                onChange={(event) => {
                  setDraft(event.target.value);
                  ens.setName(event.target.value);
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={resolving || publishing || !isLikelyEnsName(typed)}
              icon={resolving ? <Spinner /> : <Search size={15} />}
              onClick={() => void ens.resolve(typed)}
            >
              {resolving ? "Reading" : "Look up"}
            </Button>
          </div>

          {ens.status === "error" && ens.error ? (
            <Verdict tone="danger" icon={<AlertTriangle size={15} />} title="That name could not be read">
              {ens.error}
            </Verdict>
          ) : !resolution ? (
            <Verdict tone="pending" icon={<Search size={15} />} title="Enter the ENS name you own">
              No primary name was found for this wallet on {ENS_CHAIN.name}. Type one you own, or{" "}
              <a href={ENS_APP} target="_blank" rel="noreferrer">
                register one on ENSv2 <ArrowUpRight size={12} />
              </a>{" "}
              (a few minutes, test USDC plus a little Sepolia ETH).
            </Verdict>
          ) : !registered ? (
            <Verdict tone="danger" icon={<X size={15} />} title={`${ens.name} is not registered`}>
              <a href={`${ENS_APP}/${ens.name}`} target="_blank" rel="noreferrer">
                Register it on {ENS_CHAIN.name} <ArrowUpRight size={12} />
              </a>
              , then look it up again.
            </Verdict>
          ) : onChainKey && ens.keysAgree ? (
            <Verdict
              tone="success"
              icon={<Check size={15} />}
              title={`${ens.name} publishes your payout key`}
            >
              Lenders read <code>{PAYOUT_RECORD_KEY}</code> from this name and derive a fresh
              address for every draw. You are ready to list a request.
            </Verdict>
          ) : onChainKey && !ens.viewing ? (
            <Verdict tone="warning" icon={<KeyRound size={15} />} title="Sign to unlock this identity">
              A payout key is published, but this tab has not derived yours yet. Sign the message
              above with the wallet that published it.
            </Verdict>
          ) : onChainKey ? (
            <Verdict
              tone="danger"
              icon={<ShieldAlert size={15} />}
              title="This name publishes a different key"
            >
              Payments would go to a key this wallet cannot recover. Replace the record with this
              wallet&apos;s key, or connect the wallet that published it.
            </Verdict>
          ) : (
            <Verdict tone="warning" icon={<ShieldAlert size={15} />} title="No payout key published yet">
              One transaction from your wallet writes it to the resolver. Until then no lender can
              pay you.
            </Verdict>
          )}

          {resolution && registered && !(onChainKey && ens.keysAgree) ? (
            <div className="task-card__action task-card__action--flush">
              <span className="action-note">
                {publishing
                  ? ens.publishStatus === "sending"
                    ? "Confirm the transaction in your wallet"
                    : "Waiting for Sepolia to mine it"
                  : `setText(${PAYOUT_RECORD_KEY}) on the resolver, signed by your wallet`}
              </span>
              <Button
                type="button"
                disabled={publishing || !ens.viewing}
                icon={publishing ? <Spinner /> : <ArrowUpRight size={16} />}
                onClick={() => void ens.publishRecord()}
              >
                {publishing
                  ? "Publishing"
                  : onChainKey
                    ? "Replace the record"
                    : "Publish payout key to ENS"}
              </Button>
            </div>
          ) : null}

          {ens.publishError ? (
            <div className="inline-state inline-state--danger" role="alert">
              <AlertTriangle size={19} />
              <div>
                <strong>The record was not published</strong>
                <span>{ens.publishError}</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ----------------------------------------------------- 3. evidence */}

      {resolution ? (
        <Disclosure
          summary="On-chain evidence"
          count={`${ENS_CHAIN.name} · block ${String(resolution.blockNumber)}`}
        >
          <dl className="identity-details">
            <div>
              <dt>Registry</dt>
              <dd>{resolution.registry === "ensv2" ? "ENSv2 (hierarchical)" : "ENSv1 (legacy)"}</dd>
            </div>
            <div>
              <dt>Registry owner</dt>
              <dd title={resolution.owner ?? undefined}>
                {resolution.owner ? shortAddress(resolution.owner) : "unregistered"}
              </dd>
            </div>
            <div>
              <dt>Resolver</dt>
              <dd title={resolution.resolver ?? undefined}>
                {resolution.resolver ? shortAddress(resolution.resolver) : "none set"}
              </dd>
            </div>
            <div>
              <dt>addr(node)</dt>
              <dd title={resolution.address ?? undefined}>
                {resolution.address ? shortAddress(resolution.address) : "not set"}
              </dd>
            </div>
            <div>
              <dt>Reverse record</dt>
              <dd>
                {ens.reverse === null
                  ? "not attempted"
                  : ens.reverse.name === null
                    ? "not set"
                    : ens.reverse.forwardMatches
                      ? `${ens.reverse.name} (round trip holds)`
                      : `${ens.reverse.name} (forward mismatch)`}
              </dd>
            </div>
            <div>
              <dt>{PAYOUT_RECORD_KEY}</dt>
              <dd title={ens.payoutRecord?.value}>
                {ens.payoutRecord === null
                  ? "no read"
                  : ens.payoutRecord.value === ""
                    ? '"" (unset)'
                    : ens.payoutRecord.value}
              </dd>
            </div>
            <div>
              <dt>This wallet&apos;s key</dt>
              <dd title={ens.viewing ? bytesToHex0x(ens.viewing.publicKey) : undefined}>
                {ens.viewing ? shortAddress(bytesToHex0x(ens.viewing.publicKey)) : "not signed"}
              </dd>
            </div>
          </dl>
          {ens.publishTx ? (
            <p className="provenance-note">
              Published in{" "}
              <a href={`${ENS_CHAIN.explorer}/tx/${ens.publishTx}`} target="_blank" rel="noreferrer">
                {shortAddress(ens.publishTx)} <ArrowUpRight size={12} />
              </a>
            </p>
          ) : null}
          <p className="provenance-note">
            ENSv2 is read first through <code>UniversalResolverV2.findResolver</code> /{" "}
            <code>resolve</code>; the legacy v1 registry is the fallback. The viewing key is HKDF over a{" "}
            <code>personal_sign</code>, so the same wallet reproduces it anywhere; nothing is
            stored.
          </p>
        </Disclosure>
      ) : null}
    </Card>
  );
}
