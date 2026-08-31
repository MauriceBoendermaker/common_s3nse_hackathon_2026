import type {
  ApiError,
  AuditReport,
  ProviderHealth,
  DraftEdits,
  PreviewResponse,
  WalletActivity,
  Chain,
} from '../../shared/types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(
      'Cannot reach the Footprint API. Make sure npm run dev is running, then retry.',
    );
  }
  if (!response.ok) {
    let message = `The API returned an error (${response.status}). Please retry.`;
    try {
      message = ((await response.json()) as ApiError).error?.message || message;
    } catch {
      /* Non-JSON proxy error. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const getHealth = (signal?: AbortSignal) =>
  request<ProviderHealth>('/api/health', { signal });
export const getDemo = (signal?: AbortSignal, scenario = 'fallback') =>
  request<AuditReport>(`/api/demo?scenario=${scenario}`, { signal });
export const verifyMobulaKey = () =>
  request<ProviderHealth>('/api/providers/mobula/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true }),
  });
export const getAudit = (name: string, consent: boolean, signal?: AbortSignal) =>
  request<AuditReport>('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, consent }),
    signal,
  });

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
export const getPreview = (report: AuditReport, edits: DraftEdits, signal?: AbortSignal) =>
  report.mode === 'demo'
    ? post<PreviewResponse>(
        '/api/demo/preview',
        {
          edits,
          scenario: report.records.some((record) => record.id === 'address:default')
            ? 'fallback'
            : 'classic',
        },
        signal,
      )
    : post<PreviewResponse>('/api/preview', { name: report.name, edits, consent: true }, signal);
export const getDemoAfter = (edits: DraftEdits, signal?: AbortSignal, scenario = 'fallback') =>
  post<AuditReport>('/api/demo/after', { edits, scenario }, signal);
export const getActivity = (name: string, address: string, chain: Chain, signal?: AbortSignal) =>
  post<WalletActivity>('/api/activity', { name, address, chain, consent: true }, signal);
