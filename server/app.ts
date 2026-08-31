import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AuditReport, ProviderHealth, DraftEdits } from '../shared/types.js';
import { runAudit } from './analysis.js';
import { demoReport, demoPreview, demoAfter } from './demo.js';
import { config } from './config.js';
import { AuditError } from './errors.js';
import { mobulaProvider } from './providers/mobula.js';
import { enrichWallets } from './providers/mobula.js';
import { fetchActivity } from './providers/activity.js';
import { normalizeName, resolveEns } from './providers/ens.js';
import { createWorkBudget } from './budget.js';
import { simulateDraft } from '../shared/preview.js';
import { isEvmValue, sameValue, validateEdit } from '../shared/records.js';

const auditInput = z
  .object({ name: z.string().min(3).max(255), consent: z.literal(true) })
  .strict();

export async function buildApp(
  options: {
    audit?: (name: string) => Promise<AuditReport>;
    serveStatic?: boolean;
    mobula?: Pick<typeof mobulaProvider, 'health' | 'verifyKey'>;
    policy?: {
      restricted: boolean;
      allowedNames: string[];
      previewAddresses: string[];
      maxJobs: number;
      maxConcurrency: number;
    };
    enrich?: typeof enrichWallets;
    activity?: typeof fetchActivity;
    resolve?: typeof resolveEns;
  } = {},
) {
  const mobula = options.mobula ?? mobulaProvider;
  const policy = options.policy ?? config;
  const allowedNames = policy.allowedNames.map(normalizeName);
  const budget = createWorkBudget(policy.maxJobs, policy.maxConcurrency);
  const allowName = (input: string) => {
    const name = normalizeName(input);
    if (policy.restricted && !allowedNames.includes(name))
      throw new AuditError(
        'PROFILE_NOT_ALLOWED',
        'This hosted demo only inspects configured, consenting profiles. Use the synthetic demo or run Footprint locally.',
        403,
      );
    return name;
  };
  const readEdits = (input: unknown): DraftEdits => {
    const parsed = z.record(z.string(), z.string().max(2048).nullable()).safeParse(input);
    if (!parsed.success || Object.keys(parsed.data).length > 10)
      throw new AuditError('INVALID_DRAFT', 'A draft can edit at most ten supported records.');
    for (const [id, value] of Object.entries(parsed.data)) {
      const error = validateEdit(id, value);
      if (error) throw new AuditError('INVALID_DRAFT', error);
    }
    return parsed.data;
  };
  const app = Fastify({
    logger: false,
    bodyLimit: 4096,
    requestTimeout: 45_000,
    trustProxy: config.trustProxy.length ? config.trustProxy : false,
  });
  await app.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute and try again.' },
    }),
  });
  app.addHook('onRequest', async (request) => {
    if (request.method !== 'POST' || !request.headers.origin) return;
    let origin: URL;
    try {
      origin = new URL(request.headers.origin);
    } catch {
      throw new AuditError('ORIGIN_REJECTED', 'Invalid request origin.', 403);
    }
    const allowed = policy.restricted
      ? config.appOrigin && origin.origin === config.appOrigin
      : ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (!allowed)
      throw new AuditError(
        'ORIGIN_REJECTED',
        'This origin is not allowed to request provider work.',
        403,
      );
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
  });
  const providerHealth = (): ProviderHealth => ({
    status: 'ok',
    ens: {
      configured: true,
      label: config.customRpc ? 'Configured mainnet RPC' : 'Public mainnet RPC',
    },
    mobula: mobula.health(),
    access: {
      mode: policy.restricted ? 'restricted' : 'local',
      allowedNames: policy.restricted ? allowedNames : [],
      diagnosticsEnabled: !policy.restricted,
      activityEnabled: config.activityEnabled,
    },
  });
  app.get('/api/health', async () => providerHealth());
  app.post(
    '/api/providers/mobula/verify',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request) => {
      if (policy.restricted)
        throw new AuditError(
          'DIAGNOSTICS_DISABLED',
          'Provider diagnostics are disabled on the hosted demo.',
          403,
        );
      if (
        !z
          .object({ consent: z.literal(true) })
          .strict()
          .safeParse(request.body).success
      )
        throw new AuditError(
          'CONSENT_REQUIRED',
          'Confirm sending the configured server-side API key to Mobula for one portfolio access check.',
        );
      await budget.run(() => mobula.verifyKey());
      return providerHealth();
    },
  );
  app.get('/api/demo', async (request) =>
    demoReport(
      (request.query as { scenario?: string }).scenario === 'fallback' ? 'fallback' : 'classic',
    ),
  );
  for (const kind of ['preview', 'after'] as const)
    app.post(`/api/demo/${kind}`, { bodyLimit: 24_576 }, async (request) => {
      const parsed = z
        .object({
          edits: z.unknown(),
          scenario: z.enum(['classic', 'fallback']).default('fallback'),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        throw new AuditError('INVALID_DRAFT', 'Supply a supported synthetic draft.');
      const edits = readEdits(parsed.data.edits);
      return kind === 'preview'
        ? demoPreview(edits, parsed.data.scenario)
        : demoAfter(edits, parsed.data.scenario);
    });
  app.post(
    '/api/audit',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request) => {
      const parsed = auditInput.safeParse(request.body);
      if (!parsed.success)
        throw new AuditError(
          'INVALID_REQUEST',
          'Enter a valid ENS name and confirm that this is your profile or you have permission to inspect it.',
        );
      const name = allowName(parsed.data.name);
      return budget.run(() => (options.audit ?? runAudit)(name));
    },
  );
  app.post(
    '/api/preview',
    { bodyLimit: 24_576, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      const parsed = z
        .object({ name: z.string().max(255), consent: z.literal(true), edits: z.unknown() })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        throw new AuditError(
          'INVALID_DRAFT',
          'Confirm the provider disclosure and supply a supported draft.',
        );
      const name = allowName(parsed.data.name);
      const edits = readEdits(parsed.data.edits);
      return budget.run(async () => {
        const basedOn = await (options.audit ?? runAudit)(name);
        const preview = simulateDraft(basedOn, edits);
        const records = preview.records.filter(
          (record) => record.chain === 'Ethereum' || record.chain === 'Base',
        );
        if (
          policy.restricted &&
          records.some(
            (record) =>
              !basedOn.records.some((before) => sameValue(before.value, record.value)) &&
              !policy.previewAddresses.includes(record.value.toLowerCase()),
          )
        )
          throw new AuditError(
            'WALLET_NOT_ALLOWED',
            'New wallet lookups on the hosted demo must be configured in PREVIEW_WALLETS. Local previews still work without provider enrichment.',
            403,
          );
        const freshRecords = records.filter(
          (record) =>
            !basedOn.wallets.some(
              (wallet) => wallet.chain === record.chain && sameValue(wallet.address, record.value),
            ),
        );
        const freshWallets = await (options.enrich ?? enrichWallets)(freshRecords);
        return { basedOn, wallets: [...basedOn.wallets, ...freshWallets] };
      });
    },
  );
  app.post(
    '/api/activity',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      const parsed = z
        .object({
          name: z.string().max(255),
          address: z.string().refine(isEvmValue),
          chain: z.enum(['Ethereum', 'Base']),
          consent: z.literal(true),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        throw new AuditError(
          'INVALID_REQUEST',
          'A supported wallet, chain and provider acknowledgment are required.',
        );
      const name = allowName(parsed.data.name);
      return budget.run(async () => {
        if (
          policy.restricted &&
          !policy.previewAddresses.includes(parsed.data.address.toLowerCase())
        ) {
          const ens = await (options.resolve ?? resolveEns)(name);
          if (
            !ens.records.some(
              (record) =>
                record.kind === 'address' &&
                record.chain === parsed.data.chain &&
                sameValue(record.value, parsed.data.address),
            )
          )
            throw new AuditError(
              'WALLET_NOT_ALLOWED',
              'This address and chain are not among the permitted profile records.',
              403,
            );
        }
        return (options.activity ?? fetchActivity)(parsed.data.address, parsed.data.chain);
      });
    },
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuditError)
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.status(status >= 400 && status < 500 ? status : 500).send({
      error: {
        code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message:
          status < 500
            ? 'The request could not be accepted. Check its format and try again.'
            : 'The audit could not be completed. Please try again.',
      },
    });
  });

  const clientDir = fileURLToPath(new URL('../client/', import.meta.url));
  if (options.serveStatic && existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply
            .status(404)
            .send({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
