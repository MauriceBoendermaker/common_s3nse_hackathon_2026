import { useState } from 'react';
import { ArrowUpRight, Check, Copy, FileSearch, Info, Layers3 } from 'lucide-react';
import type { AuditReport } from '../../shared/types';
import { money, number } from '../lib/format';
import { RecordIcon } from './RecordIcon';

export function EvidencePanel({ report, selectedId }: { report: AuditReport; selectedId: string }) {
  const record = report.records.find((item) => item.id === selectedId);
  const state = report.recordStates?.find((item) => item.id === selectedId);
  const wallet = report.wallets.find((item) => `wallet:${item.id}` === selectedId);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const value = record?.value || wallet?.address || report.name;
  const source =
    report.mode === 'demo' ? 'Synthetic fixture' : wallet ? 'Mobula API' : 'ENS · Ethereum mainnet';
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <aside className="evidence-panel">
      <div className="inspector-heading">
        <FileSearch size={17} />
        <span>EVIDENCE INSPECTOR</span>
      </div>
      <div className="evidence-icon">
        {record ? (
          <RecordIcon record={record} size={24} />
        ) : wallet ? (
          <Layers3 size={24} />
        ) : (
          <FileSearch size={24} />
        )}
      </div>
      <h2>{record?.label || (wallet ? `${wallet.chain} holdings` : 'The starting point')}</h2>
      <p className="evidence-description">
        {record
          ? 'A value returned by this name’s resolver. This is a declared connection, not proof that the name holder owns the referenced account.'
          : wallet
            ? wallet.message
            : 'The name is the entry point. Its resolver can publish address and profile records that anyone can read.'}
      </p>
      <div className="evidence-value">
        <span className="eyebrow">
          {record ? 'RECORD VALUE' : wallet ? 'QUERIED ADDRESS' : 'NORMALIZED NAME'}
        </span>
        <code>{value}</code>
        <button
          onClick={() => void copy()}
          className="copy-button"
          aria-label="Copy evidence value"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <span className="sr-only" role="status">
          {copied
            ? 'Copied to clipboard'
            : copyError
              ? 'Copy unavailable. Select the value to copy it manually.'
              : ''}
        </span>
      </div>
      <dl className="evidence-metadata">
        {state && (
          <div>
            <dt>Record origin</dt>
            <dd>
              {state.origin === 'default'
                ? 'Default EVM fallback'
                : state.origin === 'explicit'
                  ? 'Explicit stored record'
                  : 'Unverified origin'}
            </dd>
          </div>
        )}
        {wallet?.providerCheck && (
          <div>
            <dt>Provider result</dt>
            <dd>
              {wallet.providerCheck.code}
              {wallet.providerCheck.httpStatus ? ` · HTTP ${wallet.providerCheck.httpStatus}` : ''}
            </dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>
            <span className={`status-dot ${report.mode === 'demo' ? 'amber' : ''}`} />
            {source}
          </dd>
        </div>
        {record && (
          <div>
            <dt>Record key</dt>
            <dd>
              <code>{record.key}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>{wallet ? 'Fetched' : 'Observed'}</dt>
          <dd>
            {new Date(wallet?.providerCheck?.checkedAt || report.observedAt).toLocaleTimeString(
              [],
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            )}
          </dd>
        </div>
        <div>
          <dt>{wallet ? 'ENS records block' : 'ENS block'}</dt>
          <dd>{report.blockNumber || 'Not applicable · demo'}</dd>
        </div>
      </dl>
      {state && (
        <div className="provenance-note">
          <strong>Why this connection exists</strong>
          <p>{state.explanation}</p>
          {state.origin === 'default' && (
            <p>
              Clearing a chain override can leave this Default route intact. Review both in
              Publishing preview.
            </p>
          )}
        </div>
      )}
      {wallet && (
        <div className="asset-list">
          <span className="eyebrow">OBSERVED ASSETS</span>
          {report.mode === 'live' && (
            <p className="subtle">
              Portfolio value includes native assets and tokens. It is not the explorer’s native ETH
              value. Holdings are fetched separately, not pinned to the ENS records block.
            </p>
          )}
          {wallet.assets.length ? (
            wallet.assets.map((asset, index) => (
              <div className="asset-evidence" key={`${asset.symbol}:${index}`}>
                <div className="asset-row">
                  <span className="asset-symbol">{asset.symbol.slice(0, 1)}</span>
                  <span>
                    <strong
                      title={`${asset.name} · ${asset.symbol}${asset.contractAddress ? ` · ${asset.contractAddress}` : ''}`}
                    >
                      {asset.symbol}
                    </strong>
                    <small>
                      {number(asset.balance)}{' '}
                      {asset.kind === 'native'
                        ? 'native ETH'
                        : asset.kind === 'wrapped'
                          ? 'wrapped ETH'
                          : 'tokens'}
                    </small>
                  </span>
                  <strong>{money(asset.valueUsd)}</strong>
                </div>
                <div className="token-identities">
                  {asset.identities?.length ? (
                    asset.identities.map((identity) => (
                      <div key={`${identity.chain}:${identity.address}`}>
                        <span>
                          {identity.chain} ·{' '}
                          {identity.address.toLowerCase() ===
                          '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
                            ? 'native asset'
                            : 'contract'}
                        </span>
                        {report.mode === 'live' &&
                        identity.address.toLowerCase() !==
                          '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? (
                          <a
                            href={`${identity.chain === 'Ethereum' ? 'https://etherscan.io' : 'https://basescan.org'}/token/${identity.address}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <code>{identity.address}</code>
                            <ArrowUpRight size={12} />
                          </a>
                        ) : (
                          <code>{identity.address}</code>
                        )}
                      </div>
                    ))
                  ) : (
                    <span>
                      Contract identity not supplied by the provider. Symbol alone is not identity.
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="subtle">
              {wallet.status === 'ready'
                ? 'No assets returned by the provider. Coverage and filters may omit assets.'
                : 'No portfolio data is available.'}
            </p>
          )}
          {wallet.truncated && (
            <p className="subtle">Showing the eight highest-valued asset positions.</p>
          )}
          {wallet.assets.some((asset) => asset.kind === 'native' || asset.kind === 'wrapped') && (
            <p className="subtle">
              ETH and WETH are separated using Mobula’s contract balances. Their USD values divide
              its combined estimate; the portfolio total is unchanged.
            </p>
          )}
          {wallet.assets.some((asset) => asset.kind === 'grouped') && (
            <p className="subtle">
              A grouped ETH balance may include wrapped assets. Its contract breakdown could not be
              reconciled, so it is not labeled native ETH.
            </p>
          )}
        </div>
      )}
      <div className="evidence-note">
        <Info size={15} />
        <p>
          {report.mode === 'demo'
            ? 'Illustrative data only. No real person, wallet, or live provider response is represented.'
            : 'This is a snapshot, not a complete audit. A record may be inherited from a resolver’s defaults. Historic links are not checked.'}
        </p>
      </div>
      {report.mode === 'live' && (
        <a
          className="text-link"
          href={`https://app.ens.domains/${encodeURIComponent(report.name)}`}
          target="_blank"
          rel="noreferrer"
        >
          Inspect name in ENS <ArrowUpRight size={14} />
        </a>
      )}
    </aside>
  );
}
