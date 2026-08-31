import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoAfter, demoReport } from '../server/demo.js';
import { simulateDraft, compareReports, sameRecordSnapshot } from '../shared/preview.js';
import { parseSnapshot } from '../shared/snapshot.js';
import { DEFAULT_RECORD } from '../shared/records.js';

const fresh = '0x3333333333333333333333333333333333333333';
const state = (report: ReturnType<typeof demoReport>, id: string) =>
  report.recordStates!.find((record) => record.id === id)!;

test('Removing an explicit Base override exposes its Default fallback without mutating evidence', () => {
  const report = demoReport('fallback');
  const before = JSON.stringify(report);
  const preview = simulateDraft(report, { 'address:base': null });
  const base = preview.routes.find((route) => route.chain === 'Base')!;
  assert.equal(base.status, 'retained');
  assert.ok(base.reasons.some((reason) => reason.includes('Default')));
  assert.equal(preview.states.find((record) => record.id === 'address:base')!.origin, 'default');
  assert.equal(JSON.stringify(report), before);
});

test('Removing Base and Default removes only the checked current route, retaining past evidence', () => {
  const report = demoReport('fallback');
  const preview = simulateDraft(report, { 'address:base': null, [DEFAULT_RECORD]: null });
  assert.equal(preview.routes.find((route) => route.chain === 'Base')?.status, 'removed');
  assert.equal(report.wallets.length, 2);
  assert.match(
    preview.routes.find((route) => route.chain === 'Base')!.reasons.join(' '),
    /Earlier disclosures/,
  );
});

test('Changing Default changes inherited routes but preserves explicit overrides and zero-address blocks', () => {
  const report = demoReport('fallback');
  state(report, 'address:base').storedValue = null;
  state(report, 'address:base').origin = 'default';
  const result = simulateDraft(report, { [DEFAULT_RECORD]: fresh });
  assert.equal(result.states.find((item) => item.id === 'address:base')?.value, fresh);
  assert.equal(
    result.states.find((item) => item.id === 'address:ethereum')?.value,
    report.records[0].value,
  );
  state(report, 'address:base').storedValue = `0x${'0'.repeat(40)}`;
  const blocked = simulateDraft(report, { [DEFAULT_RECORD]: fresh });
  assert.equal(blocked.states.find((item) => item.id === 'address:base')?.value, null);
  assert.equal(blocked.states.find((item) => item.id === 'address:base')?.origin, 'explicit');
});

test('Owner and matching published address bytes explain surviving paths without claiming ownership', () => {
  const report = demoReport('classic');
  const base = report.records.find((record) => record.id === 'address:base')!;
  report.controlRecords = [
    { role: 'Owner', address: base.value, source: 'test owner observation' },
  ];
  let route = simulateDraft(report, { 'address:base': null }).routes.find(
    (route) => route.chain === 'Base',
  )!;
  assert.equal(route.status, 'retained');
  assert.match(route.reasons.join(' '), /owner/);
  report.controlRecords = [];
  route = simulateDraft(report, {
    'address:base': null,
    'address:ethereum': base.value,
  }).routes.find((route) => route.chain === 'Base')!;
  assert.equal(route.status, 'retained');
  assert.match(route.reasons.join(' '), /do not prove common ownership/);
});

test('Unknown resolvers, failed reads and incomplete control coverage never certify route removal', () => {
  for (const reason of ['resolver', 'read', 'control'] as const) {
    const report = demoReport();
    if (reason === 'resolver') report.resolverSupport!.canSimulate = false;
    if (reason === 'read') state(report, 'address:solana').status = 'failed';
    if (reason === 'control') report.controlStatus = 'partial';
    const result = simulateDraft(report, { 'address:base': null });
    assert.equal(result.routes.find((route) => route.chain === 'Base')?.status, 'unknown', reason);
  }
});

test('A new wallet stays unknown until actual or explicitly synthetic enrichment is supplied', () => {
  const report = demoReport();
  const result = simulateDraft(report, { 'address:base': fresh });
  const route = result.routes.find((route) => route.address === fresh)!;
  assert.equal(route.status, 'new');
  assert.equal(route.wallet, undefined);
  const invalid = simulateDraft(report, { 'address:base': 'not-an-address' });
  assert.equal(invalid.errors.length, 1);
  assert.ok(!invalid.routes.some((route) => route.address === 'not-an-address'));
});

test('Verification distinguishes an unchanged resolved value from removal of its stored override', () => {
  const before = demoReport('fallback');
  const edits = { 'address:base': null };
  const after = demoAfter(edits, 'fallback');
  after.observedAt = new Date(Date.parse(before.observedAt) + 1000).toISOString();
  const result = compareReports(before, after, edits);
  const row = result.rows.find((row) => row.id === 'address:base')!;
  assert.equal(row.before, row.after);
  assert.equal(row.change, 'changed');
  assert.equal(row.expected, 'matches');
  assert.equal(result.verified, true);
});

test('Live verification requires a newer block, known stored values and unchanged resolver semantics', () => {
  const before = demoReport('fallback');
  const after = demoAfter({ 'address:base': null }, 'fallback');
  before.mode = after.mode = 'live';
  before.blockNumber = after.blockNumber = '123';
  assert.equal(compareReports(before, after, { 'address:base': null }).verified, false);
  after.blockNumber = '124';
  assert.equal(compareReports(before, after, { 'address:base': null }).verified, true);
  after.resolver = fresh;
  assert.equal(compareReports(before, after, { 'address:base': null }).verified, false);
  after.resolver = before.resolver;
  state(after, 'address:base').storedValue = undefined;
  assert.equal(compareReports(before, after, { 'address:base': null }).verified, false);
  after.name = 'someoneelse.eth';
  assert.throws(() => compareReports(before, after), /same normalized name/);
});

test('Prices do not verify record changes and unknown provenance invalidates a draft enrichment baseline', () => {
  const before = demoReport('fallback');
  const after = structuredClone(before);
  after.wallets[0].totalUsd = 1;
  after.observedAt = new Date(Date.parse(before.observedAt) + 1000).toISOString();
  assert.ok(compareReports(before, after).rows.every((row) => row.change === 'unchanged'));
  assert.equal(sameRecordSnapshot(before, after), true);
  state(after, 'address:base').storedValue = undefined;
  assert.equal(sameRecordSnapshot(before, after), false);
  state(after, 'address:base').status = 'failed';
  assert.equal(sameRecordSnapshot(before, after), false);
});

test('Snapshot imports preserve validated synthetic evidence and reject inconsistent or executable inputs', () => {
  const report = demoReport('fallback');
  const encoded = JSON.stringify({
    format: 'footprint/2',
    report,
    edits: { 'address:base': null },
  });
  const imported = parseSnapshot(encoded);
  assert.equal(imported.report.name, report.name);
  assert.deepEqual(imported.report.wallets[0].activity, report.wallets[0].activity);
  assert.deepEqual(imported.edits, { 'address:base': null });
  const malicious = structuredClone(report);
  malicious.records[0].chain = 'Base';
  assert.throws(() => parseSnapshot(JSON.stringify(malicious)), /inconsistent/);
  const missing = structuredClone(report);
  missing.recordStates!.pop();
  assert.throws(() => parseSnapshot(JSON.stringify(missing)), /all checked/);
  assert.throws(() => parseSnapshot(' '.repeat(500_001)), /limit/);
  assert.throws(
    () =>
      parseSnapshot(
        JSON.stringify({
          format: 'footprint/2',
          report,
          edits: { 'text:url': 'javascript:alert(1)' },
        }),
      ),
    /invalid draft/,
  );
  assert.throws(
    () =>
      parseSnapshot(
        JSON.stringify({ format: 'footprint/2', report, edits: { 'address:solana': null } }),
      ),
    /invalid draft/,
  );
});
