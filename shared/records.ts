import type { PublicRecord } from './types.js';

export const DEFAULT_RECORD = 'address:default';
export const recordDefinitions: Omit<PublicRecord, 'value'>[] = [
  {
    id: 'address:ethereum',
    key: 'addr(60)',
    label: 'Ethereum address',
    kind: 'address',
    chain: 'Ethereum',
  },
  {
    id: 'address:base',
    key: 'addr(2147492101)',
    label: 'Base address',
    kind: 'address',
    chain: 'Base',
  },
  { id: DEFAULT_RECORD, key: 'addr(2147483648)', label: 'Default EVM address', kind: 'address' },
  {
    id: 'address:solana',
    key: 'addr(501)',
    label: 'Solana address bytes',
    kind: 'address',
    chain: 'Solana',
  },
  { id: 'text:com.twitter', key: 'com.twitter', label: 'X / Twitter', kind: 'social' },
  { id: 'text:com.github', key: 'com.github', label: 'GitHub', kind: 'social' },
  { id: 'text:url', key: 'url', label: 'Website', kind: 'website' },
  { id: 'text:email', key: 'email', label: 'Email', kind: 'profile' },
  { id: 'text:description', key: 'description', label: 'Bio', kind: 'profile' },
  { id: 'text:avatar', key: 'avatar', label: 'Avatar reference', kind: 'profile' },
];

export const isEvmValue = (value: string) => /^0x[\da-f]{40}$/i.test(value);
export const isEmptyAddress = (value: string | null) =>
  !value || value === '0x' || /^0x0+$/i.test(value);
export const sameValue = (a: string | null | undefined, b: string | null | undefined) =>
  a && b && isEvmValue(a) && isEvmValue(b)
    ? a.toLowerCase() === b.toLowerCase()
    : (a ?? null) === (b ?? null);

export function validateEdit(id: string, value: string | null): string | null {
  const definition = recordDefinitions.find((record) => record.id === id);
  if (!definition) return 'Unsupported record key.';
  if (definition.chain === 'Solana')
    return 'Solana bytes can be inspected, but editing is outside this preview.';
  if (value === null) return null;
  if (!value.trim() || value !== value.trim() || value.length > 2048)
    return 'Use 1–2048 characters without leading or trailing spaces.';
  if (definition.kind === 'address') {
    if (!isEvmValue(value) || isEmptyAddress(value))
      return 'Enter a nonzero 0x address with 40 hexadecimal digits.';
  }
  if (definition.key === 'url') {
    try {
      if (!['https:', 'http:'].includes(new URL(value).protocol))
        return 'Use an HTTP or HTTPS website URL.';
    } catch {
      return 'Enter a complete website URL.';
    }
  }
  if (definition.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return 'Enter an email address.';
  return null;
}
