import { z } from 'zod';
import { isAddress } from 'viem';
import type {
  AssetHolding,
  Chain,
  MobulaCheck,
  MobulaHealth,
  PublicRecord,
  WalletExposure,
  TokenIdentity,
} from '../../shared/types.js';
import { config } from '../config.js';
import { readBoundedJson } from './json.js';

const finiteNumber = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const optionalNumber = finiteNumber.nullish();
// Token metadata is untrusted display text, not a reason to discard valid balances.
// Bound what we return to the UI while keeping financial fields strictly validated.
const displayLabel = (limit: number) =>
  z.string().transform((value) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value));
const portfolioSchema = z.object({
  data: z.object({
    total_wallet_balance: optionalNumber,
    assets: z.array(
      z.object({
        token_balance: finiteNumber,
        estimated_balance: optionalNumber,
        price: optionalNumber,
        asset: z.object({ name: displayLabel(200), symbol: displayLabel(40) }),
        contracts_balances: z.unknown().optional(),
      }),
    ),
  }),
});

const nativePlaceholder = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ethContracts = {
  Ethereum: { chainId: '1', wrapped: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  Base: { chainId: '8453', wrapped: '0x4200000000000000000000000000000000000006' },
};
const breakdownSchema = z.array(
  z.object({
    address: z.string(),
    chainId: z.string(),
    balance: finiteNumber,
  }),
);

function splitEtherPosition(group: AssetHolding, breakdown: unknown, chain: Chain): AssetHolding[] {
  const expected = chain === 'Solana' ? null : ethContracts[chain];
  const parsed = breakdownSchema.safeParse(breakdown);
  const grouped = (): AssetHolding[] => [
    group.symbol === 'ETH' ? { ...group, symbol: 'ETH (grouped)', kind: 'grouped' } : group,
  ];
  if (!expected || !parsed.success || !parsed.data.length) return grouped();
  // Identify native ETH and WETH by chain + contract, never by the token's untrusted symbol.
  if (
    !parsed.data.every(
      (part) =>
        [expected.chainId, `evm:${expected.chainId}`].includes(part.chainId) &&
        [nativePlaceholder, expected.wrapped].includes(part.address.toLowerCase()),
    )
  )
    return grouped();
  const quantity = parsed.data.reduce((sum, part) => sum + part.balance, 0);
  if (
    quantity <= 0 ||
    Math.abs(quantity - group.balance) > Math.max(1e-12, Math.abs(group.balance) * 1e-10)
  )
    return grouped();

  const positions = [nativePlaceholder, expected.wrapped]
    .map((address) => ({
      address,
      balance: parsed.data
        .filter((part) => part.address.toLowerCase() === address)
        .reduce((sum, part) => sum + part.balance, 0),
    }))
    .filter((part) => part.balance > 0);
  let remainingUsd = group.valueUsd;
  return positions.map((part, index) => {
    const valueUsd =
      group.valueUsd === null
        ? null
        : index === positions.length - 1
          ? remainingUsd
          : group.valueUsd * (part.balance / quantity);
    if (remainingUsd !== null && valueUsd !== null) remainingUsd -= valueUsd;
    const native = part.address === nativePlaceholder;
    return {
      name: native ? 'Ether (native)' : 'Wrapped Ether',
      symbol: native ? 'ETH' : 'WETH',
      balance: part.balance,
      valueUsd,
      kind: native ? 'native' : 'wrapped',
      contractAddress: part.address,
      identities: [{ chain, address: part.address }],
    };
  });
}

export function parsePortfolio(
  payload: unknown,
  chain: Chain = 'Ethereum',
): {
  assets: AssetHolding[];
  totalUsd: number | null;
  truncated: boolean;
} {
  const parsed = portfolioSchema.parse(payload).data;
  const assets = parsed.assets
    .filter((asset) => asset.token_balance > 0)
    .flatMap((item) =>
      splitEtherPosition(
        {
          name: item.asset.name,
          symbol: item.asset.symbol,
          identities: tokenIdentities(item.contracts_balances, chain),
          balance: item.token_balance,
          valueUsd: finiteValue(
            item.estimated_balance ?? (item.price != null ? item.price * item.token_balance : null),
          ),
        },
        item.contracts_balances,
        chain,
      ),
    )
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  // A provider's total is an estimate. Without it, unknown-price assets prevent claiming a complete total.
  const totalUsd =
    parsed.total_wallet_balance ??
    (assets.every((asset) => asset.valueUsd !== null)
      ? assets.reduce((total, asset) => total + (asset.valueUsd ?? 0), 0)
      : null);
  return {
    assets: assets.slice(0, 8),
    totalUsd: finiteValue(totalUsd),
    truncated: assets.length > 8,
  };
}

function finiteValue(value: number | null) {
  return value !== null && Number.isFinite(value) ? value : null;
}

function tokenIdentities(breakdown: unknown, chain: Chain): TokenIdentity[] {
  if (!Array.isArray(breakdown)) return [];
  const chainId = chain === 'Ethereum' ? '1' : chain === 'Base' ? '8453' : '';
  const identities = new Map<string, TokenIdentity>();
  for (const part of breakdown) {
    if (!part || typeof part !== 'object' || !['string', 'number'].includes(typeof part.chainId))
      continue;
    if (
      ![chainId, `evm:${chainId}`].includes(String(part.chainId)) ||
      typeof part.address !== 'string' ||
      !isAddress(part.address, { strict: false })
    )
      continue;
    identities.set(part.address.toLowerCase(), { chain, address: part.address.toLowerCase() });
  }
  return [...identities.values()].slice(0, 100);
}

const chainNames: Record<Chain, string> = { Ethereum: 'ethereum', Base: 'base', Solana: 'solana' };

export function groupWalletRecords(records: PublicRecord[]): WalletExposure[] {
  const wallets = new Map<string, WalletExposure>();
  for (const record of records) {
    if (record.kind !== 'address' || !record.chain) continue;
    // viem returns non-EVM records as hex bytes. Decode Solana only when a supported decoder is available later.
    if (record.chain === 'Solana') continue;
    if (!isAddress(record.value, { strict: false })) continue;
    const id = `${record.chain}:${record.value.toLowerCase()}`;
    const existing = wallets.get(id);
    if (existing) existing.recordIds.push(record.id);
    else
      wallets.set(id, {
        id,
        address: record.value,
        chain: record.chain,
        recordIds: [record.id],
        status: 'unconfigured',
        assets: [],
        totalUsd: null,
        truncated: false,
        message: 'Set MOBULA_API_KEY in your local .env to enable live holdings.',
      });
  }
  return [...wallets.values()];
}

interface MobulaOptions {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
}

function check(
  code: MobulaCheck['code'],
  message: string,
  httpStatus: number | null = null,
): MobulaCheck {
  return { ok: code === 'OK', code, message, httpStatus, checkedAt: new Date().toISOString() };
}

function httpFailure(status: number): MobulaCheck {
  if (status === 400 || status === 422)
    return check(
      'REQUEST_REJECTED',
      `Mobula rejected the request (HTTP ${status}). Check the provider explanation, API key, and endpoint parameters. This status alone does not identify the cause.`,
      status,
    );
  if (status === 401)
    return check(
      'UNAUTHORIZED',
      'Mobula rejected the API key (HTTP 401). Check MOBULA_API_KEY in .env and restart the API.',
      status,
    );
  if (status === 403)
    return check(
      'FORBIDDEN',
      'Mobula denied access (HTTP 403). Check the key restrictions and whether your plan allows wallet portfolios.',
      status,
    );
  if (status === 402)
    return check(
      'PAYMENT_REQUIRED',
      'Mobula requires credits or an eligible plan (HTTP 402). Check your Mobula account.',
      status,
    );
  if (status === 429)
    return check(
      'RATE_LIMITED',
      'Mobula rate or quota limit reached (HTTP 429). Wait before retrying and check your account limits.',
      status,
    );
  if (status === 404)
    return check(
      'ENDPOINT_NOT_FOUND',
      'Mobula endpoint not found (HTTP 404). Check MOBULA_API_URL; the default base path is /api/1.',
      status,
    );
  return check(
    'UPSTREAM_ERROR',
    `Mobula returned HTTP ${status}. Retry later; this does not establish that the key is invalid.`,
    status,
  );
}

export function createMobulaProvider(options: MobulaOptions = {}) {
  const apiKey = options.apiKey ?? config.mobulaKey;
  const apiUrl = options.apiUrl ?? config.mobulaUrl;
  const request = options.fetch ?? globalThis.fetch;
  // Keep only a sanitized result in memory, never the queried name/address or response body.
  let lastCheck: MobulaCheck | null = null;

  async function failure(response: Response): Promise<MobulaCheck> {
    const result = httpFailure(response.status);
    try {
      const body: unknown = await readBoundedJson(response, 64_000);
      if (typeof body !== 'object' || body === null) return result;
      const object = body as Record<string, unknown>;
      const nested =
        typeof object.error === 'object' && object.error !== null
          ? (object.error as Record<string, unknown>).message
          : undefined;
      const message = [object.message, object.error, nested].find(
        (value) => typeof value === 'string',
      );
      if (typeof message !== 'string') return result;
      // Surface only an error message, never an arbitrary response object. Remove the exact
      // credential (including its URL-encoded form), URLs, addresses, and token-like strings.
      const detail = message
        .replaceAll(apiKey, '[redacted]')
        .replaceAll(encodeURIComponent(apiKey), '[redacted]')
        .replace(/https?:\/\/[^\s<>"']+/gi, '[endpoint]')
        .replace(/0x[a-f\d]{40,}/gi, '[address]')
        .replace(/[a-z\d_+\/.=-]{32,}/gi, '[redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 240);
      if (detail) result.detail = detail;
    } catch {
      /* HTML/proxy errors are deliberately not shown. */
    }
    return result;
  }

  function health(): MobulaHealth {
    return {
      configured: Boolean(apiKey),
      label: !apiKey
        ? 'API key not configured'
        : !lastCheck
          ? 'API key configured · not checked'
          : lastCheck.ok
            ? 'Last portfolio check succeeded'
            : `Last check: ${lastCheck.code.toLowerCase().replaceAll('_', ' ')}`,
      lastCheck,
    };
  }

  async function lookup(
    address: string,
    chain: Chain,
  ): Promise<{
    check: MobulaCheck;
    portfolio?: ReturnType<typeof parsePortfolio>;
  }> {
    if (!apiKey)
      return {
        check: check(
          'NOT_CONFIGURED',
          'Set MOBULA_API_KEY in .env and restart the API before verifying.',
        ),
      };
    let httpStatus: number | null = null;
    try {
      const url = new URL(`${apiUrl}/wallet/portfolio`);
      url.searchParams.set('wallet', address);
      url.searchParams.set('blockchains', chainNames[chain]);
      url.searchParams.set('filterSpam', 'true');
      url.searchParams.set('cache', 'false');
      const response = await request(url, {
        headers: { Authorization: apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
        redirect: 'error',
      });
      httpStatus = response.status;
      if (!response.ok) {
        return { check: await failure(response) };
      }
      try {
        const payload: unknown = await readBoundedJson(response);
        const portfolio = parsePortfolio(payload, chain);
        return {
          portfolio,
          check: check(
            'OK',
            'Mobula accepted an authenticated portfolio request and returned a valid response. This checks access, not complete coverage of every wallet.',
            response.status,
          ),
        };
      } catch (error) {
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
          throw error;
        const paths =
          error instanceof z.ZodError
            ? [...new Set(error.issues.map((issue) => issue.path.join('.')))].slice(0, 3).join(', ')
            : '';
        return {
          check: check(
            'INVALID_RESPONSE',
            `Mobula responded, but Footprint could not read the portfolio format${paths ? ` (${paths})` : ''}. This is not an invalid-key diagnosis.`,
            response.status,
          ),
        };
      }
    } catch (error) {
      return {
        check:
          error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
            ? check(
                'TIMEOUT',
                'Mobula did not finish within 12 seconds. Retry; a timeout does not mean the key is invalid.',
                httpStatus,
              )
            : check(
                'NETWORK_ERROR',
                'Could not reach Mobula. Check connectivity and MOBULA_API_URL. No authentication result is available.',
                httpStatus,
              ),
      };
    }
  }

  async function enrich(records: PublicRecord[]): Promise<WalletExposure[]> {
    const wallets = groupWalletRecords(records);
    if (!apiKey) return wallets;
    const results = await Promise.all(
      wallets.map(async (wallet) => {
        const result = await lookup(wallet.address, wallet.chain);
        return {
          ...wallet,
          ...result.portfolio,
          providerCheck: result.check,
          status: result.portfolio ? ('ready' as const) : ('error' as const),
          message: result.portfolio
            ? 'Mobula portfolio snapshot. Values are estimates; spam filtering and provider coverage can omit assets.'
            : `${result.check.message}${result.check.detail ? ` Provider: ${result.check.detail}` : ''} Holdings remain unknown.`,
        };
      }),
    );
    // Preserve a failure in a partial result instead of hiding it behind the other wallet's success.
    lastCheck =
      results.find((wallet) => !wallet.providerCheck.ok)?.providerCheck ??
      results.at(-1)?.providerCheck ??
      lastCheck;
    return results;
  }

  async function verifyKey(): Promise<MobulaCheck> {
    // Public example from Mobula's wallet-portfolio documentation, verified against its live API.
    // Reserved/precompile addresses may be rejected as unsupported wallets.
    const result = await lookup('0xaF88370abD82EC6943cdB3D4ec7b764B92c35B43', 'Ethereum');
    lastCheck = result.check;
    return result.check;
  }

  return { health, enrich, verifyKey };
}

export const mobulaProvider = createMobulaProvider();

export async function enrichWallets(
  records: PublicRecord[],
  options?: MobulaOptions,
): Promise<WalletExposure[]> {
  return (options ? createMobulaProvider(options) : mobulaProvider).enrich(records);
}
