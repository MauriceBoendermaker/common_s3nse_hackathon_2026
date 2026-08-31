import type { AuditReport, PublicRecord, WalletExposure, DraftEdits } from '../shared/types.js';
import { buildFindings } from './analysis.js';
import { recordDefinitions, DEFAULT_RECORD } from '../shared/records.js';
import { simulateDraft } from '../shared/preview.js';

export function demoReport(scenario = 'classic'): AuditReport {
  const records: PublicRecord[] = [
    {
      id: 'address:ethereum',
      key: 'addr(60)',
      label: 'Ethereum address',
      kind: 'address',
      chain: 'Ethereum',
      value: '0x1111111111111111111111111111111111111111',
    },
    {
      id: 'address:base',
      key: 'addr(2147492101)',
      label: 'Base address',
      kind: 'address',
      chain: 'Base',
      value: '0x2222222222222222222222222222222222222222',
    },
    {
      id: 'text:com.twitter',
      key: 'com.twitter',
      label: 'X / Twitter',
      kind: 'social',
      value: 'mira_builds',
    },
    {
      id: 'text:com.github',
      key: 'com.github',
      label: 'GitHub',
      kind: 'social',
      value: 'mira-studio',
    },
    {
      id: 'text:url',
      key: 'url',
      label: 'Website',
      kind: 'website',
      value: 'https://mira.example',
    },
    {
      id: 'text:email',
      key: 'email',
      label: 'Email',
      kind: 'profile',
      value: 'hello@mira.example',
    },
  ];
  const wallets: WalletExposure[] = [
    {
      id: 'demo:ethereum',
      address: records[0].value,
      chain: 'Ethereum',
      recordIds: [records[0].id],
      status: 'ready',
      totalUsd: 18450,
      truncated: false,
      message: 'Synthetic holdings for the demo. No RPC or Mobula request was made.',
      assets: [
        { name: 'Ether', symbol: 'ETH', balance: 4.2, valueUsd: 12600 },
        { name: 'USD Coin', symbol: 'USDC', balance: 5850, valueUsd: 5850 },
      ],
    },
    {
      id: 'demo:base',
      address: records[1].value,
      chain: 'Base',
      recordIds: [records[1].id],
      status: 'ready',
      totalUsd: 6400,
      truncated: false,
      message: 'Synthetic holdings for the demo. No RPC or Mobula request was made.',
      assets: [
        { name: 'USD Coin', symbol: 'USDC', balance: 5500, valueUsd: 5500 },
        { name: 'Ether', symbol: 'ETH', balance: 0.3, valueUsd: 900 },
      ],
    },
  ];
  if (scenario === 'fallback')
    records.splice(2, 0, {
      ...recordDefinitions.find((record) => record.id === DEFAULT_RECORD)!,
      value: '0x2222222222222222222222222222222222222222',
      origin: 'explicit',
    });
  const observedAt = new Date().toISOString();
  for (const wallet of wallets) {
    wallet.assets.forEach((asset) => {
      asset.identities = [
        {
          chain: wallet.chain,
          address:
            asset.symbol === 'ETH'
              ? '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
              : '0x4444444444444444444444444444444444444444',
        },
      ];
    });
    wallet.activity = {
      status: 'ready',
      items: [
        {
          hash: `0x${wallet.chain === 'Ethereum' ? 'a' : 'b'}`.padEnd(
            66,
            wallet.chain === 'Ethereum' ? 'a' : 'b',
          ),
          chain: wallet.chain,
          timestamp: new Date(Date.now() - 86_400_000).toISOString(),
          blockNumber: null,
          actions: ['transfer'],
        },
      ],
      fetchedAt: observedAt,
      limit: 10,
      windowDays: 30,
      truncated: false,
      message: 'Synthetic activity for this scenario. No real transaction or provider request.',
    };
  }
  return {
    name: 'mira.demo.eth',
    mode: 'demo',
    observedAt,
    schemaVersion: 2,
    blockNumber: null,
    resolver: null,
    records,
    recordStates: recordDefinitions.map((definition) => {
      const record = records.find((item) => item.id === definition.id);
      return {
        ...definition,
        value: record?.value || null,
        storedValue: record?.value || null,
        status: record ? 'populated' : 'empty',
        origin: 'explicit',
        explanation: 'Synthetic explicit-record evidence. No onchain lookup.',
      };
    }),
    resolverSupport: {
      kind: 'demo',
      label: 'Synthetic Default-aware resolver',
      canSimulate: true,
      reason:
        'Fixture reproduces the supported public resolver semantics; it is not a deployed name.',
    },
    controlRecords: [
      {
        role: 'Owner',
        address: '0x5555555555555555555555555555555555555555',
        source: 'Synthetic name ownership',
      },
    ],
    controlStatus: 'ready',
    wallets,
    findings: buildFindings(records, wallets),
    coverage: { checked: 10, succeeded: 10, failedKeys: [] },
    warnings: [
      'This entire scenario is synthetic: the name, records, addresses, balances, and evidence are illustrative.',
      'Previewing fewer records changes only this screen. Past onchain disclosures and third-party copies would remain.',
      'Live mode uses real ENS data and, when configured, Mobula. Demo values are never used as live fallbacks.',
    ],
  };
}

export function demoPreview(edits: DraftEdits, scenario = 'fallback') {
  const basedOn = demoReport(scenario);
  const projected = simulateDraft(basedOn, edits);
  const newWallets: WalletExposure[] = projected.records
    .filter(
      (record) =>
        ['Ethereum', 'Base'].includes(record.chain || '') &&
        record.value.toLowerCase() === '0x3333333333333333333333333333333333333333',
    )
    .map((record) => ({
      id: `demo:new:${record.chain}`,
      address: record.value,
      chain: record.chain!,
      recordIds: [record.id],
      status: 'ready',
      assets: [
        {
          name: 'Demo USD Coin',
          symbol: 'USDC',
          balance: 1200,
          valueUsd: 1200,
          identities: [
            { chain: record.chain!, address: '0x4444444444444444444444444444444444444444' },
          ],
        },
      ],
      totalUsd: 1200,
      truncated: false,
      message: 'Synthetic preview-wallet fixture. No provider request.',
    }));
  return { basedOn, wallets: [...basedOn.wallets, ...newWallets] };
}

export function demoAfter(edits: DraftEdits, scenario = 'fallback'): AuditReport {
  const { basedOn, wallets } = demoPreview(edits, scenario);
  const projected = simulateDraft(basedOn, edits, wallets);
  return {
    ...basedOn,
    records: projected.records,
    recordStates: projected.states,
    wallets: projected.routes
      .filter((route) => route.status === 'new' || route.status === 'retained')
      .flatMap((route) => (route.wallet ? [{ ...route.wallet, recordIds: route.recordIds }] : [])),
    findings: buildFindings(projected.records),
    observedAt: new Date().toISOString(),
    warnings: [
      ...basedOn.warnings,
      'This after-state is a rehearsal fixture, not evidence of an onchain update.',
    ],
  };
}
