import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePortfolio } from '../server/providers/mobula.js';

const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const wrapped = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const payload = (parts: unknown, balance = 0.75, value: number | null = 1500) => ({
  data: {
    total_wallet_balance: value,
    assets: [
      {
        token_balance: balance,
        estimated_balance: value,
        asset: { name: 'Ethereum', symbol: 'ETH' },
        contracts_balances: parts,
      },
    ],
  },
});

test('Grouped ETH and WETH become separate positions without changing quantity or valuation', () => {
  const eth = 0.5650828464210469;
  const weth = 0.19972443702120532;
  const total = 1881.375858803338;
  const result = parsePortfolio(
    payload(
      [
        { address: native, chainId: 'evm:1', balance: eth },
        { address: wrapped, chainId: 'evm:1', balance: weth },
      ],
      eth + weth,
      total,
    ),
    'Ethereum',
  );
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets.find((asset) => asset.kind === 'native')?.balance, eth);
  assert.equal(result.assets.find((asset) => asset.kind === 'wrapped')?.balance, weth);
  assert.deepEqual(new Set(result.assets.map((asset) => asset.symbol)), new Set(['ETH', 'WETH']));
  assert.equal(
    result.assets.reduce((sum, asset) => sum + (asset.valueUsd ?? 0), 0),
    total,
  );
  assert.equal(result.totalUsd, total);
});

test('Wrapped-only balances are not presented as spendable native ETH; missing prices remain unknown', () => {
  const result = parsePortfolio(
    payload([{ address: wrapped, chainId: 'evm:1', balance: 0.75 }], 0.75, null),
  );
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].symbol, 'WETH');
  assert.equal(result.assets[0].valueUsd, null);
  assert.equal(result.totalUsd, null);
});

test('Contract identity and chain must match; symbol, missing data, and inconsistent sums cannot establish native ETH', () => {
  for (const parts of [
    undefined,
    [{ address: wrapped, chainId: 'evm:8453', balance: 0.75 }],
    [{ address: '0x1111111111111111111111111111111111111111', chainId: 'evm:1', balance: 0.75 }],
    [{ address: native, chainId: 'evm:1', balance: 0.5 }],
    [{ address: native, chainId: 'evm:1', balance: 'bad' }],
  ]) {
    const result = parsePortfolio(payload(parts));
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].symbol, 'ETH (grouped)');
    assert.equal(result.assets[0].kind, 'grouped');
    assert.equal(result.totalUsd, 1500);
  }
});

test('Base uses its own wrapped contract and quantities reconcile before a split', () => {
  const sample = payload([
    { address: native, chainId: 'evm:8453', balance: 0.25 },
    { address: '0x4200000000000000000000000000000000000006', chainId: 'evm:8453', balance: 0.5 },
  ]);
  const result = parsePortfolio(sample, 'Base');
  assert.equal(result.assets.find((asset) => asset.symbol === 'WETH')?.balance, 0.5);
  assert.equal(result.assets.find((asset) => asset.symbol === 'ETH')?.balance, 0.25);
  assert.equal(
    result.assets.reduce((sum, asset) => sum + (asset.valueUsd ?? 0), 0),
    1500,
  );
  assert.equal(parsePortfolio(sample, 'Ethereum').assets[0].kind, 'grouped');
});
