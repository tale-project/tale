'use client';

/**
 * The Home panel's Inbox view: the customer conversations of one status,
 * with the inbox's whole toolset — search, the assignee / read / source
 * facets, and multi-select with the bulk verbs (send, close, spam, reopen,
 * archive). It runs on the same list model as the phone's full-screen Inbox
 * (`useInboxList`), so a facet or a bulk verb cannot behave differently in
 * the two places. The facets are remembered per device, like the panel's
 * other choices.
 */

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { FilterPanel } from '@tale/ui/filters/filter-panel';
import { SearchInput } from '@tale/ui/search-input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tooltip } from '@tale/ui/tooltip';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDown,
  Inbox,
  Loader2Icon,
  MailXIcon,
  SendHorizontalIcon,
  ShieldXIcon,
  SquarePen,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { HomeRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import { BulkSendDialog } from '@/app/features/conversations/components/bulk-send-dialog';
import { useListConversationsPaginated } from '@/app/features/conversations/hooks/queries';
import { useInboxChannelOptions } from '@/app/features/conversations/hooks/use-inbox-channel-options';
import {
  isReadFilter,
  useInboxList,
  type ReadFilter,
} from '@/app/features/conversations/hooks/use-inbox-list';
import {
  channelFilterOf,
  mailboxOptionValue,
} from '@/app/features/conversations/lib/channel-source';
import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { toHomeConversationItem } from '../hooks/use-home-data';
import {
  INBOX_STATUSES,
  groupHomeItems,
  type HomeConversationItem,
  type InboxStatus,
} from '../lib/home-items';
import { HomeConversationRow } from './home-rows';

const PAGE_SIZE = 30;
const NO_ASSIGNEES: string[] = [];

function BulkButton({
  label,
  icon: Icon,
  onClick,
  busy,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  busy: boolean;
  /** Held without a spinner — another verb is running. */
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <Button
        size="icon"
        variant="ghost"
        onClick={onClick}
        disabled={busy || disabled}
        aria-label={label}
        className="text-muted-foreground hover:text-foreground size-7"
      >
        {busy ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
      </Button>
    </Tooltip>
  );
}

export function HomeInboxList({
  organizationId,
  status,
  onStatusChange,
  activeConversationId,
  onInboxRoute,
}: {
  organizationId: string;
  status: InboxStatus;
  onStatusChange: (status: InboxStatus) => void;
  activeConversationId?: string;
  /** An inbox route is open — a status change moves it along. */
  onInboxRoute: boolean;
}) {
  const { t } = useT('home');
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');
  const { t: tDialogs } = useT('dialogs');
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [storedRead, setRead] = usePersistedState<ReadFilter>(
    `home-inbox-read-${organizationId}`,
    'all',
  );
  const readFilter: ReadFilter = isReadFilter(storedRead) ? storedRead : 'all';
  const [assignee, setAssignee] = usePersistedState<string[]>(
    `home-inbox-assignee-${organizationId}`,
    NO_ASSIGNEES,
  );
  const [channel, setChannel] = usePersistedState<string>(
    `home-inbox-channel-${organizationId}`,
    '',
  );
  const serverFilter = channelFilterOf(channel === '' ? undefined : channel);

  const paginated = useListConversationsPaginated({
    organizationId,
    status,
    ...(serverFilter.channel !== undefined && {
      connectorName: serverFilter.channel,
    }),
    ...(serverFilter.mailbox !== undefined && {
      credentialId: serverFilter.mailbox,
    }),
    initialNumItems: PAGE_SIZE,
  });
  const channelOptions = useInboxChannelOptions(organizationId);

  const channelFilter = useMemo(
    () => ({
      options: channelOptions,
      value:
        serverFilter.mailbox !== undefined
          ? mailboxOptionValue(serverFilter.mailbox)
          : serverFilter.channel,
      onChange: (value?: string) => setChannel(value ?? ''),
    }),
    [channelOptions, serverFilter.channel, serverFilter.mailbox, setChannel],
  );

  const list = useInboxList({
    organizationId,
    rows: paginated.results,
    searchQuery: search,
    onSearchChange: setSearch,
    readFilter,
    onReadFilterChange: setRead,
    assigneeSelection: assignee,
    onAssigneeFilterChange: setAssignee,
    channelFilter,
    // As on the inbox page: a bulk verb lets go of the open conversation,
    // which may have just moved to another tab.
    onBulkComplete: () => {
      if (activeConversationId === undefined) return;
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status },
      });
    },
  });
  const { selection, bulk } = list;

  // The facets narrow the loaded pages only, so keep pulling pages while one
  // is active — a match beyond the first page must not read as "none".
  const { status: pageStatus, loadMore } = paginated;
  useEffect(() => {
    if (list.isFiltering && pageStatus === 'CanLoadMore') loadMore(PAGE_SIZE);
  }, [list.isFiltering, pageStatus, loadMore]);

  // …and while scrolling: the last row coming into view asks for the next.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && pageStatus === 'CanLoadMore') {
          loadMore(PAGE_SIZE);
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pageStatus, loadMore]);

  const { serverEpochNow } = useClockOffset();
  const groups = useMemo(
    () =>
      groupHomeItems(
        list.filteredConversations.flatMap((row): HomeConversationItem[] => {
          const item = toHomeConversationItem(row, status);
          return item === null ? [] : [item];
        }),
        serverEpochNow(),
      ),
    // The bands follow the data; the clock only places them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.filteredConversations, status],
  );

  const selectStatus = (next: InboxStatus) => {
    selection.clearSelection();
    onStatusChange(next);
    if (onInboxRoute) {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status: next },
      });
    }
  };

  const statusItems: DropdownMenuGroup[] = [
    INBOX_STATUSES.map((option) => ({
      type: 'item' as const,
      label: t(`inbox.status.${option}`),
      selected: option === status,
      onClick: () => selectStatus(option),
    })),
  ];

  const loading = pageStatus === 'LoadingFirstPage';
  const busy = bulk.isBulkProcessing;

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <DropdownMenu
            align="start"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground -ml-1 h-7 gap-1 px-2 text-xs font-medium"
                // The name leads with the visible status, so a voice command
                // saying what is on screen reaches the button.
                aria-label={t('inbox.statusLabel', {
                  status: t(`inbox.status.${status}`),
                })}
              >
                {t(`inbox.status.${status}`)}
                <ChevronDown className="text-muted-foreground size-3.5" />
              </Button>
            }
            items={statusItems}
          />
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
          >
            <Link
              to="/dashboard/$id/conversations/$status"
              params={{ id: organizationId, status }}
              search={{ compose: 'new' }}
            >
              <SquarePen className="size-3.5" />
              {t('inbox.compose')}
            </Link>
          </Button>
        </div>

        {selection.hasSelectedItems ? (
          <div
            role="toolbar"
            aria-label={tConversations('bulk.selectedCount', {
              count: selection.selectedCount,
            })}
            className="bg-muted/70 animate-in fade-in-0 zoom-in-95 flex h-8 items-center gap-1 rounded-lg pr-1 pl-2 duration-150"
          >
            <Checkbox
              checked={
                selection.selectAllChecked
                  ? true
                  : selection.hasSelectedItems
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={selection.handleSelectAll}
              aria-label={tCommon('aria.selectAll')}
            />
            <span className="ml-1 min-w-0 flex-1 truncate text-xs font-medium tabular-nums">
              {tConversations('bulk.selectedCount', {
                count: selection.selectedCount,
              })}
            </span>
            {status === 'open' && (
              <>
                <BulkButton
                  label={tConversations('bulk.sendMessages')}
                  icon={SendHorizontalIcon}
                  onClick={bulk.openBulkSendDialog}
                  busy={false}
                  disabled={busy}
                />
                <BulkButton
                  label={tConversations('bulk.close')}
                  icon={MailXIcon}
                  onClick={() => void bulk.handleBulkResolve()}
                  busy={busy}
                />
                <BulkButton
                  label={tConversations('bulk.markSpam')}
                  icon={ShieldXIcon}
                  onClick={() => void bulk.handleBulkSpam()}
                  busy={busy}
                />
              </>
            )}
            {(status === 'closed' || status === 'spam') && (
              <BulkButton
                label={tConversations('bulk.reopen')}
                icon={ArchiveRestoreIcon}
                onClick={() => void bulk.handleBulkReopen()}
                busy={busy}
              />
            )}
            {status === 'archived' ? (
              <BulkButton
                label={tConversations('bulk.unarchive')}
                icon={ArchiveRestoreIcon}
                onClick={() => void bulk.handleBulkUnarchive()}
                busy={busy}
              />
            ) : (
              <BulkButton
                label={tConversations('bulk.archive')}
                icon={ArchiveIcon}
                onClick={() => void bulk.handleBulkArchive()}
                busy={busy}
              />
            )}
            <BulkButton
              label={t('inbox.clearSelection')}
              icon={X}
              onClick={selection.clearSelection}
              busy={false}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tConversations('searchPlaceholder')}
              wrapperClassName="min-w-0 flex-1"
              className="h-8 bg-transparent text-xs shadow-none"
              disabled={loading}
            />
            <FilterPanel
              filters={list.filters}
              onClearAll={list.clearAllFilters}
              disabled={loading}
              align="end"
              iconOnly
            />
          </div>
        )}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2.5">
        {loading ? (
          <Skeletonize loading className="flex flex-col gap-0.5 pt-2">
            <HomeRowsSkeleton />
          </Skeletonize>
        ) : groups.length === 0 ? (
          pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore' ? (
            <Skeletonize loading className="flex flex-col gap-0.5 pt-2">
              <HomeRowsSkeleton />
            </Skeletonize>
          ) : (
            <div className="animate-in fade-in-0 flex flex-col items-center gap-1 px-6 py-10 text-center duration-300">
              <Inbox
                aria-hidden
                className="text-muted-foreground/60 mb-1 size-7"
              />
              <p className="text-foreground text-sm font-medium">
                {t('empty.inbox.title')}
              </p>
              <p className="text-muted-foreground text-xs">
                {list.isFiltering
                  ? t('empty.inbox.filtered')
                  : t('empty.inbox.hint')}
              </p>
            </div>
          )
        ) : (
          <ol
            key={status}
            aria-label={t('aria.inbox')}
            className="animate-in fade-in-0 flex flex-col gap-1 duration-200 motion-reduce:animate-none"
          >
            {groups.map((group) => (
              <li key={group.key}>
                <h3 className="bg-background text-muted-foreground sticky top-0 z-20 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                  {t(`groups.${group.key}`)}
                </h3>
                <ul role="list" className="flex flex-col gap-px">
                  {group.items.map((item) =>
                    item.kind === 'conversation' ? (
                      <HomeConversationRow
                        key={item.id}
                        item={item}
                        organizationId={organizationId}
                        active={item.id === activeConversationId}
                        selection={{
                          checked: selection.isConversationSelected(item.id),
                          active: selection.hasSelectedItems,
                          onChange: (checked) =>
                            selection.handleConversationCheck(item.id, checked),
                          label: tDialogs('selectConversation'),
                        }}
                      />
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {pageStatus === 'LoadingMore' && (
          <div className="flex justify-center py-2">
            <Loader2Icon
              aria-hidden
              className={cn('text-muted-foreground size-4 animate-spin')}
            />
          </div>
        )}
      </div>

      {bulk.bulkSendDialog.isOpen && (
        <BulkSendDialog
          selectedCount={selection.selectedCount}
          isSending={bulk.bulkSendDialog.isSending}
          onConfirm={bulk.handleSendMessages}
          onCancel={bulk.closeBulkSendDialog}
        />
      )}
    </>
  );
}
