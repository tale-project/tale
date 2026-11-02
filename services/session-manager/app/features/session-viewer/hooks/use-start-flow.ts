import { useBrowserBlock } from '@/app/features/sessions/hooks/use-browser-block';
import { useProxyFlow } from '@/app/features/sessions/hooks/use-proxy-flow';
import type { Session } from '@/lib/api/schemas';

/**
 * Starting a session, or giving it another proxy, from its page. The questions
 * a start can raise (no free proxy, the same exit IP as a running session, a
 * proxy that does not work) are asked by the proxy flow, in its own dialogs,
 * as they are from the list; so is what follows a rotation.
 */
export function useStartFlow(session: Session) {
  const flow = useProxyFlow();
  const blockedReason = useBrowserBlock();

  return {
    /** Why no session can start now: the browser is being installed, or is missing. */
    blockedReason,
    start: () => {
      void flow.start(session);
    },
    isStarting: flow.isStarting(session.id),
    /** Gives the session another proxy, and starts it once it has one. */
    rotate: () => {
      void flow.rotate(session, { thenStart: true });
    },
    isRotating: flow.isRotating(session.id),
    /** Asks for proxies for a session that found no working one, then starts it. */
    addProxies: () => {
      void flow.addProxiesFor(session);
    },
  };
}
