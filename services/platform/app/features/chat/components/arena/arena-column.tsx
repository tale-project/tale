'use client';

/**
 * One column of the arena split view: its own conversation, streaming
 * through the ordinary message/generation watches. Exactly two extra
 * subscriptions per column — the composer, catalog, and thread list stay
 * single-instance on the surface.
 *
 * The transcript is deliberately action-less (no edit, regenerate, fork, or
 * feedback): during a comparison the VERDICT is the feedback, and mutating
 * one column would desynchronize the pair.
 */

import { Text } from '@tale/ui/text';
import { memo, type ReactNode } from 'react';

import { useThreadView } from '../../hooks/use-thread-view';
import { MessageThread } from '../message-thread';

interface ArenaColumnProps {
  organizationId: string;
  threadId: string;
  /** The column's heading ("Model A" / "Model B"). */
  label: string;
  /** The model identity line, or the column's own picker (column B). */
  headerExtra?: ReactNode;
}

export const ArenaColumn = memo(function ArenaColumn({
  organizationId,
  threadId,
  label,
  headerExtra,
}: ArenaColumnProps) {
  const view = useThreadView(organizationId, threadId);

  return (
    <section
      aria-label={label}
      data-testid="arena-column"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Text variant="muted" className="text-xs font-medium tracking-wide">
          {label}
        </Text>
        {headerExtra}
      </div>
      <MessageThread
        messages={view.items}
        generation={view.generation ?? undefined}
        organizationId={organizationId}
        threadId={threadId}
      />
    </section>
  );
});
