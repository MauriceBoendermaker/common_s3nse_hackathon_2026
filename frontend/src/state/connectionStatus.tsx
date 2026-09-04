/**
 * A one-way status channel from whichever party view is mounted up to the
 * shared header.
 *
 * `App.tsx` deliberately owns no protocol state any more — each view calls
 * `useProtocolState(role)` for itself. But the header has to show which party
 * this tab is and whether its long-poll is alive, because that single detail is
 * what makes the two-tab trust boundary visible: tab A reads
 * "live · borrower 3f9c…" and tab B reads "live · lender a17b…".
 *
 * So the view publishes three scalars upward. Note what cannot travel here:
 * there is no field for a witness, a passport or a policy — only a role, a
 * connection status and a session id the server issued in public.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ConnectionStatus } from "../shared/useProtocolState";
import type { Role } from "../shared/protocol-types";

export type PartyStatus = {
  role: Role;
  label: string;
  sessionId: string | null;
  connection: ConnectionStatus;
};

type Channel = {
  status: PartyStatus | null;
  publish: (status: PartyStatus | null) => void;
};

const PartyStatusContext = createContext<Channel>({
  status: null,
  publish: () => {},
});

export function PartyStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PartyStatus | null>(null);

  const publish = useCallback((next: PartyStatus | null) => {
    setStatus((current) => {
      if (current === next) return current;
      if (
        current &&
        next &&
        current.role === next.role &&
        current.label === next.label &&
        current.sessionId === next.sessionId &&
        current.connection === next.connection
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const value = useMemo<Channel>(() => ({ status, publish }), [status, publish]);

  return (
    <PartyStatusContext.Provider value={value}>{children}</PartyStatusContext.Provider>
  );
}

/** Read the mounted party's status. Used by the header only. */
export function usePartyStatus(): PartyStatus | null {
  return useContext(PartyStatusContext).status;
}

/**
 * Called by BorrowerView / LenderView. Publishes on change and clears on
 * unmount, so navigating to a content page drops the party pill rather than
 * leaving a stale one behind.
 */
export function usePublishPartyStatus(status: PartyStatus): void {
  const { publish } = useContext(PartyStatusContext);
  const { role, label, sessionId, connection } = status;

  useEffect(() => {
    publish({ role, label, sessionId, connection });
    return () => publish(null);
  }, [publish, role, label, sessionId, connection]);
}
