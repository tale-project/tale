'use client';

import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import type { ChatAgent } from './queries';
import { useChatAgents } from './queries';

export interface ThreadAgentLock {
  /**
   * The agent this thread is bound to — non-null only when the thread's
   * stored agent (`threadMetadata.agentSlug`) resolves to an external agent.
   */
  lockedAgent: ChatAgent | null;
  isLoading: boolean;
}

/**
 * External-agent threads are bound to their agent: the sandbox session,
 * `--resume` transcript, and Plan/Act posture all key off it, so switching
 * mid-thread would silently abandon that context. This hook resolves the
 * thread's stored agent and reports a lock when it is an external one — the
 * composer then pins the selector, the send path uses the locked slug, and
 * the external-agent affordances (Plan/Act toggle, sandbox indicator, panes)
 * gate on it instead of the global per-user picker state, which other threads
 * may have changed. The backend enforces the same lock independently
 * (chat_turn_generate step 0).
 */
export function useThreadAgentLock(
  organizationId: string,
  threadId: string | undefined,
): ThreadAgentLock {
  const { data: meta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );
  const { agents, isLoading } = useChatAgents(organizationId);

  const lockedAgent = useMemo(() => {
    const slug = meta?.agentSlug;
    if (!slug) return null;
    const entry = agents?.find((a) => a.name === slug);
    return entry?.primaryBehavior === 'external-agent' ? entry : null;
  }, [meta?.agentSlug, agents]);

  return {
    lockedAgent,
    // Meta still loading counts as loading too — consumers must not flash an
    // unlocked selector on an external thread while the subscription warms up.
    isLoading: isLoading || (!!threadId && meta === undefined),
  };
}
