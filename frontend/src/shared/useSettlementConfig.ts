/**
 * The deployed settlement contract, read from the server rather than written
 * into the copy.
 *
 * The content pages are the part of this app most likely to go quietly stale:
 * they are prose, nobody typechecks them, and a sentence that was honest last
 * week ("no program is deployed") becomes a lie the moment one is. So the
 * pages that make a claim about the chain ask the backend what is actually
 * true and render that, and the only hard-coded words left are the ones that
 * stay true either way.
 *
 * Fails soft on purpose. A content page must render with no backend at all —
 * `null` means "we could not ask", which the caller shows as exactly that.
 */

import { useEffect, useState } from "react";

import { getSettlementConfig } from "./apiClient";
import type { SettlementConfig } from "./protocol-types";

export type SettlementConfigState = {
  config: SettlementConfig | null;
  loading: boolean;
};

export function useSettlementConfig(): SettlementConfigState {
  const [config, setConfig] = useState<SettlementConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getSettlementConfig()
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch(() => {
        if (live) setConfig(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { config, loading };
}

/** `69qmzHFd…vvRc`, or a dash when nothing is deployed. */
export function shortAddress(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length <= 20 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/**
 * One sentence naming what is deployed and where, for the content pages.
 *
 * Deliberately says "a local validator" out loud when that is the case. A
 * deployed devnet address is an explicit judging deliverable, and blurring the
 * difference between devnet and localhost would be the single easiest thing to
 * be caught overclaiming about.
 */
export function deploymentSentence(config: SettlementConfig | null): string {
  if (!config) {
    return "The settlement contract could not be reached from this page, so nothing is claimed about it here.";
  }
  if (!config.programId) {
    return "No settlement program is deployed. The flow ends with a verified receipt and a derived payout address, which is a real result and is not the same as funds moving.";
  }
  const where =
    config.cluster === "localnet"
      ? "a local Solana validator (not a public cluster — the explorer links only resolve on the machine running it)"
      : `Solana ${config.cluster}`;
  return config.enabled
    ? `The private_credit program is deployed at ${config.programId} on ${where}, and it is the thing that verifies the Groth16 proof and releases the escrow.`
    : `The private_credit program is deployed at ${config.programId} on ${where}, but this server cannot currently settle against it: ${config.problem}`;
}
