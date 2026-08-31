import 'dotenv/config';
import { mainnet } from 'viem/chains';

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error(`${name} must use HTTP or HTTPS.`);
  return url.toString().replace(/\/$/, '');
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  rpcUrl: httpUrl(process.env.ETH_RPC_URL || mainnet.rpcUrls.default.http[0], 'ETH_RPC_URL'),
  customRpc: Boolean(process.env.ETH_RPC_URL),
  mobulaKey: process.env.MOBULA_API_KEY?.trim() || '',
  mobulaUrl: httpUrl(process.env.MOBULA_API_URL || 'https://api.mobula.io/api/1', 'MOBULA_API_URL'),
  restricted:
    process.env.FOOTPRINT_MODE === 'restricted' ||
    process.env.NODE_ENV === 'production' ||
    !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST || '127.0.0.1'),
  allowedNames: (process.env.LIVE_DEMO_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
  previewAddresses: (process.env.PREVIEW_WALLETS || '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean),
  appOrigin: process.env.APP_ORIGIN || '',
  trustProxy: (process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean),
  activityEnabled: process.env.MOBULA_ACTIVITY_ENABLED !== 'false',
  maxJobs: boundedNumber(process.env.MAX_PROVIDER_JOBS_PER_HOUR, 30, 1, 200),
  maxConcurrency: boundedNumber(process.env.MAX_PROVIDER_CONCURRENCY, 2, 1, 4),
};

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error('Provider budget configuration is outside supported limits.');
  return number;
}
