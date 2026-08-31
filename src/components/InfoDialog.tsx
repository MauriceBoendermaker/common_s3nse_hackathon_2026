import { useEffect, useRef, useState } from 'react';
import { X, Database, ShieldCheck, ExternalLink, LoaderCircle } from 'lucide-react';
import type { ProviderHealth } from '../../shared/types';
import { getHealth, verifyMobulaKey } from '../lib/api';

export function InfoDialog({
  open,
  onClose,
  health,
  onHealthChange,
}: {
  open: boolean;
  onClose: () => void;
  health: ProviderHealth | null;
  onHealthChange: (health: ProviderHealth) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void getHealth(controller.signal)
      .then(onHealthChange)
      .catch(() => {});
    return () => controller.abort();
  }, [open, onHealthChange]);

  async function verify() {
    setVerifying(true);
    setVerifyError('');
    try {
      onHealthChange(await verifyMobulaKey());
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : 'Could not run the provider check.');
    } finally {
      setVerifying(false);
    }
  }
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="info-title"
    >
      <div className="dialog-content">
        <button
          className="dialog-close icon-button"
          onClick={onClose}
          aria-label="Close data and privacy information"
        >
          <X size={19} />
        </button>
        <span className="eyebrow">UNDER THE HOOD</span>
        <h2 id="info-title">Your data. No guesswork.</h2>
        <p>
          Footprint follows records published through ENS and, when available, reads portfolios from
          Mobula. It does not infer identity from transaction patterns.
        </p>
        <h3>
          <Database size={17} />
          Data providers
        </h3>
        <div className="provider-row">
          <strong>ENS</strong>
          <span>{health?.ens.label || 'API status unavailable'}</span>
        </div>
        <div className="provider-row">
          <strong>Mobula</strong>
          <span>{health?.mobula.label || 'API status unavailable'}</span>
        </div>
        <div className="provider-verification">
          <button
            className="primary-button"
            disabled={
              verifying ||
              !health?.mobula.configured ||
              health?.access?.diagnosticsEnabled === false
            }
            onClick={() => void verify()}
          >
            {verifying ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
            {verifying ? 'Checking Mobula…' : 'Verify Mobula key'}
          </button>
          <p>
            {health?.access?.diagnosticsEnabled === false &&
              'Diagnostics are disabled on this hosted demo. '}
            Clicking sends the server-side key to the configured Mobula endpoint for one portfolio
            request using a fixed public test address. It may use API credits. Your ENS name is not
            sent, and the key is never displayed here.
          </p>
          {health?.mobula.lastCheck && (
            <div
              className={`provider-check ${health.mobula.lastCheck.ok ? 'success' : 'failure'}`}
              role="status"
            >
              <strong>
                {health.mobula.lastCheck.ok
                  ? 'Portfolio access verified'
                  : 'Provider check did not succeed'}
              </strong>
              <p>{health.mobula.lastCheck.message}</p>
              {health.mobula.lastCheck.detail && (
                <p>Provider explanation: {health.mobula.lastCheck.detail}</p>
              )}
              <small>
                {health.mobula.lastCheck.code}
                {health.mobula.lastCheck.httpStatus
                  ? ` · HTTP ${health.mobula.lastCheck.httpStatus}`
                  : ''}{' '}
                · {new Date(health.mobula.lastCheck.checkedAt).toLocaleTimeString()}
              </small>
            </div>
          )}
          {verifyError && <p role="alert">{verifyError}</p>}
        </div>
        <p>
          If you do not have <code>.env</code>, copy <code>.env.example</code> first. Set{' '}
          <code>MOBULA_API_KEY</code> locally, and restart the API. Never paste a secret into this
          page or a <code>VITE_*</code> variable.
        </p>
        <p>
          After a successful check, rerun your live ENS lookup to refresh its holdings. A key check
          does not update an existing snapshot.{' '}
          <a className="text-link" href="https://admin.mobula.io" target="_blank" rel="noreferrer">
            Manage your Mobula key <ExternalLink size={13} />
          </a>
        </p>
        <p>
          Set <code>ETH_RPC_URL</code> to an Ethereum mainnet RPC if the default public endpoint is
          unavailable. Configured credentials are not proof of a healthy upstream connection.
        </p>
        <h3>
          <ShieldCheck size={17} />
          What this prototype promises
        </h3>
        <ul>
          <li>
            No database, analytics, report persistence, remote avatar loading, or application
            request logging.
          </li>
          <li>
            Queries travel through the local API to the configured RPC and, for holdings, Mobula.
            Those services can observe requests.
          </li>
          <li>
            Ten supported ENS records are checked with strict reads. Ethereum and Base portfolios
            and optional 30-day activity samples are supported. Full history and ownership
            clustering are not.
          </li>
          <li>
            Offchain CCIP-read is disabled to prevent arbitrary server-side gateway requests. Some
            names may not resolve.
          </li>
          <li>
            The permission checkbox is an acknowledgment, not proof of ownership. Hosted mode
            restricts live names and draft wallets, disables key verification and bounds provider
            work.
          </li>
          <li>
            A lower number of links in a preview does not mean anonymity. Previous disclosures
            cannot be undone here.
          </li>
          <li>
            Exact edit simulation supports the pinned ENS Public Resolver with hasAddr and Default
            EVM fallback. Other resolver behavior stays unknown. Name-control roles are separate
            from payment addresses.
          </li>
          <li>
            Imported JSON is unverified, local evidence. Exports may contain public profile and
            financial information. No snapshot is persisted by the service.
          </li>
          <li>
            Re-audit compares observed records at a newer block. It does not verify the sender of a
            transaction or promise that historical links disappeared.
          </li>
        </ul>
        <a
          className="text-link"
          href="https://docs.ens.domains/web/resolution/"
          target="_blank"
          rel="noreferrer"
        >
          Read the ENS resolution documentation <ExternalLink size={14} />
        </a>
      </div>
    </dialog>
  );
}
