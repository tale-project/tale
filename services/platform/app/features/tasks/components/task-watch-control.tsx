'use client';

import { Button } from '@tale/ui/button';
import { Eye, EyeOff } from 'lucide-react';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useSetTaskMuted, useSubscribeToTask } from '../hooks/mutations';
import { useTaskSubscription } from '../hooks/queries';

/**
 * ONE switch for "do I hear about this task".
 *
 * Being notified is otherwise implicit — you get a task's comments and status
 * because you created it, own it, commented on it, were mentioned, or review it.
 * That covers the common cases and nothing else: no way to watch a task you
 * merely care about, and no way to quiet a noisy one short of muting a whole
 * category in Settings.
 *
 * Unwatch MUTES rather than unsubscribes, deliberately. Deleting the
 * subscription would look identical and then quietly undo itself: `autoSubscribe`
 * re-creates a row the next time you comment, get mentioned, get assigned or are
 * made reviewer, so the task starts talking again with no action from you. A
 * muted row survives all of that (`autoSubscribe` returns early when a row
 * exists, and `taskSubscriberUserIds` skips muted rows), so "unwatch" means what
 * it says. Watching again clears the mute — `subscribeToTask` unmutes an existing
 * row.
 *
 * Directed notifications are NOT affected either way: a mention, an assignment
 * or a review request still reaches you. Unwatch silences the ambient fan-out,
 * not the things addressed to you.
 */
export function TaskWatchControl({ taskId }: { taskId: Id<'tasks'> }) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { subscribed, muted } = useTaskSubscription(taskId);
  const subscribe = useSubscribeToTask();
  const setMuted = useSetTaskMuted();
  const watching = subscribed && !muted;
  const busy = subscribe.isPending || setMuted.isPending;

  return (
    // A panel ACTION, sitting with Archive rather than among the read-only
    // properties: same secondary full-width button, same verb-first label.
    // `shrink-0` for the same reason Archive needs it — the panel is a
    // height-constrained flex column, and a fixed-height control compresses to
    // its one-line min-content without it.
    <Button
      variant="secondary"
      size="sm"
      className="w-full shrink-0"
      icon={watching ? EyeOff : Eye}
      disabled={busy}
      onClick={() =>
        void (async () => {
          try {
            await (watching
              ? setMuted.mutateAsync({ taskId, muted: true })
              : subscribe.mutateAsync({ taskId }));
          } catch (error) {
            console.error('[tasks] watch toggle failed', error);
            toast({ title: tCommon('errors.generic'), variant: 'destructive' });
          }
        })()
      }
    >
      {watching ? t('watch.unwatch') : t('watch.watch')}
    </Button>
  );
}
