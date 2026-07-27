'use client';

/**
 * One thread of the sub-panel, and its actions menu.
 *
 * The row says what the thread is at a glance — sandbox marker, title, pin
 * glyph, unread dot, live "generating" label or a quiet relative age — and
 * carries ONE trailing control: the More-actions menu (pin, rename, move to
 * project, archive, share; Delete arrives with the trash flow). Rename swaps
 * the title for an inline input on the spot, no dialog and no click-timer.
 *
 * Rows render entirely from their `thread` summary plus the shared list
 * frame — no per-row subscriptions, so a hundred rows cost one list query.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Boxes,
  FolderInput,
  FolderMinus,
  Link2,
  Link2Off,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from 'lucide-react';
import { useRef, useState } from 'react';

import {
  SUB_PANEL_ROW_CLASS,
  useSubPanelRowTreatment,
} from '@/app/components/layout/sub-panel-list';
import { useCopy } from '@/app/hooks/use-copy';
import { useRelativeNow } from '@/app/hooks/use-relative-now';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useThreadProjectMove } from '../data/chat-backend';
import { useThreadActions } from '../data/thread-actions';
import { useThreadSharing } from '../data/thread-sharing';
import type { ChatThreadSummary } from '../types';
import { useThreadDraggable } from './thread-dnd';
import { useThreadListFrame } from './thread-list-context';

interface ThreadRowProps {
  thread: ChatThreadSummary;
  /** Archived rows offer Unarchive instead of the full action set. */
  variant?: 'default' | 'archived';
}

export function ThreadRow({ thread, variant = 'default' }: ThreadRowProps) {
  const { t } = useT('chat');
  const { organizationId, activeThreadId } = useThreadListFrame();
  const active = thread.id === activeThreadId;
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, listeners, isDragging } = useThreadDraggable({
    id: thread.id,
    projectId: thread.projectId ?? null,
    title: thread.title ?? t('history.untitled'),
  });
  const treatment = useSubPanelRowTreatment(active && !isDragging);

  const hasNewResponse =
    !active &&
    !thread.generating &&
    thread.lastReplyAt !== undefined &&
    thread.lastReplyAt > (thread.lastReadAt ?? 0);
  // The age of the newest activity; hidden while a turn streams (the
  // generating label takes the slot) and while renaming.
  const age = useRelativeNow(thread.lastReplyAt ?? thread.createdAt, {
    paused: thread.generating,
  });

  return (
    <li
      ref={setNodeRef}
      {...(renaming ? {} : listeners)}
      data-thread-id={thread.id}
      className={cn(
        'group relative flex items-center rounded-md',
        // The lifted copy travels in the drag overlay; the source row stays
        // behind as a faded placeholder so it is never read as the active row.
        isDragging && 'opacity-40',
      )}
    >
      {renaming ? (
        <ThreadRenameInput
          thread={thread}
          organizationId={organizationId}
          onDone={() => setRenaming(false)}
        />
      ) : (
        <Link
          to="/dashboard/$id/chat/$threadId"
          params={{ id: organizationId, threadId: thread.id }}
          aria-current={active ? 'page' : undefined}
          className={cn(
            SUB_PANEL_ROW_CLASS,
            'min-w-0 flex-1 gap-1.5',
            treatment.className,
          )}
          {...(treatment.style !== undefined ? { style: treatment.style } : {})}
        >
          {thread.kind === 'sandbox' && (
            <Boxes
              aria-label={t('sandbox.label')}
              className="size-3.5 shrink-0"
            />
          )}
          {thread.pinnedAt !== undefined && (
            <Pin
              aria-label={t('pinned')}
              className="text-muted-foreground size-3 shrink-0"
            />
          )}
          <span className="truncate leading-snug">
            {thread.title ?? t('history.untitled')}
          </span>
          {hasNewResponse && (
            <span
              role="status"
              aria-label={t('newResponse')}
              className="bg-primary size-1.5 shrink-0 rounded-full"
            />
          )}
          {thread.generating ? (
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {t('history.generating')}
            </span>
          ) : (
            age !== null && (
              // Hides on hover (desktop) — the actions menu lands on this
              // edge and the age would show through it.
              <span className="text-muted-foreground/70 ml-auto shrink-0 text-xs tabular-nums md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0">
                {age}
              </span>
            )
          )}
        </Link>
      )}
      {/* On desktop the menu is an absolute overlay so it reserves no
          horizontal space until hover — the title gets the full width. On
          touch it stays in-flow and always visible. */}
      {!renaming && (
        <div className="bg-background/80 z-10 shrink-0 rounded-md opacity-100 backdrop-blur-sm transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
          <ThreadRowMenu
            thread={thread}
            variant={variant}
            active={active}
            onStartRename={() => setRenaming(true)}
          />
        </div>
      )}
    </li>
  );
}

/** The in-place rename field — Enter commits, Escape cancels, blur commits. */
function ThreadRenameInput({
  thread,
  organizationId,
  onDone,
}: {
  thread: ChatThreadSummary;
  organizationId: string;
  onDone: () => void;
}) {
  const { t } = useT('chat');
  const actions = useThreadActions(organizationId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Committed once, whether Enter or blur lands first.
  const settledRef = useRef(false);

  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = inputRef.current?.value.trim() ?? '';
    onDone();
    if (next.length === 0 || next === (thread.title ?? '')) return;
    if (!(await actions.rename(thread.id, next))) {
      toast({
        title: t('history.toast.renameFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <input
      ref={inputRef}
      defaultValue={thread.title ?? ''}
      aria-label={t('history.renameChat')}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          settledRef.current = true;
          onDone();
        }
      }}
      className={cn(
        SUB_PANEL_ROW_CLASS,
        'border-border bg-background min-w-0 flex-1 rounded-md border outline-none',
      )}
    />
  );
}

/** The row's More-actions menu. */
function ThreadRowMenu({
  thread,
  variant,
  active,
  onStartRename,
}: {
  thread: ChatThreadSummary;
  variant: 'default' | 'archived';
  active: boolean;
  onStartRename: () => void;
}) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const { organizationId, projects } = useThreadListFrame();
  const actions = useThreadActions(organizationId);
  const sharing = useThreadSharing(organizationId);
  const projectMove = useThreadProjectMove(organizationId);
  const { copy } = useCopy();

  const leaveIfActive = () => {
    if (!active) return;
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  };

  const handleTogglePin = () => {
    void actions
      .setPinned(thread.id, thread.pinnedAt === undefined)
      .then((ok) => {
        if (!ok) toast({ title: t('pinFailed'), variant: 'destructive' });
      });
  };

  const handleSetArchived = (archived: boolean) => {
    void actions.setArchived(thread.id, archived).then((ok) => {
      if (!ok) {
        toast({
          title: t(archived ? 'archiveFailed' : 'unarchiveFailed'),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: t(archived ? 'archiveSuccess' : 'unarchiveSuccess') });
      if (archived) leaveIfActive();
    });
  };

  const handleMoveToProject = (projectId: string | null) => {
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

  const items: DropdownMenuGroup[] =
    variant === 'archived'
      ? [
          [
            {
              type: 'item',
              label: t('unarchive'),
              icon: ArchiveRestore,
              onClick: () => handleSetArchived(false),
            },
          ],
        ]
      : [
          [
            {
              type: 'item',
              label:
                thread.pinnedAt === undefined ? t('pinChat') : t('unpinChat'),
              icon: thread.pinnedAt === undefined ? Pin : PinOff,
              onClick: handleTogglePin,
            },
            {
              type: 'item',
              label: t('history.renameChat'),
              icon: Pencil,
              onClick: onStartRename,
            },
            {
              type: 'sub',
              label: t('moveToProject'),
              icon: FolderInput,
              items: [
                [
                  ...projects.map((project) => ({
                    type: 'item' as const,
                    label: project.name,
                    selected: project.id === thread.projectId,
                    onClick: () => handleMoveToProject(project.id),
                  })),
                  ...(thread.projectId !== undefined
                    ? [
                        {
                          type: 'item' as const,
                          label: t('removeFromProject'),
                          icon: FolderMinus,
                          onClick: () => handleMoveToProject(null),
                        },
                      ]
                    : []),
                ],
              ],
            },
            {
              type: 'item',
              label: t('archive'),
              icon: Archive,
              onClick: () => handleSetArchived(true),
            },
          ],
          [
            {
              type: 'item',
              label: t('share.button'),
              icon: Link2,
              onClick: () => void shareAndCopyLink(),
            },
            ...(thread.isShared
              ? [
                  {
                    type: 'item' as const,
                    label: t('share.unshare'),
                    icon: Link2Off,
                    onClick: () => void stopSharing(),
                  },
                ]
              : []),
          ],
        ];

  return (
    <DropdownMenu
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-6 p-1"
          aria-label={t('moreActions')}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      }
      items={items}
      disabled={!actions.available}
    />
  );
}
