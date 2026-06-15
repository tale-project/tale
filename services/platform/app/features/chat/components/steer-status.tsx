'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useSessionProgress } from '../hooks/queries';
import { buildExternalAgentParts } from '../utils/build-external-agent-parts';
import { buildMessageSegments } from '../utils/build-message-segments';
import { formatToolDetail } from '../utils/format-tool-detail';

export type SteerStatus = 'queued' | 'claimed' | 'delivered' | 'consumed';

interface SteerStatusValue {
  /** messageId → its current mid-turn steer-queue status. */
  byMessageId: Map<string, SteerStatus>;
  /** The running turn's in-flight tool label (e.g. "Bash …"), surfaced so a
   *  queued steer message can say which step it's waiting behind. */
  currentStepLabel?: string;
}

const SteerStatusContext = createContext<SteerStatusValue | null>(null);

/**
 * Subscribes once per thread to the mid-turn steer queue (chatMessageQueue) and
 * exposes a messageId→status map + the running turn's current step to the user
 * bubbles below. Mounted alongside `ThreadMessageMetadataProvider`.
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
  const { t } = useT('chat');
  const progress = useSessionProgress(threadId);

  const byMessageId = useMemo(() => {
    const map = new Map<string, SteerStatus>();
    if (rows) {
      for (const r of rows) map.set(r.messageId, r.status);
    }
    return map;
  }, [rows]);

  // Only derive the live step while a steer is actually waiting — keeps the
  // context (and the bubbles that read it) from churning on every 500ms
  // progress flush of a normal, un-steered turn.
  const hasPending = useMemo(() => {
    for (const s of byMessageId.values()) {
      if (s === 'queued' || s === 'claimed') return true;
    }
    return false;
  }, [byMessageId]);

  const currentStepLabel = useMemo(() => {
    if (!hasPending || progress?.status !== 'running') return undefined;
    const { segments } = buildMessageSegments(
      buildExternalAgentParts(progress.recentEvents),
    );
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (
        s.kind === 'tool' &&
        (s.state === 'input-streaming' || s.state === 'input-available')
      ) {
        return formatToolDetail(t, s.toolName, s.input).displayText;
      }
    }
    return undefined;
  }, [hasPending, progress?.status, progress?.recentEvents, t]);

  const value = useMemo<SteerStatusValue>(
    () => ({
      byMessageId,
      ...(currentStepLabel !== undefined && { currentStepLabel }),
    }),
    [byMessageId, currentStepLabel],
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
  } else {
    // queued / claimed — still waiting for a boundary to pick it up.
    text = ctx?.currentStepLabel
      ? t('queue.status.queuedWithStep', { step: ctx.currentStepLabel })
      : t('queue.status.queued');
  }

  return (
    <div className="text-muted-foreground mt-1 px-1 text-xs italic">{text}</div>
  );
}
