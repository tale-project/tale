import { createContext, useContext } from 'react';

import type { Session, SessionCreate } from '@/lib/api/schemas';

import type { Attempt, ReturnFocusTo } from '../lib/proxy-flows';

/**
 * What a control that needs a proxy of its own to be given calls: the one
 * implementation behind the Add dialog, every Start, every Rotate IP and the
 * card of a session that found no proxy. See `createProxyFlows`.
 */
export interface ProxyFlow {
  /** Starts the session and shows its page; asks what is needed when the server cannot yet. */
  start: (session: Session) => Promise<Attempt>;
  /**
   * Gives the session another working proxy; with `thenStart`, starts it once it
   * has one. When proxies are asked for and that is given up the keyboard goes
   * to `returnFocusTo`.
   */
  rotate: (
    session: Session,
    options?: { thenStart?: boolean; returnFocusTo?: ReturnFocusTo },
  ) => Promise<Attempt>;
  /**
   * Adds the session and shows its page; asks for proxies when none is free,
   * and when that is given up the keyboard goes to `returnFocusTo`.
   */
  create: (
    input: Partial<SessionCreate>,
    options?: { returnFocusTo?: ReturnFocusTo },
  ) => Promise<Attempt>;
  /** Asks for proxies for a session that found no working one, then starts it. */
  addProxiesFor: (session: Session) => Promise<void>;
  /** This tab's request to start the session is under way. */
  isStarting: (sessionId: number) => boolean;
  /** This tab's request to give the session another proxy is under way. */
  isRotating: (sessionId: number) => boolean;
}

export const ProxyFlowContext = createContext<ProxyFlow | null>(null);

export function useProxyFlow(): ProxyFlow {
  const flow = useContext(ProxyFlowContext);
  if (flow === null) {
    throw new Error(
      'useProxyFlow needs a ProxyFlowProvider around it (the root route mounts one)',
    );
  }
  return flow;
}
