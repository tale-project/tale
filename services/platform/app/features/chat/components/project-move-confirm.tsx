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

import type { ChatProjectSummary } from '../types';

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
  projects,
  onConfirm,
  onCancel,
}: {
  pending: PendingProjectMove | null;
  projects: readonly ChatProjectSummary[];
  onConfirm: (move: PendingProjectMove) => void;
  onCancel: () => void;
}) {
  const { t } = useT('chat');
  if (pending === null) return null;
  const nameOf = (projectId: string): string =>
    projects.find((project) => project.id === projectId)?.name ??
    t('moveShared.thisProject');
  const from = nameOf(pending.fromProjectId);
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
              to:
                pending.toProjectId === null ? '' : nameOf(pending.toProjectId),
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
