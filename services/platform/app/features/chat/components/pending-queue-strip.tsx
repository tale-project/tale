'use client';

import { m, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

export interface PendingQueueItem {
  queueId: Id<'chatMessageQueue'>;
  /** Only `queued` rows can be removed; `delivered` is already on its way. */
  status: 'queued' | 'delivered';
  text: string;
}

interface PendingQueueStripProps {
  /** Still-waiting follow-ups, in send order. */
  items: PendingQueueItem[];
  onRemove: (queueId: Id<'chatMessageQueue'>) => void;
}

/**
 * Follow-up messages the user typed while an external-agent (Claude Code) turn
 * is running. They are steered into the running turn / drained at the next
 * boundary, so until the agent picks them up they wait HERE — above the
 * composer — rather than landing inline in the conversation (which would show a
 * misleading second "Thinking" timer against the running turn's clock).
 */
export function PendingQueueStrip({ items, onRemove }: PendingQueueStripProps) {
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();

  if (items.length === 0) return null;

  return (
    <div className="border-border bg-muted/50 mb-2 rounded-lg border px-3 py-2">
      <div className="text-muted-foreground mb-1.5 text-xs font-medium">
        {t('queue.pendingCount', { count: items.length })}
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <m.li
              key={item.queueId}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }
              }
              transition={{
                duration: prefersReducedMotion ? 0 : 0.18,
                ease: [0.25, 0.1, 0.25, 1],
              }}
              className="flex items-center gap-2 text-sm"
            >
              <span className="text-foreground line-clamp-2 min-w-0 flex-1 break-words">
                {item.text}
              </span>
              {item.status === 'queued' ? (
                <button
                  type="button"
                  onClick={() => onRemove(item.queueId)}
                  aria-label={t('queue.deleteQueued')}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t('queue.badgeDelivered')}
                </span>
              )}
            </m.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
