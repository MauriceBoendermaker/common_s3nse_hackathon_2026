import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, encodeErrorResult, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { resolveEns, DEFAULT_AWARE_RESOLVER, type EnsReader } from '../server/providers/ens.js';

const address = '0x2222222222222222222222222222222222222222';
const reader = (overrides: Partial<EnsReader> = {}): EnsReader => ({
  getBlockNumber: async () => 25870000n,
  getEnsResolver: async () => DEFAULT_AWARE_RESOLVER as `0x${string}`,
  getEnsAddress: async ({ coinType }) =>
    [60n, 2147492101n, 2147483648n].includes(coinType) ? address : null,
  getEnsText: async () => null,
  hasAddress: async (_resolver, _name, coinType) => coinType === 2147483648n || coinType === 60n,
  ...overrides,
});

test('Real viem ResolverError reverts stay unknown rather than ten successful empty records', async () => {
  const data = encodeErrorResult({
    abi: parseAbi(['error ResolverError(bytes errorData)']),
    errorName: 'ResolverError',
    args: ['0x12345678'],
  });
  const client = createPublicClient({
    chain: mainnet,
    ccipRead: false,
    transport: custom(
      {
        request: async () => {
          throw { code: 3, message: 'execution reverted', data };
        },
      },
      { retryCount: 0 },
    ),
  });
  // Default viem behavior really does swallow this error; this guards our strict adapter.
  assert.equal(
    await client.getEnsText({ name: 'example.eth', key: 'url', blockNumber: 25870000n }),
    null,
  );
  const result = await resolveEns(
    'example.eth',
    reader({
      getEnsAddress: (args) => client.getEnsAddress(args),
      getEnsText: (args) => client.getEnsText(args),
    }),
  );
  assert.equal(result.records.length, 0);
  assert.equal(result.coverage.succeeded, 0);
  assert.equal(result.coverage.failedKeys.length, 10);
  assert.ok(result.recordStates.every((state) => state.status === 'failed'));
});

test('hasAddr distinguishes identical explicit and fallback values at the same snapshot block', async () => {
  const result = await resolveEns(
    'example.eth',
    reader({
      hasAddress: async (_resolver, _name, coinType, block) => {
        assert.equal(block, 25870000n);
        return coinType === 60n || coinType === 2147483648n;
      },
    }),
  );
  const eth = result.recordStates.find((state) => state.chain === 'Ethereum')!;
  const base = result.recordStates.find((state) => state.chain === 'Base')!;
  assert.equal(eth.value, base.value);
  assert.equal(eth.origin, 'explicit');
  assert.equal(base.origin, 'default');
  assert.equal(base.storedValue, null);
  assert.equal(base.sourceRecordId, 'address:default');
  assert.equal(result.coverage.succeeded, 10);
});

test('Origin stays unknown when hasAddr fails, Default disagrees, or a custom resolver is used', async () => {
  for (const override of [
    {
      hasAddress: async () => {
        throw new Error('unavailable');
      },
    },
    {
      getEnsAddress: async ({ coinType }: { coinType: bigint }) =>
        coinType === 2147483648n ? null : address,
    },
    { getEnsResolver: async () => address },
  ] satisfies Partial<EnsReader>[]) {
    const result = await resolveEns('example.eth', reader(override));
    const base = result.recordStates.find((state) => state.chain === 'Base')!;
    assert.equal(base.origin, 'unknown');
    assert.equal(base.storedValue, undefined);
  }
});
