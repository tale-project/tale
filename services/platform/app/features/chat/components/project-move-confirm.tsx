'use client';

/**
 * The question a move asks before it ends a project share.
 *
 * A chat shared with its project is readable by everyone who can open that
 * project. Moving it to another project, or out of projects, ends the share
 * (the owner shares it again where they want it read), so the people of
 * the project it leaves lose it. Every way of moving a chat — the composer's
 * project control, the header and row menus, a drag onto a project — asks
 * this first when the move would end a share, and moves at once otherwise.
 */

import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';

import { useT } from '@/lib/i18n/client';

import { useChatProject } from '../data/chat-backend';

/** A move waiting for its answer: the project it leaves, where it goes. */
export interface PendingProjectMove {
  readonly fromProjectId: string;
  readonly toProjectId: string | null;
}

/** Whether moving a chat filed under `thread.projectId` to `projectId` ends
 * its project share. */
export function moveEndsShare(
  thread: { projectId?: string | null; sharedWithProject?: boolean },
  projectId: string | null,
): boolean {
  return (
    thread.sharedWithProject === true &&
    typeof thread.projectId === 'string' &&
    thread.projectId !== projectId
  );
}

export function ProjectMoveConfirmDialog({
  pending,
  organizationId,
  onConfirm,
  onCancel,
}: {
  pending: PendingProjectMove | null;
  organizationId: string;
  onConfirm: (move: PendingProjectMove) => void;
  onCancel: () => void;
}) {
  const { t } = useT('chat');
  // Both projects are read by id, never every project (#5194).
  const fromRead = useChatProject(organizationId, pending?.fromProjectId);
  const toRead = useChatProject(
    organizationId,
    pending?.toProjectId ?? undefined,
  );
  if (pending === null) return null;
  const nameOf = (read: typeof fromRead): string =>
    (read.status === 'ready' ? read.data?.name : undefined) ??
    t('moveShared.thisProject');
  const from = nameOf(fromRead);
  const removing = pending.toProjectId === null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t(removing ? 'moveShared.removeTitle' : 'moveShared.title')}
      description={
        removing
          ? t('moveShared.removeDescription', { from })
          : t('moveShared.description', {
              from,
              to: pending.toProjectId === null ? '' : nameOf(toRead),
            })
      }
      confirmText={t(
        removing ? 'moveShared.confirmRemove' : 'moveShared.confirm',
      )}
      variant="warning"
      onConfirm={() => onConfirm(pending)}
    />
  );
}
