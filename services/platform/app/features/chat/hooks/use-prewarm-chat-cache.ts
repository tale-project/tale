import { useCallback, useRef } from 'react';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

import { useUnifiedChatWithAgent } from './mutations';

// Just under Anthropic's ~5-min ephemeral prompt-cache window, so repeated
// focus/typing fires at most one priming call per warm period.
const PREWARM_TTL_MS = 4 * 60 * 1000;

/** The dedup key of the most recent prewarm and when it fired (epoch ms). */
interface PrewarmRecord {
  key: string;
  at: number;
}

/** The per-(thread,agent,project) dedup key for a prewarm. */
export function prewarmKey(
  threadId: string,
  agentSlug: string,
  projectId?: string,
): string {
  return `${threadId}::${agentSlug}::${projectId ?? ''}`;
}

/** Whether a prewarm for `key` is still within the dedup TTL of the last one —
 *  i.e. should be SKIPPED. Pure, so the dedup/TTL logic is unit-testable. */
export function isPrewarmDeduped(
  last: PrewarmRecord | null,
  key: string,
  now: number,
  ttlMs: number = PREWARM_TTL_MS,
): boolean {
  return last !== null && last.key === key && now - last.at < ttlMs;
}

interface PrewarmParams {
  threadId: string | undefined;
  organizationId: string;
  agentSlug: string | undefined;
  projectId?: string;
}

/**
 * Pre-warm the prompt cache so a user's NEXT message is served warm.
 *
 * Fired when the composer becomes active (focus/typing). It runs the real
 * generation pipeline in `prewarm` mode — building the exact same tools +
 * stable system prefix the next turn will send — and issues one throwaway
 * 1-token generation to prime the provider's prompt cache. No message is saved,
 * no spinner shows; it's entirely invisible and best-effort.
 *
 * Deduped per (thread, agent, project) within a TTL just under Anthropic's
 * ~5-min ephemeral cache window, so focusing/typing repeatedly fires at most
 * one priming call per warm period. Requires an existing `threadId` — a
 * brand-new chat has no thread to prime against until its first message.
 */
export function usePrewarmChatCache({
  threadId,
  organizationId,
  agentSlug,
  projectId,
}: PrewarmParams): () => void {
  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();
  const lastRef = useRef<PrewarmRecord | null>(null);

  return useCallback(() => {
    if (!threadId || !agentSlug) return;
    const key = prewarmKey(threadId, agentSlug, projectId);
    const now = Date.now();
    if (isPrewarmDeduped(lastRef.current, key, now)) return;
    lastRef.current = { key, at: now };
    void chatWithAgent({
      agentSlug,
      threadId,
      organizationId,
      message: '',
      prewarm: true,
      ...(projectId ? { projectId: asProjectId(projectId) } : {}),
    }).catch((err: unknown) => {
      // Best-effort: a failed prime must never disrupt the composer.
      console.debug('[prewarm] priming call ignored', err);
    });
  }, [chatWithAgent, threadId, organizationId, agentSlug, projectId]);
}
