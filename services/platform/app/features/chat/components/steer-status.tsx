'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useSessionProgress } from '../hooks/queries';

export type SteerStatus = 'queued' | 'claimed' | 'delivered' | 'consumed';

interface SteerStatusValue {
  /** messageId → its current mid-turn steer-queue status. */
  byMessageId: Map<string, SteerStatus>;
  /** The agent emitted its result and is lingering on held-open stdin — a
   *  queued message is pushed via the linger loop within seconds, so it's
   *  "delivering now" rather than waiting behind a long in-flight tool. */
  agentLingering: boolean;
}

// Exported for unit tests to drive `SteerStatusLine` with a controlled value
// (the provider itself depends on live Convex subscriptions).
export const SteerStatusContext = createContext<SteerStatusValue | null>(null);

/**
 * Subscribes once per thread to the mid-turn steer queue (chatMessageQueue) and
 * exposes a messageId→status map to the user bubbles below. Mounted alongside
 * `ThreadMessageMetadataProvider`.
 *
 * Why: a message sent while an external agent is working is delivered only at
 * the next tool/Stop boundary (or via stdin once the exec idles) — so during a
 * long single tool it legitimately waits, which read as random. This turns that
 * architectural latency into an explicit queued → delivered → picked-up status.
 */
export function SteerStatusProvider({
  threadId,
  organizationId,
  children,
}: {
  threadId: string | undefined;
  organizationId: string;
  children: ReactNode;
}) {
  const { data: rows } = useConvexQuery(
    api.threads.message_queue.listQueuedMessages,
    threadId ? { threadId, organizationId } : 'skip',
  );
  const progress = useSessionProgress(threadId);

  const byMessageId = useMemo(() => {
    const map = new Map<string, SteerStatus>();
    if (rows) {
      for (const r of rows) map.set(r.messageId, r.status);
    }
    return map;
  }, [rows]);

  // Agent has finished its result and is lingering (idle) — set on the op when
  // the process stays alive on held-open stdin to receive more messages.
  const agentLingering = progress?.agentIdleAt != null;

  const value = useMemo<SteerStatusValue>(
    () => ({ byMessageId, agentLingering }),
    [byMessageId, agentLingering],
  );

  return (
    <SteerStatusContext.Provider value={value}>
      {children}
    </SteerStatusContext.Provider>
  );
}

/**
 * A small line under a USER bubble showing the mid-turn steer status of that
 * message (nothing when it isn't queued). This is the ONLY consumer of the
 * steer context, so a context change re-renders just these tiny lines — not the
 * whole `MessageBubble` (which never reads the context).
 */
export function SteerStatusLine({ messageId }: { messageId: string }) {
  const { t } = useT('chat');
  const ctx = useContext(SteerStatusContext);
  const status = ctx?.byMessageId.get(messageId);
  if (!status) return null;

  let text: string;
  if (status === 'delivered') {
    text = t('queue.status.delivered');
  } else if (status === 'consumed') {
    text = t('queue.status.consumed');
  } else if (ctx?.agentLingering) {
    // queued / claimed while the agent is idle-lingering — the linger loop
    // pushes it via stdin within seconds, so it's delivering now, not waiting
    // behind a long in-flight tool.
    text = t('queue.status.deliversNow');
  } else {
    // queued / claimed — still waiting for a boundary to pick it up.
    text = t('queue.status.queued');
  }

  return (
    <div className="text-muted-foreground mt-1 px-1 text-xs italic">{text}</div>
  );
}
