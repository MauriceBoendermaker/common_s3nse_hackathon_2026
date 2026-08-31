import {
  BaseError,
  createPublicClient,
  http,
  zeroAddress,
  namehash,
  keccak256,
  toHex,
  parseAbi,
} from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import type {
  PublicRecord,
  RecordState,
  ControlRecord,
  ResolverSupport,
} from '../../shared/types.js';
import {
  recordDefinitions,
  DEFAULT_RECORD,
  isEmptyAddress,
  sameValue,
} from '../../shared/records.js';
import { config } from '../config.js';
import { AuditError } from '../errors.js';

const client = createPublicClient({
  chain: mainnet,
  transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 1, retryDelay: 300 }),
  // Do not let untrusted ENS records make this prototype's server fetch arbitrary CCIP gateways.
  ccipRead: false,
});

export interface EnsReader {
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>;
  getEnsResolver(args: { name: string; blockNumber: bigint }): Promise<`0x${string}` | null>;
  getEnsAddress(args: {
    name: string;
    coinType: bigint;
    blockNumber: bigint;
    strict?: boolean;
  }): Promise<string | null>;
  getEnsText(args: {
    name: string;
    key: string;
    blockNumber: bigint;
    strict?: boolean;
  }): Promise<string | null>;
  hasAddress?(
    resolver: `0x${string}`,
    name: string,
    coinType: bigint,
    blockNumber: bigint,
  ): Promise<boolean>;
  controls?(
    name: string,
    blockNumber: bigint,
  ): Promise<{ records: ControlRecord[]; status: 'ready' | 'partial' | 'unsupported' }>;
}

// Official mainnet deployment, verified against ensdomains/ens-contracts staging.
// This immutable resolver has hasAddr and ENSIP-19 fallback semantics. Custom resolvers
// are never assumed equivalent merely because they implement the same interface.
export const DEFAULT_AWARE_RESOLVER = '0xf29100983e058b709f3d539b0c765937b804ac15';
const registry = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const registrar = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
const wrapper = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
const ownerAbi = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function ownerOf(uint256 id) view returns (address)',
]);
const liveReader: EnsReader = {
  getBlockNumber: (args) => client.getBlockNumber(args),
  getEnsResolver: (args) => client.getEnsResolver(args),
  getEnsAddress: (args) => client.getEnsAddress(args),
  getEnsText: (args) => client.getEnsText(args),
  hasAddress: (resolver, name, coinType, blockNumber) =>
    client.readContract({
      address: resolver,
      abi: parseAbi(['function hasAddr(bytes32 node, uint256 coinType) view returns (bool)']),
      functionName: 'hasAddr',
      args: [namehash(name), coinType],
      blockNumber,
    }),
  async controls(name, blockNumber) {
    if (!/^[^.]+\.eth$/.test(name)) return { records: [], status: 'unsupported' };
    const results = await Promise.allSettled([
      client.readContract({
        address: registry,
        abi: ownerAbi,
        functionName: 'owner',
        args: [namehash(name)],
        blockNumber,
      }),
      client.readContract({
        address: registrar,
        abi: ownerAbi,
        functionName: 'ownerOf',
        args: [BigInt(keccak256(toHex(name.split('.')[0])))],
        blockNumber,
      }),
    ]);
    if (
      results.some(
        (result) =>
          result.status === 'fulfilled' && result.value.toLowerCase() === wrapper.toLowerCase(),
      )
    ) {
      try {
        const address = await client.readContract({
          address: wrapper,
          abi: ownerAbi,
          functionName: 'ownerOf',
          args: [BigInt(namehash(name))],
          blockNumber,
        });
        return {
          records: isEmptyAddress(address)
            ? []
            : [{ role: 'Owner', address, source: 'ENS Name Wrapper ownerOf(namehash)' }],
          status: results.every((result) => result.status === 'fulfilled') ? 'ready' : 'partial',
        };
      } catch {
        return { records: [], status: 'partial' };
      }
    }
    const records: ControlRecord[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && !isEmptyAddress(result.value))
        records.push({
          role: index === 0 ? 'Manager' : 'Owner',
          address: result.value,
          source:
            index === 0 ? 'ENS Registry owner(node)' : 'ENS Base Registrar ownerOf(labelhash)',
        });
    });
    return {
      records,
      status: results.every((result) => result.status === 'fulfilled') ? 'ready' : 'partial',
    };
  },
};

export function normalizeName(input: string): string {
  if (
    input.length > 255 ||
    !input.includes('.') ||
    input !== input.trim() ||
    /[\s/:@?#]/u.test(input)
  ) {
    throw new AuditError(
      'INVALID_NAME',
      'Enter an ENS name such as yourname.eth, without a URL or spaces.',
    );
  }
  try {
    return normalize(input);
  } catch {
    throw new AuditError('INVALID_NAME', 'This name is not valid under ENS normalization rules.');
  }
}

export async function resolveEns(name: string, reader: EnsReader = liveReader) {
  let blockNumber: bigint;
  let resolver: `0x${string}` | null;
  try {
    blockNumber = await reader.getBlockNumber({ cacheTime: 0 });
    resolver = await reader.getEnsResolver({ name, blockNumber });
  } catch {
    throw new AuditError(
      'ENS_UNAVAILABLE',
      'The Ethereum RPC could not resolve this name. Retry or configure ETH_RPC_URL in .env. Offchain-only resolvers are not supported in this prototype.',
      502,
    );
  }
  if (!resolver || resolver === zeroAddress) {
    throw new AuditError(
      'NAME_NOT_FOUND',
      'No ENS resolver was found for this name on Ethereum mainnet. Check the spelling or try another name you control.',
      404,
    );
  }

  const supported = resolver.toLowerCase() === DEFAULT_AWARE_RESOLVER && Boolean(reader.hasAddress);
  const controlsPromise = reader
    .controls?.(name, blockNumber)
    .catch(() => ({ records: [] as ControlRecord[], status: 'partial' as const }));
  const states = await Promise.all(
    recordDefinitions.map(async (definition): Promise<RecordState> => {
      try {
        const coinType =
          definition.kind === 'address'
            ? BigInt(definition.key.match(/\d+/)?.[0] ?? '60')
            : undefined;
        const value =
          coinType !== undefined
            ? await reader.getEnsAddress({ name, coinType, blockNumber, strict: true })
            : await reader.getEnsText({ name, key: definition.key, blockNumber, strict: true });
        // Bound upstream text size; do not render arbitrary URLs as HTML or load remote avatars.
        if (value && value.length > 2048) throw new Error('Record exceeds prototype display limit');
        const populated = definition.kind === 'address' ? !isEmptyAddress(value) : Boolean(value);
        const state: RecordState = {
          ...definition,
          value: populated ? value : null,
          status: populated ? 'populated' : 'empty',
          origin: 'unknown',
          explanation:
            'A strict resolver lookup at the snapshot block. Stored-record origin is not verified for this resolver.',
        };
        if (supported) {
          if (coinType !== undefined) {
            try {
              const explicit = await reader.hasAddress!(resolver, name, coinType, blockNumber);
              state.storedValue = explicit ? value || zeroAddress : null;
              state.origin =
                explicit || definition.id === DEFAULT_RECORD || definition.chain === 'Solana'
                  ? 'explicit'
                  : 'default';
              if (state.origin === 'default') state.sourceRecordId = DEFAULT_RECORD;
              state.explanation = explicit
                ? 'hasAddr confirms an explicitly stored address at this block.'
                : state.origin === 'default'
                  ? 'hasAddr is false. This chain uses the Default EVM record when populated.'
                  : 'hasAddr confirms no explicit address at this block.';
            } catch {
              state.explanation =
                'Resolution succeeded, but hasAddr failed. The stored origin and edit consequences remain unknown.';
            }
          } else {
            state.storedValue = value || null;
            state.origin = 'explicit';
            state.explanation =
              'Text stored in the supported onchain public resolver at the snapshot block.';
          }
        }
        return state;
      } catch (error) {
        const unsupported =
          error instanceof BaseError &&
          Boolean(
            error.walk(
              (cause) =>
                typeof cause === 'object' &&
                cause !== null &&
                'data' in cause &&
                (cause.data as { errorName?: string })?.errorName === 'UnsupportedResolverProfile',
            )?.name === 'ContractFunctionRevertedError',
          );
        return {
          ...definition,
          value: null,
          status: unsupported ? 'unsupported' : 'failed',
          origin: 'unknown',
          explanation: unsupported
            ? 'The resolver does not support this record profile.'
            : 'The strict lookup failed. No conclusion about publication can be drawn.',
        };
      }
    }),
  );
  // A hasAddr result is evidence of fallback only if the resolved value also agrees
  // with the independently read Default at the same block.
  const defaultState = states.find((state) => state.id === DEFAULT_RECORD)!;
  for (const state of states) {
    if (
      state.origin === 'default' &&
      (['failed', 'unsupported'].includes(defaultState.status) ||
        !sameValue(state.value, defaultState.value))
    ) {
      state.origin = 'unknown';
      state.storedValue = undefined;
      state.sourceRecordId = undefined;
      state.explanation =
        'Default provenance could not be reconciled. Preview consequences remain unknown.';
    }
  }
  const records: PublicRecord[] = states
    .filter((state) => state.status === 'populated')
    .map(({ status: _status, storedValue: _stored, explanation: _explanation, ...record }) => ({
      ...record,
      value: record.value!,
    }));
  const failedKeys = states
    .filter((state) => state.status === 'failed' || state.status === 'unsupported')
    .map((state) => state.key);
  const controls = await controlsPromise;
  const resolverSupport: ResolverSupport = {
    kind: supported ? 'ens-default' : 'unknown',
    label: supported ? 'ENS Public Resolver · Default aware' : 'Unverified resolver semantics',
    canSimulate: supported,
    reason: supported
      ? 'Pinned mainnet resolver implementation; explicit addresses verified with hasAddr.'
      : 'Reads are available, but this resolver is outside the supported edit simulation. Draft consequences remain unknown.',
  };
  return {
    records,
    recordStates: states,
    resolverSupport,
    controlRecords: controls?.records || [],
    controlStatus: controls?.status || ('unsupported' as const),
    blockNumber: blockNumber.toString(),
    resolver,
    coverage: {
      checked: recordDefinitions.length,
      succeeded: recordDefinitions.length - failedKeys.length,
      failedKeys,
    },
  };
}
