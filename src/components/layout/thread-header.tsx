import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

export interface ThreadHeaderProps {
  /** A 32px identity mark: the item's glyph, a contact's initials. */
  leading?: ReactNode;
  /** The thread's name — a heading, or an in-place editor for it. */
  title: ReactNode;
  /** One quiet line of context under the title: where the thread lives,
   * who it is with, its state. */
  meta?: ReactNode;
  /** Controls at the start of the row, before the identity (a panel toggle,
   * a phone's back button). */
  before?: ReactNode;
  /** The thread's actions, trailing: its one or two verbs, then its menu. */
  actions?: ReactNode;
  /** Draw the header over scrolling content: no rule, and the page's
   * background fades out beneath it instead. */
  floating?: boolean;
  className?: string;
}

/**
 * The head of every conversation-shaped page — a chat, a customer
 * conversation, a task's discussion. The same `h-13` row as every page and
 * panel header, with the same anatomy everywhere: identity, title, one line of
 * context, then the actions. What differs between the kinds is only what fills
 * the slots, so moving between them never changes where to look.
 */
export function ThreadHeader({
  leading,
  title,
  meta,
  before,
  actions,
  floating = false,
  className,
}: ThreadHeaderProps) {
  return (
    <div
      className={cn(
        'relative flex h-13 shrink-0 items-center gap-3 px-4',
        !floating && 'border-border bg-background border-b',
        className,
      )}
    >
      {before}
      {leading !== undefined && (
        <span className="flex size-8 shrink-0 items-center justify-center">
          {leading}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="text-foreground min-w-0 truncate text-sm leading-5 font-semibold tracking-tight">
          {title}
        </div>
        {meta !== undefined && meta !== null && meta !== false && (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-4">
            {meta}
          </div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}

/** The thin dot between items of a header's context line. */
export function ThreadHeaderSeparator() {
  return (
    <span aria-hidden className="text-muted-foreground/60 shrink-0">
      ·
    </span>
  );
}
