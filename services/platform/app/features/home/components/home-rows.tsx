'use client';

/**
 * One row anatomy for everything the Home stream lists. A chat, a task and a
 * customer conversation read the same way: a leading glyph that says what the
 * item is, the title, the relative age, and a second line of context — the
 * project, the task's key and status, or who the conversation is with. The
 * unread dot always sits in the same place, so "what needs me" scans as one
 * column whatever the kind.
 */

import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { useSubPanelRowTreatment } from '@tale/ui/sub-panel-list';
import { Link } from '@tanstack/react-router';
import {
  LoaderCircle,
  MessageCircle,
  Pin,
  Share2,
  SquarePen,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useThreadDraggable } from '@/app/features/chat/components/thread-dnd';
import { useThreadListFrame } from '@/app/features/chat/components/thread-list-context';
import {
  ThreadRenameInput,
  ThreadRowMenu,
} from '@/app/features/chat/components/thread-row';
import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { ContactInitials } from '@/app/features/conversations/components/contact-initials';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { TaskStatusGlyph } from '@/app/features/tasks/components/task-status-glyph';
import { useT } from '@/lib/i18n/client';

import { useCompactAge } from '../hooks/use-compact-age';
import type {
  HomeChatItem,
  HomeConversationItem,
  HomeTaskItem,
} from '../lib/home-items';

// ───────────────────────────── shared frame ─────────────────────────────

const ROW_LINK_CLASS =
  'focus-visible:ring-ring flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

/** The two text lines every row shares: title + age, then context + dot. */
function RowText({
  title,
  unread,
  age,
  meta,
  actions = false,
}: {
  title: ReactNode;
  unread: boolean;
  age: string | null;
  meta: ReactNode;
  /** The row reveals its actions over the age's edge (desktop). */
  actions?: boolean;
}) {
  const { t } = useT('home');
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] leading-5',
            unread ? 'text-foreground font-semibold' : 'text-foreground',
          )}
        >
          {title}
        </span>
        {age !== null && (
          <span
            className={cn(
              'text-muted-foreground/80 shrink-0 text-[11px] leading-5 tabular-nums transition-opacity duration-150',
              // Steps aside while the row's actions show (desktop) — they
              // land on this edge and the age would show through them.
              actions &&
                'md:group-hover:opacity-0 md:group-has-[:focus-visible]:opacity-0 md:group-has-[[data-state=open]]:opacity-0',
            )}
          >
            {age}
          </span>
        )}
      </span>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-4">
        {meta}
        {unread && (
          <>
            <span className="sr-only">{t('row.unread')}</span>
            <span
              aria-hidden
              className="animate-in zoom-in-50 ml-auto size-1.5 shrink-0 rounded-full bg-blue-500 duration-300"
            />
          </>
        )}
      </span>
    </span>
  );
}

function RowGlyph({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center"
    >
      {children}
    </span>
  );
}

/** The project a row belongs to, as a quiet inline marker. */
function ProjectMarker({ project }: { project: ChatProjectSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <ProjectAvatar
        name={project.name}
        icon={project.icon}
        color={project.color}
        size={16}
        variant="plain"
        className="size-3 [&_svg]:size-3"
      />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

// ───────────────────────────── chats ─────────────────────────────

/**
 * A chat in the stream. Carries every chat action — pin, rename in place,
 * mark read, move to a project (also by dragging the row onto a project),
 * share, archive, delete — through the row menu an archived chat's row
 * shares, on the same handlers as the chat header's menu.
 */
export function HomeChatRow({
  item,
  thread,
  project,
  active,
}: {
  item: HomeChatItem;
  thread: ChatThreadSummary;
  project: ChatProjectSummary | undefined;
  active: boolean;
}) {
  const { t } = useT('home');
  const { t: tChat } = useT('chat');
  const { organizationId } = useThreadListFrame();
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, listeners, isDragging } = useThreadDraggable({
    id: thread.id,
    projectId: thread.projectId ?? null,
    title: thread.title ?? tChat('history.untitled'),
    archived: thread.archived,
  });
  const treatment = useSubPanelRowTreatment(active && !isDragging);
  const age = useCompactAge(item.activityAt, { paused: item.generating });
  const title = item.title.length > 0 ? item.title : t('row.untitledChat');

  return (
    <li
      ref={setNodeRef}
      {...(renaming ? {} : listeners)}
      data-thread-id={thread.id}
      className={cn('group relative rounded-lg', isDragging && 'opacity-40')}
    >
      {renaming ? (
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <RowGlyph>
            <MessageCircle className="text-muted-foreground size-4" />
          </RowGlyph>
          <ThreadRenameInput
            thread={thread}
            organizationId={organizationId}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <Link
          to="/dashboard/$id/chat/$threadId"
          params={{ id: organizationId, threadId: thread.id }}
          aria-current={active ? 'page' : undefined}
          className={cn(
            ROW_LINK_CLASS,
            active ? treatment.className : 'hover:bg-muted/60',
          )}
          {...(active && treatment.style !== undefined
            ? { style: treatment.style }
            : {})}
        >
          <RowGlyph>
            {item.generating ? (
              <LoaderCircle className="size-4 animate-spin text-blue-500 motion-reduce:animate-none" />
            ) : (
              <MessageCircle className="text-muted-foreground size-4" />
            )}
          </RowGlyph>
          <RowText
            title={title}
            unread={item.unread && !active}
            age={item.generating ? null : age}
            actions
            meta={
              <>
                {item.pinnedAt !== undefined && (
                  <Pin
                    aria-label={tChat('pinned')}
                    className="size-3 shrink-0"
                  />
                )}
                {item.shared && (
                  <Share2
                    aria-label={tChat('share.sharedIndicator')}
                    className="size-3 shrink-0"
                  />
                )}
                {item.generating ? (
                  <span className="truncate text-blue-600 dark:text-blue-400">
                    {t('row.generating')}
                  </span>
                ) : project !== undefined ? (
                  <ProjectMarker project={project} />
                ) : (
                  <span className="truncate">{t('row.chat')}</span>
                )}
              </>
            }
          />
        </Link>
      )}
      {!renaming && (
        <div className="bg-background/85 absolute top-1.5 right-1.5 z-10 rounded-md opacity-100 backdrop-blur-sm transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 md:has-[[data-state=open]]:opacity-100">
          <ThreadRowMenu
            thread={thread}
            variant="default"
            active={active}
            onStartRename={() => setRenaming(true)}
          />
        </div>
      )}
    </li>
  );
}

/** The provisional row while a fresh chat is being written. */
export function HomeDraftChatRow({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const { t } = useT('home');
  const treatment = useSubPanelRowTreatment(true);
  return (
    <li className="animate-in fade-in-0 slide-in-from-top-1 rounded-lg duration-200">
      <Link
        to="/dashboard/$id/chat"
        params={{ id: organizationId }}
        search={
          projectId !== undefined ? { projectId, new: true } : { new: true }
        }
        aria-current="page"
        className={cn(ROW_LINK_CLASS, treatment.className)}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        <RowGlyph>
          <SquarePen className="size-4" />
        </RowGlyph>
        <RowText
          title={t('newChat')}
          unread={false}
          age={null}
          meta={<span className="truncate">{t('row.draft')}</span>}
        />
      </Link>
    </li>
  );
}

// ───────────────────────────── tasks ─────────────────────────────

export function HomeTaskRow({
  item,
  organizationId,
  active,
}: {
  item: HomeTaskItem;
  organizationId: string;
  active: boolean;
}) {
  const { t } = useT('home');
  const { t: tTasks } = useT('tasks');
  const treatment = useSubPanelRowTreatment(active);
  const age = useCompactAge(item.activityAt);

  return (
    <li className="group relative rounded-lg">
      <Link
        to="/dashboard/$id/tasks/$taskId"
        params={{ id: organizationId, taskId: item.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_LINK_CLASS,
          active ? treatment.className : 'hover:bg-muted/60',
        )}
        {...(active && treatment.style !== undefined
          ? { style: treatment.style }
          : {})}
      >
        <RowGlyph>
          <TaskStatusGlyph status={item.status} />
        </RowGlyph>
        <RowText
          title={item.title}
          unread={item.awaitingMyReview && !active}
          age={age}
          meta={
            <>
              {item.identifier !== undefined && (
                <span className="shrink-0 font-mono text-[11px] tracking-tight">
                  {item.identifier}
                </span>
              )}
              <span className="truncate">
                {item.awaitingMyReview
                  ? t('row.awaitingReview')
                  : tTasks(`status.${item.status}`)}
              </span>
            </>
          }
        />
      </Link>
    </li>
  );
}

// ───────────────────────────── conversations ─────────────────────────────

export interface HomeRowSelection {
  readonly checked: boolean;
  /** A selection is under way — every row shows its checkbox, not only the
   * hovered one. */
  readonly active: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
}

export function HomeConversationRow({
  item,
  organizationId,
  active,
  selection,
}: {
  item: HomeConversationItem;
  organizationId: string;
  active: boolean;
  /** The Inbox view's multi-select; absent in the mixed stream. */
  selection?: HomeRowSelection;
}) {
  const { t: tConversations } = useT('conversations');
  const treatment = useSubPanelRowTreatment(active);
  const age = useCompactAge(item.activityAt);
  const contact = item.contactLabel ?? tConversations('unknownContact');
  const showCheckbox =
    selection !== undefined && (selection.active || selection.checked);

  return (
    <li
      className={cn(
        'group relative rounded-lg',
        selection?.checked === true && 'bg-primary/5',
      )}
    >
      <Link
        to="/dashboard/$id/conversations/$status"
        params={{ id: organizationId, status: item.status }}
        search={{ conversation: item.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_LINK_CLASS,
          active ? treatment.className : 'hover:bg-muted/60',
        )}
        {...(active && treatment.style !== undefined
          ? { style: treatment.style }
          : {})}
      >
        <RowGlyph>
          <span
            className={cn(
              'transition-opacity duration-150',
              selection !== undefined &&
                (showCheckbox
                  ? 'opacity-0'
                  : 'opacity-0 md:opacity-100 md:group-hover:opacity-0 md:group-has-[:focus-visible]:opacity-0'),
            )}
          >
            <ContactInitials label={contact} />
          </span>
        </RowGlyph>
        <RowText
          title={item.title}
          unread={item.unread && !active}
          age={age}
          meta={
            <span className="min-w-0 truncate">
              <span className="text-foreground/80 font-medium">{contact}</span>
              {item.preview !== undefined && (
                <span>
                  {' · '}
                  {item.preview}
                </span>
              )}
            </span>
          }
        />
      </Link>
      {selection !== undefined && (
        // A sibling of the link, never inside it, laid over the glyph. On a
        // computer the contact's initials give way to a checkbox on hover or
        // keyboard focus, and every row keeps its checkbox once a selection
        // is under way; on a phone, where nothing hovers, the checkbox always
        // stands in for them — or a selection could never start.
        <span
          className={cn(
            'absolute top-2 left-2 flex size-5 items-center justify-center transition-opacity duration-150',
            showCheckbox
              ? 'opacity-100'
              : 'md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-has-[:focus-visible]:pointer-events-auto md:group-has-[:focus-visible]:opacity-100',
          )}
        >
          <Checkbox
            checked={selection.checked}
            onCheckedChange={(checked) => selection.onChange(checked === true)}
            aria-label={selection.label}
          />
        </span>
      )}
    </li>
  );
}
