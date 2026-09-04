import { useEffect, useState } from "react";

/**
 * A ticking wall clock, for countdowns and relative timestamps.
 *
 * It does not stand in for work: nothing about the protocol advances because it
 * fires. It exists so that "expires in 4m 12s" counts down and "12s ago" ages,
 * both of which are read off `challenge.expiresAt` and `provenance.fetchedAt` —
 * real server values.
 *
 * Every former `setTimeout` that PRETENDED to be work (1400ms of fake proving,
 * 1400ms of fake verification, 1200ms of fake wallet confirmation) is gone;
 * those transitions are HTTP round trips and a real ~550ms Groth16 prove.
 *
 * The app has exactly three timers left, and none of them fakes a result:
 * this clock, the reconnect backoff in `shared/useProtocolState.ts`, and the
 * worker teardown grace period in `borrower/useProver.ts` (which exists so
 * StrictMode's unmount/remount does not throw away a 4.6 MB artifact cache).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
