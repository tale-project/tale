import { Avatar } from '@tale/ui/avatar';

import { useT } from '@/lib/i18n/client';

import type { TaskCreatorType } from '../lib/display';

/**
 * Assignee indicator, drawn by the shared `Avatar`: an agent shows a Bot
 * glyph, an automation (`app`) a Workflow glyph, an unassigned slot a dashed
 * User outline. A person shows their initials in the tint their name hashes
 * to — the same colour as in a conversation or a contact list — when a
 * resolved `name` is passed (via {@link useActorDirectory}), else a User
 * glyph. The accessible name prefers the resolved name over the raw id.
 *
 * When `isCurrentUser` is set for a person, the chip uses the filled primary
 * surface so "assigned to me" is glanceable (agents keep the soft primary
 * tint).
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
  /** 20px (`sm`) or 28px (`md`). */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useT('tasks');
  const avatarSize = size === 'md' ? 'md' : 'xs';

  if (!assigneeType || !assigneeId) {
    return (
      <Avatar
        kind="unassigned"
        size={avatarSize}
        label={t('assignee.unassigned')}
        className={className}
      />
    );
  }

  const label = name ?? assigneeId;
  if (assigneeType === 'agent' || assigneeType === 'app') {
    return (
      <Avatar
        kind={assigneeType === 'agent' ? 'agent' : 'automation'}
        size={avatarSize}
        label={label}
        className={className}
      />
    );
  }
  return (
    <Avatar
      kind="person"
      size={avatarSize}
      label={label}
      {...(name !== undefined ? { name } : {})}
      {...(isCurrentUser ? { tone: 'strong' as const } : {})}
      className={className}
    />
  );
}
