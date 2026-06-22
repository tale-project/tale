'use client';

import { IconButton } from '@tale/ui/icon-button';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { NotificationTarget } from '../lib/notification-target';

interface NotificationRowProps {
  /** Pre-localized title (each stream resolves its own i18n namespace). */
  title: string;
  /** Pre-localized body. */
  body: string;
  createdAt: number;
  read: boolean;
  /** Body deep-link target, or `null` when the row has no destination. */
  target: NotificationTarget | null;
  /**
   * Invoked when the body is activated (clicked). Marks the row read and, when
   * a `target` exists, closes the host popover. Navigation itself is handled by
   * the `<Link>` — this is the side-effect hook.
   */
  onActivate: () => void;
  /** Marks the row read WITHOUT navigating — the trailing icon button. */
  onMarkRead: () => void;
  markReadPending: boolean;
  /** Extra content rendered below the body (e.g. `<ReviewActions />`). */
  children?: ReactNode;
}

/**
 * A single notification row shared by both streams (org alerts + personal). The
 * body is a deep-link (`<Link>`) when a `target` exists, otherwise a plain
 * dismiss button (unread) or inert text (read). The trailing "mark as read"
 * icon button is a sibling of the body — never nested — so there is no
 * interactive-element nesting.
 */
export function NotificationRow({
  title,
  body,
  createdAt,
  read,
  target,
  onActivate,
  onMarkRead,
  markReadPending,
  children,
}: NotificationRowProps) {
  const { t } = useT('notifications');
  const { formatRelative, formatDate } = useFormatDate();

  // Clickable when it can navigate (has a target) or when it's unread (a
  // body-click dismisses it — preserves the pre-existing behavior for rows
  // without a destination).
  const interactive = target !== null || !read;

  const bodyClasses = cn(
    'flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors',
    interactive ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default',
    read && target === null && 'opacity-70',
  );

  const inner = (
    <>
      {!read && <span className="sr-only">{t('ariaUnread')}</span>}
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          read ? 'bg-transparent' : 'bg-sky-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-foreground text-sm font-medium">{title}</div>
          <span
            className="text-muted-foreground shrink-0 text-[10px]"
            title={formatDate(new Date(createdAt), 'long')}
          >
            {formatRelative(new Date(createdAt))}
          </span>
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs whitespace-pre-wrap">
          {body}
        </div>
      </div>
    </>
  );

  return (
    <li className={cn(!read && 'bg-accent/10')}>
      <div className="flex items-start">
        {target ? (
          <Link {...target} onClick={onActivate} className={bodyClasses}>
            {inner}
          </Link>
        ) : read ? (
          <div className={bodyClasses}>{inner}</div>
        ) : (
          <button type="button" onClick={onActivate} className={bodyClasses}>
            {inner}
          </button>
        )}
        {!read && (
          <IconButton
            icon={Check}
            aria-label={t('markAsRead')}
            iconSize={4}
            disabled={markReadPending}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onMarkRead();
            }}
            className="mt-2 mr-2 shrink-0"
          />
        )}
      </div>
      {children}
    </li>
  );
}
