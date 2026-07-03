'use client';

import { Button } from '@tale/ui/button';
import { Clock, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDeleteQueuedMessage } from '../hooks/mutations';
import { useSessionProgress } from '../hooks/queries';

/** An optimistic entry for a message whose enqueue mutation is still in
 * flight — rendered exactly like a 'queued' row so the send never appears to
 * vanish, replaced by the server row when the mutation resolves. */
export interface PendingTrayEntry {
  key: string;
  text: string;
}

interface TrayEntry {
  key: string;
  queueId?: Id<'chatMessageQueue'>;
  text: string;
  status: 'queued' | 'claimed' | 'delivered';
  /** Entry left the waiting set (picked or removed) — kept briefly with a
   * fade-out so a fast pick reads as a deliberate move into the transcript,
   * not a flash. */
  ghost?: boolean;
}

/** How long a retiring entry stays visible while fading. Also the minimum
 * dwell for a message picked almost instantly — without it the entry would
 * flash for a frame and vanish. */
const GHOST_MS = 400;

/**
 * The queue tray: messages sent while an external-agent turn runs, waiting
 * between the transcript and the composer until the agent actually picks
 * them up (persist-at-pick — the transcript copy only exists after the
 * pick, so the tray is the ONLY place a waiting message renders). Entries
 * retire with a short fade when picked; still-queued ones can be removed.
 */
export function QueuedMessageTray({
  threadId,
  organizationId,
  pending,
}: {
  threadId: string;
  organizationId: string;
  pending: readonly PendingTrayEntry[];
}) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const prefersReducedMotion = usePrefersReducedMotion();
  const { data: rows } = useConvexQuery(
    api.threads.message_queue.listQueuedMessages,
    { threadId, organizationId },
  );
  const progress = useSessionProgress(threadId);
  const agentLingering = progress?.agentIdleAt != null;
  const { mutate: deleteQueued } = useDeleteQueuedMessage();

  // Waiting = not yet picked. Consumed rows have a transcript bubble now —
  // they leave the tray (via the ghost fade below). Claimed rows are being
  // drained into the next turn; their bubbles are saved, so they leave too.
  const live = useMemo<TrayEntry[]>(() => {
    const fromServer = (rows ?? []).flatMap<TrayEntry>((r) =>
      r.status === 'queued' || r.status === 'delivered'
        ? [
            {
              key: r.queueId,
              queueId: r.queueId,
              text: r.text,
              status: r.status,
            },
          ]
        : [],
    );
    // Optimistic entries whose server row hasn't landed yet (dedup: the
    // mutation resolving removes the pending entry in the same commit the
    // row appears, but a slow subscription must not double-render).
    const fromPending = pending.map((p) => ({
      key: p.key,
      text: p.text,
      status: 'queued' as const,
    }));
    return [...fromServer, ...fromPending];
  }, [rows, pending]);

  // Ghost machinery: entries that just left the waiting set stay for
  // GHOST_MS with a fade-out (same key → the DOM node transitions in place).
  const [ghosts, setGhosts] = useState<ReadonlyMap<string, TrayEntry>>(
    new Map(),
  );
  const prevLiveRef = useRef<ReadonlyMap<string, TrayEntry>>(new Map());
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const current = new Map(live.map((e) => [e.key, e]));
    const leaving = [...prevLiveRef.current.values()].filter(
      (e) => !current.has(e.key),
    );
    prevLiveRef.current = current;
    if (leaving.length === 0 || prefersReducedMotion) return;
    setGhosts((prev) => {
      const next = new Map(prev);
      for (const e of leaving) next.set(e.key, { ...e, ghost: true });
      return next;
    });
    const keys = leaving.map((e) => e.key);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setGhosts((prev) => {
        const next = new Map(prev);
        for (const key of keys) next.delete(key);
        return next;
      });
    }, GHOST_MS);
    timersRef.current.add(timer);
  }, [live, prefersReducedMotion]);
  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
    },
    [],
  );

  const entries = useMemo<TrayEntry[]>(() => {
    const liveKeys = new Set(live.map((e) => e.key));
    return [
      ...live,
      ...[...ghosts.values()].filter((g) => !liveKeys.has(g.key)),
    ];
  }, [live, ghosts]);

  if (entries.length === 0) return null;

  return (
    <ul
      aria-label={t('queue.tray.label')}
      className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-1 pb-2"
    >
      {entries.map((entry) => {
        const statusText = entry.ghost
          ? t('queue.status.consumed')
          : entry.status === 'delivered'
            ? t('queue.status.delivered')
            : agentLingering
              ? t('queue.status.deliversNow')
              : t('queue.status.queued');
        const queueId = entry.queueId;
        return (
          <li
            key={entry.key}
            className={cn(
              'border-border bg-muted/40 text-foreground flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm',
              'animate-in fade-in-0 slide-in-from-bottom-1 transition-opacity duration-300',
              entry.ghost && 'opacity-0',
            )}
          >
            <Clock
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{entry.text}</span>
            <span className="text-muted-foreground shrink-0 text-xs italic">
              {statusText}
            </span>
            {!entry.ghost && entry.status === 'queued' && queueId && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                aria-label={t('queue.tray.remove')}
                onClick={() =>
                  deleteQueued(
                    { queueId },
                    {
                      onError: (err: unknown) => {
                        console.warn('[queue-tray] delete failed', err);
                        toast({
                          title: t('queue.tray.removeFailed'),
                          variant: 'destructive',
                        });
                      },
                    },
                  )
                }
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
