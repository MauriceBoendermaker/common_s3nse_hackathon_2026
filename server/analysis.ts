import type { AuditReport, Finding, PublicRecord, WalletExposure } from '../shared/types.js';
import { resolveEns, normalizeName } from './providers/ens.js';
import { enrichWallets } from './providers/mobula.js';

export function buildFindings(records: PublicRecord[], wallets: WalletExposure[] = []): Finding[] {
  const addresses = records.filter((record) => record.kind === 'address');
  const socials = records.filter((record) => record.kind === 'social');
  const findings: Finding[] = [];
  const fallback = records.filter((record) => record.origin === 'default');
  if (fallback.length)
    findings.push({
      id: 'default-route',
      title: `${fallback.length} chain lookup${fallback.length > 1 ? 's use' : ' uses'} your Default address`,
      detail:
        'These results are inherited from the Default EVM record. Removing a chain override can leave a working route to the same address.',
      action: 'Preview the Default and chain-specific records together before changing either.',
      tone: 'attention',
      recordIds: fallback.map((record) => record.id),
    });
  const known = wallets.filter((wallet) => wallet.totalUsd !== null);
  if (known.length)
    findings.push({
      id: 'observed-holdings',
      title: `${known.length} published wallet path${known.length > 1 ? 's have' : ' has'} financial evidence`,
      detail: `${known.reduce((sum, wallet) => sum + wallet.assets.length, 0)} asset positions are displayed across those paths. Totals include provider estimates, and missing portfolios are not counted as zero.`,
      action:
        'Inspect the holdings evidence, then preview replacing or removing its published route.',
      tone: 'attention',
      recordIds: known.flatMap((wallet) => wallet.recordIds),
    });
  if (addresses.length && socials.length)
    findings.push({
      id: 'identity-bridge',
      title: 'Your social profile and wallet are one lookup apart',
      tone: 'attention',
      detail:
        'This name publishes both social handles and blockchain addresses. Anyone can follow those declared connections; they do not prove account ownership.',
      action:
        'Decide whether this public identity should also be a route to your financial activity.',
      recordIds: [...addresses, ...socials].map((record) => record.id),
    });
  if (addresses.length > 1)
    findings.push({
      id: 'multichain',
      title: 'One name connects records on multiple chains',
      tone: 'attention',
      detail: `${addresses.length} address records can be discovered through the same name. Different chain records do not necessarily mean different wallets or owners.`,
      action: 'Publish only addresses you intend to associate with this public identity.',
      recordIds: addresses.map((record) => record.id),
    });
  const email = records.find((record) => record.key === 'email');
  if (email)
    findings.push({
      id: 'email',
      title: 'Your contact address is publicly readable',
      tone: 'attention',
      detail:
        'An email text record is public data, including to automated collectors. Footprint does not verify or contact this address.',
      action: 'Consider a dedicated public contact address instead of a private inbox.',
      recordIds: [email.id],
    });
  if (addresses.length)
    findings.push({
      id: 'financial-visibility',
      title: 'Published addresses lead to public financial data',
      tone: 'info',
      detail:
        'Balances and onchain activity can be queried independently of Footprint. A missing portfolio here does not make an address private.',
      action:
        'Treat public wallet links as an intentional disclosure, even if this provider has no data.',
      recordIds: addresses.map((record) => record.id),
    });
  return findings;
}

export async function runAudit(input: string): Promise<AuditReport> {
  const name = normalizeName(input);
  const ens = await resolveEns(name);
  const wallets = await enrichWallets(ens.records);
  const warnings = [
    'This is a current snapshot, not a history scan. Removing a record cannot erase past disclosures.',
    'Published records are declarations, not proof of ownership of referenced wallets or social accounts.',
    'RPC providers and Mobula can observe queries. Reports are not persisted by this application.',
  ];
  if (ens.coverage.failedKeys.length)
    warnings.push(
      `Some ENS reads failed: ${ens.coverage.failedKeys.join(', ')}. Missing results are unknown, not absent.`,
    );
  if (wallets.some((wallet) => wallet.status !== 'ready'))
    warnings.push(
      'Wallet holdings are incomplete or unavailable. No balances have been substituted.',
    );
  if (ens.records.some((record) => record.chain === 'Solana'))
    warnings.push(
      'Solana address bytes are shown as published; portfolio enrichment currently supports Ethereum and Base only.',
    );
  return {
    name,
    schemaVersion: 2,
    mode: 'live',
    observedAt: new Date().toISOString(),
    ...ens,
    wallets,
    findings: buildFindings(ens.records, wallets),
    warnings,
  };
}
