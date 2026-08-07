import { Bot, User, Workflow } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { TaskCreatorType } from '../lib/display';

/** Two-letter initials from a display name (or the local part of an email). */
function initialsOf(name: string): string {
  const trimmed = name.trim();
  const local = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

/**
 * Assignee indicator. An agent shows a Bot glyph, an automation (`app`) a
 * Workflow glyph; an unassigned slot a dashed User outline. A human shows
 * their initials when a resolved `name` is passed (via
 * {@link useActorDirectory}), else a User glyph. The tooltip prefers the
 * resolved name over the raw id.
 *
 * When `isCurrentUser` is set for a human assignee, the chip uses the filled
 * primary surface so "assigned to me" is glanceable and does not share the
 * muted chip that every other human uses (agents keep the soft primary tint).
 */
export function AssigneeAvatar({
  assigneeType,
  assigneeId,
  name,
  isCurrentUser = false,
  size = 'sm',
  className,
}: {
  assigneeType?: TaskCreatorType;
  assigneeId?: string;
  /** Resolved display name; enables initials + a human-readable tooltip. */
  name?: string;
  /** True when this avatar is the signed-in viewer (self-assign / "you"). */
  isCurrentUser?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useT('tasks');
  const dimension = size === 'md' ? 'size-7' : 'size-5';
  const iconSize = size === 'md' ? 'size-4' : 'size-3';

  if (!assigneeType || !assigneeId) {
    return (
      <span
        className={cn(
          dimension,
          'border-border text-muted-foreground inline-flex items-center justify-center rounded-full border border-dashed',
          className,
        )}
        aria-label={t('assignee.unassigned')}
        title={t('assignee.unassigned')}
      >
        <User className={iconSize} aria-hidden="true" />
      </span>
    );
  }

  const label = name ?? assigneeId;
  const isAgent = assigneeType === 'agent';
  const isApp = assigneeType === 'app';
  const surface =
    isAgent || isApp
      ? 'bg-primary/10 text-primary'
      : isCurrentUser
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-foreground';

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        dimension,
        'inline-flex items-center justify-center rounded-full',
        surface,
        className,
      )}
    >
      {isApp ? (
        <Workflow className={iconSize} aria-hidden="true" />
      ) : isAgent ? (
        <Bot className={iconSize} aria-hidden="true" />
      ) : name ? (
        <span
          className={cn(
            'font-medium',
            size === 'md' ? 'text-[0.65rem]' : 'text-[0.5rem]',
          )}
          aria-hidden="true"
        >
          {initialsOf(name)}
        </span>
      ) : (
        <User className={iconSize} aria-hidden="true" />
      )}
    </span>
  );
}
