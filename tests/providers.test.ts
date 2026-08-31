import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zeroAddress } from 'viem';
import { resolveEns, type EnsReader } from '../server/providers/ens.js';
import { createMobulaProvider, enrichWallets } from '../server/providers/mobula.js';
import { demoReport } from '../server/demo.js';

function reader(overrides: Partial<EnsReader> = {}): EnsReader {
  return {
    getBlockNumber: async () => 123n,
    getEnsResolver: async () => '0x1111111111111111111111111111111111111111',
    getEnsAddress: async () => null,
    getEnsText: async () => null,
    ...overrides,
  };
}

test('ENS records share a block and distinguish failed reads from absent records', async () => {
  const blocks: bigint[] = [];
  const result = await resolveEns(
    'example.eth',
    reader({
      getEnsAddress: async ({ coinType, blockNumber }) => {
        blocks.push(blockNumber);
        return coinType === 60n ? '0x1111111111111111111111111111111111111111' : zeroAddress;
      },
      getEnsText: async ({ key, blockNumber }) => {
        blocks.push(blockNumber);
        if (key === 'email') throw new Error('Read failed');
        return key === 'com.github' ? 'example' : null;
      },
    }),
  );
  assert.equal(blocks.length, 10);
  assert.ok(blocks.every((block) => block === 123n));
  assert.deepEqual(result.coverage, { checked: 10, succeeded: 9, failedKeys: ['email'] });
  assert.deepEqual(
    result.records.map((record) => record.key),
    ['addr(60)', 'com.github'],
  );
  assert.equal(result.blockNumber, '123');
});

test('Provider diagnostics distinguish authentication, access, credits, throttling, and outages without echoing bodies', async () => {
  for (const [status, code] of [
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [402, 'PAYMENT_REQUIRED'],
    [429, 'RATE_LIMITED'],
    [404, 'ENDPOINT_NOT_FOUND'],
    [503, 'UPSTREAM_ERROR'],
  ] as const) {
    const provider = createMobulaProvider({
      apiKey: 'test-only-secret',
      apiUrl: 'https://mobula.example/api/1',
      fetch: async () => new Response('test-only-secret echoed by upstream', { status }),
    });
    const result = await provider.verifyKey();
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.httpStatus, status);
    assert.equal(provider.health().lastCheck?.code, code);
    assert.ok(!JSON.stringify(provider.health()).includes('test-only-secret'));
  }
});

test('Verification checks portfolio access with a fixed address, without a supplied identity or a key in the URL', async () => {
  const provider = createMobulaProvider({
    apiKey: 'test-only-secret',
    apiUrl: 'https://mobula.example/api/1',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('wallet'), '0xaF88370abD82EC6943cdB3D4ec7b764B92c35B43');
      assert.equal(url.searchParams.get('blockchains'), 'ethereum');
      assert.ok(!url.toString().includes('test-only-secret'));
      assert.equal(new Headers(init?.headers).get('Authorization'), 'test-only-secret');
      return Response.json({ data: { assets: [], total_wallet_balance: 0 } });
    },
  });
  assert.equal(provider.health().lastCheck, null);
  assert.equal((await provider.verifyKey()).code, 'OK');
  assert.equal(provider.health().lastCheck?.ok, true);
});

test('HTTP 400 retains a useful provider explanation while redacting credentials, URLs, and addresses', async () => {
  const provider = createMobulaProvider({
    apiKey: 'test-only-secret',
    apiUrl: 'https://mobula.example/api/1',
    fetch: async () =>
      Response.json(
        {
          error: {
            message:
              'Invalid API key: test-only-secret; https://example.test?key=test-only-secret; wallet 0x1111111111111111111111111111111111111111',
          },
        },
        { status: 400 },
      ),
  });
  const result = await provider.verifyKey();
  assert.equal(result.code, 'REQUEST_REJECTED');
  assert.match(result.detail ?? '', /Invalid API key/);
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.ok(!JSON.stringify(result).includes('example.test'));
  assert.ok(!JSON.stringify(result).includes('0x111111'));
});

test('Timeouts, network failures, and unreadable responses are not mislabeled as invalid keys', async () => {
  for (const [fetch, expected] of [
    [
      async () => {
        throw new DOMException('test-only-secret', 'TimeoutError');
      },
      'TIMEOUT',
    ],
    [
      async () => {
        throw new TypeError('test-only-secret');
      },
      'NETWORK_ERROR',
    ],
    [async () => Response.json({ data: { assets: null } }), 'INVALID_RESPONSE'],
    [async () => new Response('test-only-secret', { status: 200 }), 'INVALID_RESPONSE'],
  ] as const) {
    const provider = createMobulaProvider({
      apiKey: 'test-only-secret',
      apiUrl: 'https://mobula.example/api/1',
      fetch,
    });
    const result = await provider.verifyKey();
    assert.equal(result.code, expected);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  }
});

test('Missing configuration does not make a verification request, and partial results retain their diagnostic', async () => {
  const empty = createMobulaProvider({
    apiKey: '',
    fetch: async () => assert.fail('Must not fetch without a key'),
  });
  assert.equal((await empty.verifyKey()).code, 'NOT_CONFIGURED');
  const provider = createMobulaProvider({
    apiKey: 'test-only-secret',
    apiUrl: 'https://mobula.example/api/1',
    fetch: async (input) =>
      new URL(String(input)).searchParams.get('blockchains') === 'ethereum'
        ? new Response('', { status: 401 })
        : Response.json({ data: { assets: [], total_wallet_balance: 0 } }),
  });
  const wallets = await provider.enrich(demoReport().records);
  assert.equal(wallets[0].providerCheck?.code, 'UNAUTHORIZED');
  assert.equal(wallets[0].totalUsd, null);
  assert.equal(wallets[1].providerCheck?.code, 'OK');
  assert.equal(provider.health().lastCheck?.code, 'UNAUTHORIZED');
});

test('A missing resolver stops record reads and provider failures do not leak upstream URLs', async () => {
  await assert.rejects(
    resolveEns(
      'example.eth',
      reader({
        getEnsResolver: async () => zeroAddress,
        getEnsText: async () => assert.fail('Must not query records without a resolver'),
      }),
    ),
    { code: 'NAME_NOT_FOUND', statusCode: 404 },
  );
  await assert.rejects(
    resolveEns(
      'example.eth',
      reader({
        getBlockNumber: async () => {
          throw new Error('https://rpc.example/private-api-token');
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('private-api-token'));
      return 'code' in error && error.code === 'ENS_UNAVAILABLE';
    },
  );
});

test('Missing Mobula configuration causes no request and leaves balances unknown', async () => {
  const result = await enrichWallets(demoReport().records, {
    apiKey: '',
    fetch: async () => assert.fail('Missing credentials must not make a request'),
  });
  assert.equal(result.length, 2);
  assert.ok(result.every((wallet) => wallet.status === 'unconfigured' && wallet.totalUsd === null));
});

test('Mobula requests use the declared chain, server-side authorization, and reject redirects', async () => {
  const calls: URL[] = [];
  const result = await enrichWallets(demoReport().records, {
    apiKey: 'test-only-not-a-real-key',
    apiUrl: 'https://mobula.example/api/1',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'test-only-not-a-real-key');
      assert.equal(url.pathname, '/api/1/wallet/portfolio');
      assert.equal(url.searchParams.get('filterSpam'), 'true');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return Response.json({ data: { total_wallet_balance: 0, assets: [] } });
    },
  });
  assert.deepEqual(
    calls.map((url) => url.searchParams.get('blockchains')),
    ['ethereum', 'base'],
  );
  assert.ok(result.every((wallet) => wallet.status === 'ready' && wallet.totalUsd === 0));
  assert.ok(!JSON.stringify(result).includes('test-only-not-a-real-key'));
});

test('A rejected or malformed portfolio leaves that wallet unknown while preserving other results', async () => {
  for (const failedResponse of [
    new Response('Unauthorized', { status: 401 }),
    Response.json({ data: { assets: null } }),
  ]) {
    const result = await enrichWallets(demoReport().records, {
      apiKey: 'test-only-not-a-real-key',
      apiUrl: 'https://mobula.example/api/1',
      fetch: async (input) =>
        new URL(String(input)).searchParams.get('blockchains') === 'ethereum'
          ? failedResponse
          : Response.json({ data: { total_wallet_balance: 20, assets: [] } }),
    });
    assert.equal(result[0].status, 'error');
    assert.equal(result[0].totalUsd, null);
    assert.equal(result[1].status, 'ready');
    assert.equal(result[1].totalUsd, 20);
  }
});
