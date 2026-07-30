'use client';

/**
 * One thread of the sub-panel, and its actions menu.
 *
 * The row says what the thread is at a glance — title, pin
 * glyph, unread dot, live "generating" label or a quiet relative age — and
 * carries ONE trailing control: the More-actions menu (pin, rename, move to
 * project, archive, share, delete). Rename swaps the title for an inline
 * input on the spot, no dialog and no click-timer; Delete confirms in a
 * dialog and moves the chat to Trash (restorable for the grace window).
 *
 * Rows render entirely from their `thread` summary plus the shared list
 * frame — held state included, which comes from the frame's ONE bulk holds
 * read — so a hundred rows cost one list query, never per-row subscriptions.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  CircleDot,
  Link2,
  Link2Off,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Swords,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';

import {
  SUB_PANEL_ROW_CLASS,
  useSubPanelRowTreatment,
} from '@/app/components/layout/sub-panel-list';
import { useRelativeNow } from '@/app/hooks/use-relative-now';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useThreadActions } from '../data/thread-actions';
import {
  moveToProjectMenuItem,
  useThreadMenuActions,
} from '../hooks/use-thread-menu-actions';
import type { ChatThreadSummary } from '../types';
import { LegalHoldIndicator } from './legal-hold-indicator';
import { ThreadDeleteDialog } from './thread-delete-dialog';
import { useThreadDraggable } from './thread-dnd';
import { useThreadListFrame } from './thread-list-context';

interface ThreadRowProps {
  thread: ChatThreadSummary;
  /** Archived rows offer Unarchive instead of the full action set. */
  variant?: 'default' | 'archived';
}

export function ThreadRow({ thread, variant = 'default' }: ThreadRowProps) {
  const { t } = useT('chat');
  const { organizationId, activeThreadId, orgHeld, heldThreadIds } =
    useThreadListFrame();
  const active = thread.id === activeThreadId;
  // The lock renders only for a hold on THIS thread — an org-wide hold on
  // every row would read as noise; the menu's disabled items carry it there.
  const threadHeld = !orgHeld && heldThreadIds.has(thread.id);
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, listeners, isDragging } = useThreadDraggable({
    id: thread.id,
    projectId: thread.projectId ?? null,
    title: thread.title ?? t('history.untitled'),
    archived: thread.archived,
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
          {/* The leading state dot: blue while a reply streams, green for a
              finished reply not yet read, nothing otherwise. */}
          {thread.generating ? (
            <span
              role="status"
              aria-label={t('history.generating')}
              className="bg-info size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
            />
          ) : hasNewResponse ? (
            <span
              role="status"
              aria-label={t('newResponse')}
              className="bg-success size-2 shrink-0 rounded-full"
            />
          ) : null}
          {thread.pinnedAt !== undefined && (
            <Pin
              aria-label={t('pinned')}
              className="text-muted-foreground size-3 shrink-0"
            />
          )}
          {thread.inArena === true && (
            <Swords
              aria-label={t('arena.label')}
              className="text-muted-foreground size-3 shrink-0"
            />
          )}
          {thread.isShared === true && (
            <Share2
              aria-label={t('share.sharedIndicator')}
              className="text-muted-foreground size-3 shrink-0"
            />
          )}
          {threadHeld && (
            <LegalHoldIndicator
              organizationId={organizationId}
              targetType="thread"
              targetId={thread.id}
            />
          )}
          <span className="truncate leading-snug">
            {thread.title ?? t('history.untitled')}
          </span>
          {age !== null && (
            // Hides on hover (desktop) — the actions menu lands on this edge
            // and the age would show through it. Absent while streaming (the
            // dot carries that state).
            <span className="text-muted-foreground/70 ml-auto shrink-0 text-xs tabular-nums md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0">
              {age}
            </span>
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
  const { t: tCommon } = useT('common');
  const { t: tGovernance } = useT('governance');
  const navigate = useNavigate();
  const { organizationId, projects, orgHeld, heldThreadIds } =
    useThreadListFrame();
  const menuActions = useThreadMenuActions(organizationId, thread);
  // Row-only actions (mark read) live outside the shared menu handlers.
  const actions = useThreadActions(organizationId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The server enforces every hold on the mutation; this only explains the
  // disabled destructive items up front.
  const held = orgHeld || heldThreadIds.has(thread.id);
  // Unread from the same watermark the row's dot reads — the menu offers the
  // opposite transition.
  const threadUnread =
    thread.lastReplyAt !== undefined &&
    thread.lastReplyAt > (thread.lastReadAt ?? 0);

  const leaveIfActive = () => {
    if (!active) return;
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  };

  /** The destructive tail every variant shares. The menu item carries the
   * generic "Delete" (the e2e contract); the dialog's confirm button carries
   * the specific "Delete chat". */
  const deleteGroup: DropdownMenuGroup = [
    {
      type: 'item',
      label: tCommon('actions.delete'),
      icon: Trash2,
      destructive: true,
      disabled: held,
      onClick: () => setDeleteOpen(true),
    },
  ];
  /** Explains the disabled destructive items while a hold covers the row. */
  const heldNotice: DropdownMenuGroup[] = held
    ? [
        [
          {
            type: 'label',
            content: tGovernance('legalHold.badges.blockedByHold'),
          },
        ],
      ]
    : [];

  const items: DropdownMenuGroup[] =
    variant === 'archived'
      ? [
          ...heldNotice,
          [
            {
              type: 'item',
              label: t('unarchive'),
              icon: ArchiveRestore,
              onClick: () => menuActions.setArchived(false),
            },
            ...deleteGroup,
          ],
        ]
      : [
          ...heldNotice,
          [
            {
              type: 'item',
              label:
                thread.pinnedAt === undefined ? t('pinChat') : t('unpinChat'),
              icon: thread.pinnedAt === undefined ? Pin : PinOff,
              onClick: menuActions.togglePin,
            },
            {
              type: 'item',
              label: threadUnread ? t('markAsRead') : t('markAsUnread'),
              icon: threadUnread ? CheckCheck : CircleDot,
              onClick: () => actions.markRead(thread.id, threadUnread),
            },
            {
              type: 'item',
              label: t('history.renameChat'),
              icon: Pencil,
              onClick: onStartRename,
            },
            // Two ways into a project: DRAG the chat onto the folder, or
            // pick one here — the shared submenu (also in the header menu).
            moveToProjectMenuItem({
              t,
              projects,
              currentProjectId: thread.projectId,
              onMove: menuActions.moveToProject,
            }),
          ],
          [
            {
              type: 'item',
              label: t('share.button'),
              icon: Link2,
              onClick: () => void menuActions.shareAndCopyLink(),
            },
            ...(thread.isShared
              ? [
                  {
                    type: 'item' as const,
                    label: t('share.unshare'),
                    icon: Link2Off,
                    onClick: () => void menuActions.stopSharing(),
                  },
                ]
              : []),
          ],
          [
            {
              type: 'item',
              label: t('archive'),
              icon: Archive,
              disabled: held,
              onClick: () => menuActions.setArchived(true, leaveIfActive),
            },
            ...deleteGroup,
          ],
        ];

  return (
    <>
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
        disabled={!menuActions.available}
      />
      {/* Mounted only while open — a hidden dialog per row would be pure
          overhead in long lists. */}
      {deleteOpen && (
        <ThreadDeleteDialog
          thread={thread}
          organizationId={organizationId}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={leaveIfActive}
        />
      )}
    </>
  );
}
