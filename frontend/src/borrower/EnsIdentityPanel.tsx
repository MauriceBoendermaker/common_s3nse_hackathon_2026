/**
 * Step 1, second half — the ENS identity.
 *
 * BORROWER-ONLY. This panel used to be a placeholder that said "Workstream D ·
 * pending" and rendered three planned-role rows. It now performs four real
 * Sepolia reads and prints what each one returned, including the empty string.
 *
 * WHY EVERY VALUE IS SHOWN RAW. The ENS manager app does not display a custom
 * text-record key like `privatecredit.payout-key[501]`, so a screenshot of it
 * would be evidence of nothing. The only honest evidence that the record does
 * or does not exist is a direct `text(node, key)` call against the resolver the
 * registry itself names — the node, the resolver address, the block number and
 * the verbatim returned string are therefore all on screen, and a missing
 * record is rendered as a missing record with the exact command that would fix
 * it, never as a checkmark.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Fingerprint,
  KeyRound,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

import { Button, Spinner, StatusPill } from "../components/ui";
import { PAYOUT_KEY_SIGN_MESSAGE, PAYOUT_RECORD_KEY, bytesToHex0x } from "../shared/ensPayout";
import { ENS_CHAIN } from "../shared/ensClient";
import { shortHash, subjectCommitment as deriveSubjectCommitment } from "../shared/policy";
import { isLikelyEnsName, setupCommand, useEnsIdentity } from "./ensIdentity";
import { useWitness } from "./witnessStore";

/** `0x1234…abcd`, or the whole thing when it is already short. */
function abbreviate(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function EnsIdentityPanel() {
  const ens = useEnsIdentity();
  const witness = useWitness();
  const [signature, setSignature] = useState("");
  const [subject, setSubject] = useState<string | null>(null);

  const blindingFactor = witness.blindingFactor;
  const name = ens.name;

  /**
   * The subject commitment, recomputed whenever the identity or the blinding
   * factor changes. It is shown here rather than only inside the receipt so
   * the applicant can see, before publishing anything, exactly which value
   * represents them — and that it is not their name.
   */
  useEffect(() => {
    let live = true;
    if (!name || !blindingFactor) {
      setSubject(null);
      return () => {
        live = false;
      };
    }
    void deriveSubjectCommitment(name, blindingFactor).then((value) => {
      if (live) setSubject(value);
    });
    return () => {
      live = false;
    };
  }, [name, blindingFactor]);

  const resolving = ens.status === "resolving";
  const record = ens.payoutRecord;
  const resolution = ens.resolution;
  const registered = resolution?.owner !== null && resolution?.owner !== undefined;
  const onChainKey = ens.onChainPayoutKey;
  const derivedKey = ens.viewing ? bytesToHex0x(ens.viewing.publicKey) : null;
  const keysAgree =
    onChainKey !== null && derivedKey !== null && bytesToHex0x(onChainKey) === derivedKey;

  return (
    <div className={onChainKey ? "identity-record" : "identity-record identity-record--pending"}>
      <div className="identity-record__title">
        <span className="avatar avatar--large" aria-hidden="true">
          <Fingerprint size={18} />
        </span>
        <span>
          <strong>ENS identity</strong>
          <small>
            The applicant&apos;s only public identifier, and the sole input to the payout address.
            Read live from {ENS_CHAIN.name}.
          </small>
        </span>
        {onChainKey ? (
          <StatusPill tone="success">Payout key read from ENS</StatusPill>
        ) : ens.viewing ? (
          <StatusPill tone="warning">Local demo key</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not resolved</StatusPill>
        )}
      </div>

      <div className="ens-panel">
        <label className="form-field">
          <span>ENS name</span>
          <input
            className="text-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. privatecredit.eth"
            value={ens.name}
            disabled={resolving}
            onChange={(event) => ens.setName(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={resolving || !isLikelyEnsName(ens.name)}
          icon={resolving ? <Spinner /> : <Search size={15} />}
          onClick={() => void ens.resolve()}
        >
          {resolving ? "Reading Sepolia" : "Resolve on Sepolia"}
        </Button>
      </div>

      <p className="provenance-note">
        Four reads, none of them ours: registry <code>owner(node)</code>, registry{" "}
        <code>resolver(node)</code>, resolver <code>addr(node)</code>, and resolver{" "}
        <code>text(node, &quot;{PAYOUT_RECORD_KEY}&quot;)</code>. Deliberately not{" "}
        <code>getEnsText()</code> — that routes through the UniversalResolver and adds CCIP-Read
        behaviour we would then have to explain. This is the plainest call there is.
      </p>

      {ens.status === "error" && ens.error ? (
        <div className="inline-state inline-state--danger" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>The name could not be resolved</strong>
            <span>{ens.error}</span>
          </div>
        </div>
      ) : null}

      {resolution ? (
        <>
          <dl className="identity-details">
            <div>
              <dt>namehash(node)</dt>
              <dd title={resolution.node}>{abbreviate(resolution.node)}</dd>
            </div>
            <div>
              <dt>Registry owner</dt>
              <dd title={resolution.owner ?? undefined}>
                {resolution.owner ? abbreviate(resolution.owner) : "unregistered — no owner"}
              </dd>
            </div>
            <div>
              <dt>Resolver</dt>
              <dd title={resolution.resolver ?? undefined}>
                {resolution.resolver ? abbreviate(resolution.resolver) : "none set"}
              </dd>
            </div>
            <div>
              <dt>addr(node)</dt>
              <dd title={resolution.address ?? undefined}>
                {resolution.address ? abbreviate(resolution.address) : "not set"}
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
                      : `${ens.reverse.name} (forward does NOT match)`}
              </dd>
            </div>
            <div>
              <dt>Read at block</dt>
              <dd>{String(resolution.blockNumber)}</dd>
            </div>
          </dl>

          <div className={onChainKey ? "hash-check" : "hash-check hash-check--fail"}>
            <span className="hash-check__mark" aria-hidden="true">
              {onChainKey ? <Check size={13} /> : <X size={13} />}
            </span>
            <span>
              <strong>
                {record === null
                  ? `No text() read happened for ${PAYOUT_RECORD_KEY}`
                  : onChainKey
                    ? `${PAYOUT_RECORD_KEY} is set and parses`
                    : `${PAYOUT_RECORD_KEY} is not usable on this name`}
              </strong>
              <small>
                {record === null ? (
                  <>
                    The name has no resolver, or the RPC call failed. That is not the same as
                    &quot;the record is empty&quot;, so nothing is claimed either way.
                  </>
                ) : (
                  <>
                    Raw value returned by <code>text()</code> at block {String(record.blockNumber)}:{" "}
                    <code className="raw-record">
                      {record.value === "" ? '"" (empty string)' : record.value}
                    </code>
                    {record.decodeError ? <> — {record.decodeError}</> : null}
                  </>
                )}
              </small>
            </span>
          </div>
        </>
      ) : null}

      {resolution && !onChainKey ? (
        <div className="inline-state" role="note">
          <ShieldAlert size={19} />
          <div>
            <strong>Publish the record to make this the real path</strong>
            <span>
              Nothing here fakes it. To set the record for real, from the repo root with a funded
              Sepolia key:
              <br />
              <code className="raw-record">{setupCommand(ens.name || "yourname.eth", registered)}</code>
              <br />
              {registered
                ? null
                : "The name has no registry owner, so it has to be registered first — that command commits, waits out minCommitmentAge and registers with the setText embedded, so the name is never live without the record."}{" "}
              Until then, the key below travels with the credit request and is marked{" "}
              <code>local-demo</code> on every screen that uses it. In production that field does
              not exist: the lender resolves the name or cannot pay.
            </span>
          </div>
        </div>
      ) : null}

      <div className="ens-key-block">
        <div className="proof-section-heading">
          <span>
            <KeyRound size={15} /> Viewing key
          </span>
          <small>X25519 · never leaves this tab</small>
        </div>

        <p className="provenance-note">
          The key is derived, not stored: HKDF-SHA256 over a <code>personal_sign</code> signature,
          clamped per RFC 7748 §5. The signature is deterministic per wallet (RFC 6979), so the same
          wallet reproduces the same key on any device with nothing backed up. Paste one below, or
          generate demo material if you have no wallet connected here — both go through the identical
          derivation, and the second is labelled as demo material everywhere it appears.
        </p>

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
            Derive from signature
          </Button>
          <Button type="button" variant="quiet" onClick={() => ens.generateDemoKey()}>
            Generate demo key material
          </Button>
        </div>

        {ens.viewingError ? (
          <div className="inline-state inline-state--danger" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>That is not usable signature material</strong>
              <span>{ens.viewingError}</span>
            </div>
          </div>
        ) : null}

        {ens.viewing && derivedKey ? (
          <dl className="identity-details">
            <div>
              <dt>Derived X25519 public key</dt>
              <dd title={derivedKey}>{abbreviate(derivedKey)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {ens.viewingSource === "signature"
                  ? "personal_sign (reproducible)"
                  : "local demo material (this tab only)"}
              </dd>
            </div>
            <div>
              <dt>Record value it would publish</dt>
              <dd title={ens.recordValue ?? undefined}>{abbreviate(ens.recordValue ?? "")}</dd>
            </div>
          </dl>
        ) : null}

        {onChainKey && derivedKey ? (
          <div className={keysAgree ? "hash-check" : "hash-check hash-check--fail"}>
            <span className="hash-check__mark" aria-hidden="true">
              {keysAgree ? <Check size={13} /> : <X size={13} />}
            </span>
            <span>
              <strong>
                {keysAgree
                  ? "The published record is this tab's key"
                  : "The published record is a DIFFERENT key"}
              </strong>
              <small>
                {keysAgree
                  ? "The lender will derive against the key ENS published, and this tab holds the scalar that recovers it."
                  : "The lender derives against what ENS published, which is correct. This tab cannot recover a payout made to that key — derive the viewing key from the wallet that owns the record."}
              </small>
            </span>
          </div>
        ) : null}
      </div>

      <div className="ens-key-block">
        <div className="proof-section-heading">
          <span>Subject commitment · public signal [3]</span>
          <small>Poseidon2(utf8ToField(ensName), blindingFactor)</small>
        </div>
        <dl className="identity-details">
          <div>
            <dt>Identity committed</dt>
            <dd>{ens.name || "— enter a name"}</dd>
          </div>
          <div>
            <dt>Blinding factor</dt>
            <dd>{blindingFactor ? `${shortHash(blindingFactor)} · never published` : "— read a passport first"}</dd>
          </div>
          <div>
            <dt>subjectCommitment</dt>
            <dd title={subject ?? undefined}>{subject ? shortHash(subject) : "—"}</dd>
          </div>
        </dl>
        <p className="provenance-note">
          <strong>The raw namehash is deliberately not what gets published.</strong>{" "}
          <code>namehash(&quot;alice.eth&quot;)</code> is unsalted and publicly computable, so anyone
          holding a list of ENS names can hash the whole list once and invert every namehash they
          ever see. The blinding factor is fresh per passport and never leaves this tab, which turns
          a lookup table into a search over the whole field.
        </p>
      </div>
    </div>
  );
}
