import { Avatar } from '@tale/ui/avatar';

import { useT } from '@/lib/i18n/client';

import type { ActorStanding } from '../hooks/use-actor-directory';
import type { TaskCreatorType } from '../lib/display';

/**
 * Assignee indicator, drawn by the shared `Avatar`: an agent shows a Bot
 * glyph, an automation (`app`) a Workflow glyph, an unassigned slot a dashed
 * User outline. A person shows their initials in the tint their name hashes
 * to — the same colour as in a conversation or a contact list — when a
 * resolved `name` is passed (via {@link useActorDirectory}), else a User
 * glyph. The accessible name is that resolved name, never the raw id, which
 * tells a reader nothing: without a name yet the avatar is decorative, and a
 * former member keeps the User glyph under their label rather than initials
 * of nobody.
 *
 * When `isCurrentUser` is set for a person, the chip uses the filled primary
 * surface so "assigned to me" is glanceable (agents keep the soft primary
 * tint).
 */
export function AssigneeAvatar({
  assigneeType,
  assigneeId,
  name,
  standing,
  isCurrentUser = false,
  size = 'sm',
  className,
}: {
  assigneeType?: TaskCreatorType;
  assigneeId?: string;
  /** Resolved display name; enables initials + a human-readable tooltip. */
  name?: string;
  /** The resolved actor's `standing`: set for a person the directory does
   * not name. */
  standing?: ActorStanding;
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

  const label = name !== undefined && name !== '' ? name : undefined;
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
      {...(label !== undefined && standing === undefined
        ? { name: label }
        : {})}
      {...(isCurrentUser ? { tone: 'strong' as const } : {})}
      className={className}
    />
  );
}
