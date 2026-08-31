import assert from 'node:assert/strict';
import { buildApp } from '../dist/server/app.js';

// Exercise the compiled server without taking over the user's development port.
const app = await buildApp({
  serveStatic: true,
  policy: {
    restricted: true,
    allowedNames: [],
    previewAddresses: [],
    maxJobs: 1,
    maxConcurrency: 1,
  },
});
try {
  const html = await app.inject('/');
  assert.equal(html.statusCode, 200);
  assert.match(html.headers['content-type'], /text\/html/);
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/);
  const paths = [...html.body.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(paths.length >= 2);
  for (const path of paths) assert.equal((await app.inject(path)).statusCode, 200, path);
  assert.equal((await app.inject('/api/health')).json().access.mode, 'restricted');
  assert.equal((await app.inject('/api/does-not-exist')).statusCode, 404);
  const demo = (await app.inject('/api/demo?scenario=fallback')).json();
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.coverage.checked, 10);
  const edits = { 'address:base': null };
  const after = await app.inject({
    method: 'POST',
    url: '/api/demo/after',
    payload: { edits, scenario: 'fallback' },
  });
  assert.equal(after.statusCode, 200);
  assert.equal(
    after.json().recordStates.find((record) => record.id === 'address:base').origin,
    'default',
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/audit',
        payload: { name: 'stranger.eth', consent: true },
      })
    ).statusCode,
    403,
  );
  console.log(
    'Compiled app smoke checks passed: HTML, assets, headers, health, synthetic fallback, restricted live access, API 404. No provider requests.',
  );
} finally {
  await app.close();
}
