'use client';

/**
 * The thread actions shared by the sidebar row menu and the conversation
 * header menu — one set of toast-wrapped handlers and one Move-to-project
 * submenu builder, so the two surfaces cannot drift apart (the 0.3 doctrine:
 * "header and sidebar never drift").
 *
 * Arrangement stays per-surface: the row adds rename/mark-unread (inline
 * affordances the header has no seat for), the header adds share/export.
 */

import { type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import type { TFunction } from 'i18next';
import { FolderInput } from 'lucide-react';

import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { useCopy } from '@/app/hooks/use-copy';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { PickerSearchList } from '../components/picker-search-list';
import { useThreadProjectMove } from '../data/chat-backend';
import { useThreadActions } from '../data/thread-actions';
import { useThreadSharing } from '../data/thread-sharing';
import type { ChatProjectSummary, ChatThreadSummary } from '../types';

export interface ThreadMenuActions {
  readonly available: boolean;
  readonly togglePin: () => void;
  /** Archive/unarchive with the outcome toasts; `onArchived` runs after a
   * successful archive (the row leaves an active thread, the header stays —
   * its banner takes over). */
  readonly setArchived: (archived: boolean, onArchived?: () => void) => void;
  readonly moveToProject: (projectId: string | null) => void;
  /** Publish (or refresh) the snapshot link and copy it in one gesture. */
  readonly shareAndCopyLink: () => Promise<void>;
  readonly stopSharing: () => Promise<void>;
}

export function useThreadMenuActions(
  organizationId: string,
  thread: Pick<ChatThreadSummary, 'id' | 'pinnedAt'>,
): ThreadMenuActions {
  const { t } = useT('chat');
  const actions = useThreadActions(organizationId);
  const sharing = useThreadSharing(organizationId);
  const projectMove = useThreadProjectMove(organizationId);
  const { copy } = useCopy();

  const togglePin = () => {
    void actions
      .setPinned(thread.id, thread.pinnedAt === undefined)
      .then((ok) => {
        if (!ok) toast({ title: t('pinFailed'), variant: 'destructive' });
      });
  };

  const setArchived = (archived: boolean, onArchived?: () => void) => {
    void actions.setArchived(thread.id, archived).then((ok) => {
      if (!ok) {
        toast({
          title: t(archived ? 'archiveFailed' : 'unarchiveFailed'),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: t(archived ? 'archiveSuccess' : 'unarchiveSuccess') });
      if (archived) onArchived?.();
    });
  };

  const moveToProject = (projectId: string | null) => {
    const notifyFailure = () =>
      toast({
        title: t(
          projectId === null
            ? 'removeFromProjectFailed'
            : 'history.toast.moveFailed',
        ),
        variant: 'destructive',
      });
    void projectMove
      .move(thread.id, projectId)
      .then((ok) => {
        if (!ok) notifyFailure();
      })
      .catch((error: unknown) => {
        console.error('[chat] moving the thread failed', error);
        notifyFailure();
      });
  };

  const shareAndCopyLink = async () => {
    const shareToken = await sharing.share(thread.id);
    if (!shareToken) {
      toast({ title: t('share.shareFailed'), variant: 'destructive' });
      return;
    }
    const url = `${window.location.origin}/dashboard/${organizationId}/chat/shared/${shareToken}`;
    // `copy` raises its own failure toast; the link is live either way.
    if (await copy(url)) {
      toast({ title: t('share.copied') });
    }
  };

  const stopSharing = async () => {
    if (await sharing.unshare(thread.id)) {
      toast({ title: t('share.unshared') });
    } else {
      toast({ title: t('share.unshareFailed'), variant: 'destructive' });
    }
  };

  return {
    available: actions.available,
    togglePin,
    setArchived,
    moveToProject,
    shareAndCopyLink,
    stopSharing,
  };
}

/** The searchable Move-to-project submenu entry, identical in both menus:
 * pick a folder, or remove from the current one. Scrolls past four folders
 * so a big workspace never overflows it. The current folder shows as the
 * submenu's selected row — no trailing hint on the entry (dropped on main
 * as redundant). */
export function moveToProjectMenuItem({
  t,
  projects,
  currentProjectId,
  onMove,
}: {
  t: TFunction;
  projects: readonly ChatProjectSummary[];
  currentProjectId: string | undefined;
  onMove: (projectId: string | null) => void;
}): DropdownMenuGroup[number] {
  return {
    type: 'sub' as const,
    label: t('moveToProject'),
    icon: FolderInput,
    contentClassName: 'min-w-56',
    items: [
      [
        {
          type: 'custom' as const,
          content: (
            <PickerSearchList
              options={[
                ...projects.map((project) => ({
                  key: project.id,
                  search: project.name,
                  label: (
                    <span className="flex min-w-0 items-center gap-2">
                      <ProjectAvatar
                        name={project.name}
                        icon={project.icon}
                        color={project.color}
                        size={16}
                        variant="plain"
                      />
                      <span className="truncate">{project.name}</span>
                    </span>
                  ),
                  selected: project.id === currentProjectId,
                  onSelect: () => onMove(project.id),
                })),
                ...(currentProjectId !== undefined
                  ? [
                      {
                        key: '__none__',
                        search: t('removeFromProject'),
                        label: t('removeFromProject'),
                        onSelect: () => onMove(null),
                      },
                    ]
                  : []),
              ]}
              emptyHint={t('history.noProjects')}
            />
          ),
        },
      ],
    ],
  };
}
