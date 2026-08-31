import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { demoReport } from '../server/demo.js';
import { AuditError } from '../server/errors.js';
import { createMobulaProvider } from '../server/providers/mobula.js';

test('API requires explicit acknowledgment and never calls the provider for rejected input', async () => {
  let calls = 0;
  const app = await buildApp({
    audit: async () => {
      calls++;
      return demoReport();
    },
  });
  try {
    for (const payload of [
      { name: 'alice.eth' },
      { name: 'alice.eth', consent: false },
      { name: 'x', consent: true },
      { name: 'alice.eth', consent: true, rpc: 'https://untrusted.example' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/audit', payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'INVALID_REQUEST');
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test('Explicit demo endpoint has synthetic provenance, no chain block, and no-store responses', async () => {
  const app = await buildApp({
    audit: async () => {
      throw new Error('Demo must not call live audit');
    },
  });
  try {
    const response = await app.inject('/api/demo');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().mode, 'demo');
    assert.equal(response.json().blockNumber, null);
    assert.match(response.json().warnings[0], /synthetic/);
  } finally {
    await app.close();
  }
});

test('Provider outages remain errors; the API does not silently return a demo or leak upstream credentials', async () => {
  const app = await buildApp({
    audit: async () => {
      throw new AuditError('ENS_UNAVAILABLE', 'Upstream unavailable.', 502);
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit',
      payload: { name: 'alice.eth', consent: true },
    });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), {
      error: { code: 'ENS_UNAVAILABLE', message: 'Upstream unavailable.' },
    });
    const health = (await app.inject('/api/health')).json();
    assert.equal(health.status, 'ok');
    assert.ok(!JSON.stringify(health).includes('https://'));
    assert.deepEqual(Object.keys(health.mobula).sort(), ['configured', 'label', 'lastCheck']);
  } finally {
    await app.close();
  }
});

test('Key verification requires explicit consent; health checks never contact Mobula', async () => {
  let requests = 0;
  const mobula = createMobulaProvider({
    apiKey: 'test-only-secret',
    apiUrl: 'https://mobula.example/api/1',
    fetch: async () => {
      requests++;
      return Response.json({ data: { assets: [], total_wallet_balance: 0 } });
    },
  });
  const app = await buildApp({ mobula });
  try {
    assert.equal((await app.inject('/api/health')).json().mobula.lastCheck, null);
    for (const payload of [{}, { consent: false }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/providers/mobula/verify',
        payload,
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(requests, 0);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/providers/mobula/verify',
      payload: { consent: true },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().mobula.lastCheck.ok, true);
    assert.equal(verified.json().mobula.lastCheck.httpStatus, 200);
    assert.equal(requests, 1);
    const health = await app.inject('/api/health');
    assert.equal(health.json().mobula.lastCheck.code, 'OK');
    assert.ok(!health.body.includes('test-only-secret'));
    assert.equal(requests, 1);
  } finally {
    await app.close();
  }
});

test('Unexpected failures are sanitized and request bodies are bounded', async () => {
  const app = await buildApp({
    audit: async () => {
      throw new Error('secret-token-do-not-leak');
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit',
      payload: { name: 'alice.eth', consent: true },
    });
    assert.equal(response.statusCode, 500);
    assert.ok(!response.body.includes('secret-token'));
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/audit',
      payload: { name: 'a'.repeat(5000), consent: true },
    });
    assert.equal(oversized.statusCode, 413);
  } finally {
    await app.close();
  }
});
