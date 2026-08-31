import { z } from 'zod';
import type { Chain, WalletActivity, ActivityItem } from '../../shared/types.js';
import { config } from '../config.js';
import { readBoundedJson } from './json.js';

const WINDOW_DAYS = 30;
const LIMIT = 10;
const rowSchema = z.object({
  chainId: z.union([z.string(), z.number()]),
  txHash: z.string().regex(/^0x[\da-f]{64}$/i),
  txDateMs: z.coerce.number().finite().nonnegative(),
  txBlockNumber: z.coerce.number().int().nonnegative().nullish(),
  actions: z.array(z.object({ model: z.string().max(80) })).max(1000),
});

export function parseActivity(payload: unknown, chain: Chain, now = Date.now()): WalletActivity {
  const body = z
    .object({
      data: z.array(z.unknown()).max(1000),
      pagination: z.unknown().optional(),
      backfillStatus: z.string().optional(),
    })
    .parse(payload);
  const items: ActivityItem[] = [];
  let rejected = 0;
  const chainId = chain === 'Ethereum' ? '1' : '8453';
  const hashes = new Set<string>();
  for (const raw of body.data) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const row = parsed.data;
    if (
      ![chainId, `evm:${chainId}`].includes(String(row.chainId)) ||
      row.txDateMs < now - WINDOW_DAYS * 86_400_000 ||
      row.txDateMs > now + 60_000
    ) {
      rejected++;
      continue;
    }
    if (hashes.has(row.txHash.toLowerCase())) continue;
    hashes.add(row.txHash.toLowerCase());
    items.push({
      hash: row.txHash,
      chain,
      timestamp: new Date(row.txDateMs).toISOString(),
      blockNumber: row.txBlockNumber ?? null,
      actions: [
        ...new Set(
          row.actions.map((action) =>
            ['transfer', 'swap', 'vault'].includes(action.model)
              ? action.model
              : 'other onchain action',
          ),
        ),
      ],
    });
  }
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const incomplete =
    rejected > 0 || (body.backfillStatus !== undefined && body.backfillStatus !== 'processed');
  return {
    status: 'ready',
    items: items.slice(0, LIMIT),
    fetchedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    limit: LIMIT,
    truncated: body.data.length >= LIMIT || incomplete,
    message: `Mobula activity sample, at most ${LIMIT} entries from ${WINDOW_DAYS} days. No counterparties are followed.${incomplete ? ' Some entries could not be interpreted or indexing is incomplete.' : ''} An empty sample does not prove no activity.`,
  };
}

export async function fetchActivity(
  address: string,
  chain: Chain,
  options: {
    apiKey?: string;
    apiUrl?: string;
    fetch?: typeof fetch;
    enabled?: boolean;
    now?: number;
  } = {},
): Promise<WalletActivity> {
  const now = options.now ?? Date.now();
  const base: WalletActivity = {
    status: 'unconfigured',
    items: [],
    fetchedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    limit: LIMIT,
    truncated: false,
    message: 'Activity enrichment is unavailable or disabled.',
  };
  const key = options.apiKey ?? config.mobulaKey;
  if (!key || !(options.enabled ?? config.activityEnabled) || chain === 'Solana') return base;
  try {
    const url = new URL(options.apiUrl ?? config.mobulaUrl);
    // Activity is a v2 endpoint. Preserve a configured service prefix without changing origin.
    url.pathname = url.pathname.replace(/\/1\/?$/, '/2').replace(/\/$/, '') + '/wallet/activity';
    url.search = '';
    url.searchParams.set('wallet', address);
    url.searchParams.set('chainIds', chain === 'Ethereum' ? 'evm:1' : 'evm:8453');
    url.searchParams.set('limit', String(LIMIT));
    url.searchParams.set('from', String(now - WINDOW_DAYS * 86_400_000));
    url.searchParams.set('to', String(now));
    url.searchParams.set('filterSpam', 'true');
    url.searchParams.set('order', 'desc');
    const response = await (options.fetch ?? fetch)(url, {
      headers: { Authorization: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
    if (!response.ok)
      return {
        ...base,
        status: 'error',
        message: `Activity request returned HTTP ${response.status}. Portfolio evidence is unchanged. Check endpoint access or quota; activity remains unknown.`,
      };
    return parseActivity(await readBoundedJson(response), chain, now);
  } catch {
    return {
      ...base,
      status: 'error',
      message:
        'Activity could not be read within the request window or its format was unsupported. Portfolio evidence is unchanged.',
    };
  }
}
