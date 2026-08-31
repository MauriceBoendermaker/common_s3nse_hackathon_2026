import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createWorkBudget } from '../server/budget.js';
import { demoReport } from '../server/demo.js';
import { resolveEns } from '../server/providers/ens.js';
import { parsePortfolio } from '../server/providers/mobula.js';
import { fetchActivity, parseActivity } from '../server/providers/activity.js';
import { readBoundedJson } from '../server/providers/json.js';

const address = '0x3333333333333333333333333333333333333333';
const policy = {
  restricted: true,
  allowedNames: ['mira.demo.eth'],
  previewAddresses: [],
  maxJobs: 30,
  maxConcurrency: 2,
};

test('Hosted allowlist, consent and origin checks reject work before provider calls', async () => {
  let calls = 0;
  const app = await buildApp({
    policy,
    audit: async () => {
      calls++;
      return demoReport('fallback');
    },
  });
  try {
    for (const url of ['/api/audit', '/api/preview', '/api/activity']) {
      const payload =
        url === '/api/preview'
          ? { name: 'stranger.eth', consent: true, edits: {} }
          : url === '/api/activity'
            ? { name: 'stranger.eth', consent: true, address, chain: 'Base' }
            : { name: 'stranger.eth', consent: true };
      assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 403);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url,
            payload: { ...payload, name: 'mira.demo.eth', consent: false },
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/audit',
          headers: { origin: 'https://attacker.example' },
          payload: { name: 'mira.demo.eth', consent: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/providers/mobula/verify',
          payload: { consent: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(calls, 0);
    const health = (await app.inject('/api/health')).json();
    assert.equal(health.access.diagnosticsEnabled, false);
    assert.deepEqual(health.access.allowedNames, ['mira.demo.eth']);
  } finally {
    await app.close();
  }
});

test('Hosted preview cannot enrich arbitrary addresses, while allowlisted draft wallets can be compared', async () => {
  let enrichCalls = 0;
  for (const previewAddresses of [[], [address]]) {
    const app = await buildApp({
      policy: { ...policy, previewAddresses },
      audit: async () => demoReport('fallback'),
      enrich: async (records) => {
        enrichCalls++;
        assert.equal(records[0].value, address);
        return [];
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/preview',
        payload: { name: 'mira.demo.eth', consent: true, edits: { 'address:base': address } },
      });
      assert.equal(response.statusCode, previewAddresses.length ? 200 : 403);
      if (previewAddresses.length)
        assert.equal(
          response
            .json()
            .basedOn.records.find((record: { id: string }) => record.id === 'address:base').value,
          '0x2222222222222222222222222222222222222222',
        );
    } finally {
      await app.close();
    }
  }
  assert.equal(enrichCalls, 1);
});

test('Activity authorization matches both the chain and the profile record', async () => {
  let calls = 0;
  const ens = await resolveEns('mira.demo.eth', {
    getBlockNumber: async () => 1n,
    getEnsResolver: async () => address,
    getEnsAddress: async ({ coinType }) => (coinType === 60n ? address : null),
    getEnsText: async () => null,
  });
  const app = await buildApp({
    policy,
    resolve: async () => ens,
    activity: async () => {
      calls++;
      return parseActivity({ data: [] }, 'Ethereum');
    },
  });
  try {
    for (const chain of ['Base', 'Ethereum']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/activity',
        payload: { name: 'mira.demo.eth', consent: true, address, chain },
      });
      assert.equal(response.statusCode, chain === 'Base' ? 403 : 200);
    }
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test('Synthetic rehearsals and health checks remain available after the provider budget is exhausted', async () => {
  let calls = 0;
  const app = await buildApp({
    policy: { ...policy, maxJobs: 1 },
    audit: async () => {
      calls++;
      return demoReport('fallback');
    },
  });
  try {
    const request = {
      method: 'POST' as const,
      url: '/api/audit',
      payload: { name: 'mira.demo.eth', consent: true },
    };
    assert.equal((await app.inject(request)).statusCode, 200);
    assert.equal((await app.inject(request)).statusCode, 429);
    for (let i = 0; i < 35; i++) assert.equal((await app.inject('/api/health')).statusCode, 200);
    const demo = await app.inject({
      method: 'POST',
      url: '/api/demo/after',
      payload: { edits: { 'address:base': null }, scenario: 'fallback' },
    });
    assert.equal(demo.statusCode, 200);
    assert.equal(demo.json().mode, 'demo');
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test('Process budget bounds concurrency, charges failures and resets its hourly window', async () => {
  let clock = 0;
  const budget = createWorkBudget(2, 1, () => clock);
  let release!: () => void;
  const first = budget.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    budget.run(async () => 'too soon'),
    { statusCode: 429 },
  );
  release();
  await first;
  await assert.rejects(
    budget.run(async () => {
      throw new Error('upstream failed');
    }),
    /upstream failed/,
  );
  await assert.rejects(
    budget.run(async () => 'over quota'),
    { statusCode: 429 },
  );
  clock = 3_600_000;
  assert.equal(await budget.run(async () => 'new window'), 'new window');
});

test('Activity requests are bounded, authenticated and use Mobula v2 without leaking secrets', async () => {
  const now = Date.UTC(2026, 7, 31);
  const result = await fetchActivity(address, 'Base', {
    apiKey: 'fake-secret',
    apiUrl: 'https://mobula.example/api/1',
    now,
    enabled: true,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/2/wallet/activity');
      assert.equal(url.searchParams.get('chainIds'), 'evm:8453');
      assert.equal(url.searchParams.get('limit'), '10');
      assert.equal(
        Number(url.searchParams.get('to')) - Number(url.searchParams.get('from')),
        30 * 86_400_000,
      );
      assert.ok(!url.href.includes('fake-secret'));
      assert.equal(new Headers(init?.headers).get('Authorization'), 'fake-secret');
      assert.equal(init?.redirect, 'error');
      return Response.json({ data: [] });
    },
  });
  assert.equal(result.status, 'ready');
  assert.match(result.message, /does not prove no activity/);
  const failure = await fetchActivity(address, 'Base', {
    apiKey: 'fake-secret',
    enabled: true,
    fetch: async () => new Response('fake-secret', { status: 403 }),
  });
  assert.equal(failure.status, 'error');
  assert.ok(!JSON.stringify(failure).includes('fake-secret'));
  await fetchActivity(address, 'Base', {
    apiKey: '',
    fetch: async () => assert.fail('No key means no request'),
  });
});

test('Activity parsing drops wrong-chain, malformed and out-of-window entries and deduplicates hashes', () => {
  const now = Date.UTC(2026, 7, 31);
  const row = {
    chainId: 'evm:8453',
    txHash: `0x${'a'.repeat(64)}`,
    txDateMs: now - 1000,
    txBlockNumber: 500,
    actions: [{ model: 'transfer' }],
  };
  const result = parseActivity(
    {
      data: [
        row,
        row,
        { ...row, chainId: '1' },
        { ...row, txHash: '<script>' },
        { ...row, txDateMs: 0 },
        {
          ...row,
          txHash: `0x${'b'.repeat(64)}`,
          txDateMs: now - 500,
          actions: [{ model: 'untrusted-text' }],
        },
      ],
      backfillStatus: 'pending',
    },
    'Base',
    now,
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].hash, `0x${'b'.repeat(64)}`);
  assert.deepEqual(result.items[0].actions, ['other onchain action']);
  assert.equal(result.truncated, true);
  assert.ok(!JSON.stringify(result).includes('<script>'));
});

test('Token identities preserve contracts on the requested chain without trusting symbol text', () => {
  const result = parsePortfolio({
    data: {
      assets: [
        {
          token_balance: 2,
          price: 3,
          asset: { name: 'Fake Ether', symbol: 'ETH' },
          contracts_balances: [
            { chainId: 'evm:1', address, balance: 1 },
            { chainId: 1, address, balance: 1 },
            { chainId: '8453', address: '0x4444444444444444444444444444444444444444', balance: 2 },
            { chainId: '1', address: 'javascript:alert(1)', balance: 1 },
          ],
        },
      ],
    },
  });
  assert.deepEqual(result.assets[0].identities, [{ chain: 'Ethereum', address }]);
  assert.notEqual(result.assets[0].kind, 'native');
  const overflow = parsePortfolio({
    data: {
      assets: [{ token_balance: 1e300, price: 1e300, asset: { name: 'Overflow', symbol: 'O' } }],
    },
  });
  assert.equal(overflow.assets[0].valueUsd, null);
  assert.equal(overflow.totalUsd, null);
});

test('Provider JSON size limits apply to content length and streaming bodies without a length', async () => {
  await assert.rejects(
    readBoundedJson(new Response('[]', { headers: { 'content-length': '1000' } }), 10),
    /size/,
  );
  await assert.rejects(readBoundedJson(new Response('"' + 'a'.repeat(100) + '"'), 10), /size/);
  assert.deepEqual(await readBoundedJson(Response.json({ data: [] }), 100), { data: [] });
});
