import { AuditError } from './errors.js';

// Bounded process-wide work, independent of IP rotation. No identities are retained.
// Hosting multiple replicas requires a shared external quota store.
export function createWorkBudget(maxPerHour: number, maxConcurrent: number, now = Date.now) {
  let used = 0;
  let started = now();
  let active = 0;
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (now() - started >= 3_600_000) {
        used = 0;
        started = now();
      }
      if (used >= maxPerHour)
        throw new AuditError(
          'BUDGET_EXHAUSTED',
          'The demo provider budget is exhausted for this hour. Synthetic demo remains available.',
          429,
        );
      if (active >= maxConcurrent)
        throw new AuditError(
          'PROVIDERS_BUSY',
          'Provider slots are busy. Please retry shortly; no work was queued.',
          429,
        );
      used++;
      active++;
      try {
        return await work();
      } finally {
        active--;
      }
    },
  };
}
