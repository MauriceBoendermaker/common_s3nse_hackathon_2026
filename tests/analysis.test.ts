import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from '../server/providers/ens.js';
import { parsePortfolio, groupWalletRecords } from '../server/providers/mobula.js';
import { buildFindings } from '../server/analysis.js';
import { demoReport } from '../server/demo.js';
import { knownValue, visibleWallets } from '../shared/types.js';

test('ENS normalization rejects URLs, invalid names, whitespace, and normalizes case', () => {
  assert.equal(normalizeName('Alice.eth'), 'alice.eth');
  for (const value of [
    'https://alice.eth',
    'alice',
    ' alice.eth',
    'ali ce.eth',
    'alice.eth/path',
    'alice..eth',
  ]) {
    assert.throws(() => normalizeName(value));
  }
});

test('Mobula normalization preserves unknown valuations and accepts the documented nested schema', () => {
  const portfolio = parsePortfolio({
    data: {
      assets: [
        {
          token_balance: '20',
          estimated_balance: null,
          price: null,
          asset: { name: 'Unknown asset', symbol: 'UNK' },
        },
        { token_balance: '3', price: '2', asset: { name: 'Example', symbol: 'EX' } },
      ],
    },
  });
  assert.equal(portfolio.totalUsd, null);
  assert.equal(portfolio.assets[0].valueUsd, 6);
  assert.equal(portfolio.assets[1].valueUsd, null);
  assert.equal(portfolio.assets[1].balance, 20);
});

test('Malformed portfolios cannot masquerade as a successful zero-balance lookup', () => {
  for (const payload of [
    {},
    { data: {} },
    { data: { assets: null } },
    { data: { assets: [{ token_balance: ' ', asset: { name: 'x', symbol: 'X' } }] } },
  ]) {
    assert.throws(() => parsePortfolio(payload));
  }
  assert.equal(parsePortfolio({ data: { total_wallet_balance: 0, assets: [] } }).totalUsd, 0);
});

test('Oversized token labels cannot discard a valid wallet portfolio', () => {
  const result = parsePortfolio({
    data: {
      total_wallet_balance: 106,
      assets: [
        { token_balance: 2, price: 3, asset: { name: 'Native token', symbol: 'ETH' } },
        {
          token_balance: 10,
          estimated_balance: 100,
          asset: { name: 'n'.repeat(400), symbol: 's'.repeat(120) },
        },
      ],
    },
  });
  assert.equal(result.totalUsd, 106);
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].symbol.length, 40);
  assert.ok(result.assets[0].symbol.endsWith('…'));
  assert.equal(result.assets[0].name.length, 200);
  assert.equal(result.assets[0].balance, 10);
  assert.equal(result.assets[0].valueUsd, 100);
  assert.equal(result.assets[1].valueUsd, 6);
  assert.throws(() =>
    parsePortfolio({
      data: {
        assets: [
          {
            token_balance: 'not-a-number',
            asset: { name: 'n'.repeat(400), symbol: 's'.repeat(120) },
          },
        ],
      },
    }),
  );
});

test('A provider total is not recalculated from a truncated asset list', () => {
  const payload = {
    data: {
      total_wallet_balance: 100,
      assets: Array.from({ length: 10 }, (_, index) => ({
        token_balance: 1,
        estimated_balance: 10,
        asset: { name: `Token ${index}`, symbol: `T${index}` },
      })),
    },
  };
  const result = parsePortfolio(payload);
  assert.equal(result.assets.length, 8);
  assert.equal(result.totalUsd, 100);
  assert.equal(result.truncated, true);
});

test('Wallet paths deduplicate an address only within a chain, and do not interpret social text as addresses', () => {
  const sample = demoReport();
  const record = sample.records[0];
  const wallets = groupWalletRecords([
    record,
    { ...record, id: 'alias' },
    { ...record, id: 'base', chain: 'Base' },
    { ...record, id: 'social', kind: 'social' },
  ]);
  assert.equal(wallets.length, 2);
  assert.deepEqual(wallets[0].recordIds, [record.id, 'alias']);
  assert.equal(wallets[1].chain, 'Base');
});

test('A preview hides only direct paths and cannot mutate the original evidence or imply zero wealth', () => {
  const report = demoReport();
  const original = JSON.stringify(report);
  const hidden = new Set(['address:ethereum']);
  assert.equal(visibleWallets(report, hidden).length, 1);
  assert.equal(knownValue(visibleWallets(report, hidden)), 6400);
  assert.equal(
    knownValue(visibleWallets(report, new Set(['address:ethereum', 'address:base']))),
    null,
  );
  assert.equal(JSON.stringify(report), original);
  assert.ok(
    report.wallets.every((wallet) =>
      wallet.recordIds.every((id) => report.records.some((record) => record.id === id)),
    ),
  );
});

test('Observations do not invent social-to-wallet connections without published evidence', () => {
  const report = demoReport();
  const findings = buildFindings(report.records.filter((record) => record.kind !== 'address'));
  assert.ok(!findings.some((finding) => finding.id === 'identity-bridge'));
  assert.ok(!findings.some((finding) => finding.id === 'financial-visibility'));
});
