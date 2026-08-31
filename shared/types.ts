export type Chain = 'Ethereum' | 'Base' | 'Solana';
export type RecordKind = 'address' | 'social' | 'website' | 'profile';

export interface PublicRecord {
  id: string;
  key: string;
  label: string;
  kind: RecordKind;
  value: string;
  chain?: Chain;
  origin?: 'explicit' | 'default' | 'unknown';
  sourceRecordId?: string;
}

export interface RecordState extends Omit<PublicRecord, 'value'> {
  value: string | null;
  status: 'populated' | 'empty' | 'failed' | 'unsupported';
  storedValue?: string | null;
  explanation: string;
}

export interface ResolverSupport {
  kind: 'ens-default' | 'unknown' | 'demo';
  label: string;
  canSimulate: boolean;
  reason: string;
}

export interface ControlRecord {
  role: 'Owner' | 'Manager';
  address: string;
  source: string;
}

export type DraftEdits = Record<string, string | null>;

export interface TokenIdentity {
  chain: Chain;
  address: string;
}

export interface AssetHolding {
  name: string;
  symbol: string;
  balance: number;
  valueUsd: number | null;
  kind?: 'native' | 'wrapped' | 'grouped';
  contractAddress?: string;
  identities?: TokenIdentity[];
}

export interface WalletExposure {
  id: string;
  address: string;
  chain: Chain;
  recordIds: string[];
  status: 'ready' | 'unconfigured' | 'error';
  assets: AssetHolding[];
  totalUsd: number | null;
  message: string;
  truncated: boolean;
  providerCheck?: MobulaCheck;
  activity?: WalletActivity;
}

export interface ActivityItem {
  hash: string;
  chain: Chain;
  timestamp: string;
  blockNumber: number | null;
  actions: string[];
}

export interface WalletActivity {
  status: 'ready' | 'unconfigured' | 'error';
  items: ActivityItem[];
  fetchedAt: string;
  windowDays: number;
  limit: number;
  truncated: boolean;
  message: string;
}

export interface MobulaCheck {
  ok: boolean;
  code:
    | 'OK'
    | 'NOT_CONFIGURED'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'PAYMENT_REQUIRED'
    | 'RATE_LIMITED'
    | 'ENDPOINT_NOT_FOUND'
    | 'REQUEST_REJECTED'
    | 'UPSTREAM_ERROR'
    | 'INVALID_RESPONSE'
    | 'TIMEOUT'
    | 'NETWORK_ERROR';
  httpStatus: number | null;
  checkedAt: string;
  message: string;
  detail?: string;
}

export interface MobulaHealth {
  configured: boolean;
  label: string;
  lastCheck: MobulaCheck | null;
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  action: string;
  tone: 'attention' | 'info';
  recordIds: string[];
}

export interface AuditReport {
  name: string;
  mode: 'demo' | 'live';
  observedAt: string;
  blockNumber: string | null;
  resolver: string | null;
  records: PublicRecord[];
  wallets: WalletExposure[];
  findings: Finding[];
  coverage: { checked: number; succeeded: number; failedKeys: string[] };
  warnings: string[];
  schemaVersion?: 2;
  recordStates?: RecordState[];
  resolverSupport?: ResolverSupport;
  controlRecords?: ControlRecord[];
  controlStatus?: 'ready' | 'partial' | 'unsupported';
}

export interface ProviderHealth {
  status: 'ok';
  ens: { configured: boolean; label: string };
  mobula: MobulaHealth;
  access?: {
    mode: 'local' | 'restricted';
    allowedNames: string[];
    diagnosticsEnabled: boolean;
    activityEnabled: boolean;
  };
}

export interface PreviewResponse {
  basedOn: AuditReport;
  wallets: WalletExposure[];
}

export interface ApiError {
  error: { code: string; message: string };
}

export function visibleWallets(
  report: AuditReport,
  hiddenIds: ReadonlySet<string>,
): WalletExposure[] {
  return report.wallets.filter((wallet) => wallet.recordIds.some((id) => !hiddenIds.has(id)));
}

export function knownValue(wallets: WalletExposure[]): number | null {
  const values = wallets.flatMap((wallet) => (wallet.totalUsd === null ? [] : [wallet.totalUsd]));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
