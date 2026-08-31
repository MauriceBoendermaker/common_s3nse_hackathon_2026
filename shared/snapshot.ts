import { z } from 'zod';
import type { AuditReport, DraftEdits } from './types.js';
import { recordDefinitions, validateEdit } from './records.js';

const text = z.string().max(2048);
const address = z.string().regex(/^0x[\da-f]{40}$/i);
const chain = z.enum(['Ethereum', 'Base', 'Solana']);
const record = z.object({
  id: text,
  key: text,
  label: text,
  kind: z.enum(['address', 'social', 'website', 'profile']),
  value: text,
  chain: chain.optional(),
  origin: z.enum(['explicit', 'default', 'unknown']).optional(),
  sourceRecordId: text.optional(),
});
const number = z.number().finite().nonnegative();
const iso = z.string().datetime({ offset: true });
const activity = z.object({
  status: z.enum(['ready', 'unconfigured', 'error']),
  items: z
    .array(
      z.object({
        hash: z.string().regex(/^0x[\da-f]{64}$/i),
        chain: z.enum(['Ethereum', 'Base']),
        timestamp: iso,
        blockNumber: number.int().nullable(),
        actions: z.array(text).max(20),
      }),
    )
    .max(10),
  fetchedAt: iso,
  windowDays: number.max(365),
  limit: number.max(100),
  truncated: z.boolean(),
  message: text,
});
const schema = z.object({
  schemaVersion: z.literal(2).optional(),
  name: z.string().min(3).max(255),
  mode: z.enum(['live', 'demo']),
  observedAt: iso,
  blockNumber: z
    .string()
    .regex(/^\d{1,30}$/)
    .nullable(),
  resolver: address.nullable(),
  records: z.array(record).max(10),
  recordStates: z
    .array(
      record.omit({ value: true }).extend({
        value: text.nullable(),
        storedValue: text.nullable().optional(),
        status: z.enum(['populated', 'empty', 'failed', 'unsupported']),
        explanation: text,
      }),
    )
    .max(10)
    .optional(),
  resolverSupport: z
    .object({
      kind: z.enum(['ens-default', 'unknown', 'demo']),
      label: text,
      canSimulate: z.boolean(),
      reason: text,
    })
    .optional(),
  controlRecords: z
    .array(z.object({ role: z.enum(['Owner', 'Manager']), address, source: text }))
    .max(2)
    .optional(),
  controlStatus: z.enum(['ready', 'partial', 'unsupported']).optional(),
  wallets: z
    .array(
      z.object({
        id: text,
        address,
        chain,
        recordIds: z.array(text).max(10),
        status: z.enum(['ready', 'unconfigured', 'error']),
        totalUsd: number.nullable(),
        message: text,
        truncated: z.boolean(),
        activity: activity.optional(),
        providerCheck: z
          .object({
            ok: z.boolean(),
            code: z.enum([
              'OK',
              'NOT_CONFIGURED',
              'UNAUTHORIZED',
              'FORBIDDEN',
              'PAYMENT_REQUIRED',
              'RATE_LIMITED',
              'ENDPOINT_NOT_FOUND',
              'REQUEST_REJECTED',
              'UPSTREAM_ERROR',
              'INVALID_RESPONSE',
              'TIMEOUT',
              'NETWORK_ERROR',
            ]),
            httpStatus: z.number().int().min(100).max(599).nullable(),
            checkedAt: iso,
            message: text,
            detail: text.optional(),
          })
          .optional(),
        assets: z
          .array(
            z.object({
              name: text,
              symbol: text,
              balance: number,
              valueUsd: number.nullable(),
              kind: z.enum(['native', 'wrapped', 'grouped']).optional(),
              contractAddress: address.optional(),
              identities: z.array(z.object({ chain, address })).max(100).optional(),
            }),
          )
          .max(8),
      }),
    )
    .max(20),
  findings: z
    .array(
      z.object({
        id: text,
        title: text,
        detail: text,
        action: text,
        tone: z.enum(['attention', 'info']),
        recordIds: z.array(text).max(10),
      }),
    )
    .max(20),
  coverage: z.object({
    checked: z.number().int().min(0).max(100),
    succeeded: z.number().int().min(0).max(100),
    failedKeys: z.array(text).max(100),
  }),
  warnings: z.array(text).max(30),
});

export function parseSnapshot(raw: string): { report: AuditReport; edits: DraftEdits } {
  if (raw.length > 500_000) throw new Error('Snapshot exceeds the 500 KB import limit.');
  const data: unknown = JSON.parse(raw);
  const envelope = z
    .object({
      format: z.literal('footprint/2'),
      report: z.unknown(),
      edits: z.record(z.string(), text.nullable()).default({}),
    })
    .safeParse(data);
  const report = schema.parse(envelope.success ? envelope.data.report : data);
  for (const items of [report.records, report.recordStates || []]) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error('Snapshot contains duplicate record IDs.');
    for (const item of items) {
      const definition = recordDefinitions.find((entry) => entry.id === item.id);
      if (
        !definition ||
        definition.key !== item.key ||
        definition.chain !== item.chain ||
        definition.kind !== item.kind
      )
        throw new Error('Snapshot contains inconsistent record definitions.');
    }
  }
  const edits = envelope.success ? envelope.data.edits : {};
  if (
    Object.keys(edits).length > 10 ||
    Object.entries(edits).some(([id, value]) => validateEdit(id, value))
  )
    throw new Error('Snapshot contains an invalid draft.');
  if (report.coverage.succeeded > report.coverage.checked)
    throw new Error('Snapshot coverage is inconsistent.');
  if (report.recordStates && report.recordStates.length !== recordDefinitions.length)
    throw new Error('Snapshot must contain all checked record states.');
  return { report, edits };
}
