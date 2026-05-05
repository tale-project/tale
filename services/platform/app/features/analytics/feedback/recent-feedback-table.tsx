'use client';

import { Badge } from '@tale/ui/badge';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ArenaVerdict, RecentFeedbackItem } from './types';

const VERDICT_I18N_KEY: Record<ArenaVerdict, string> = {
  a_better: 'aBetter',
  b_better: 'bBetter',
  tie: 'tie',
  both_bad: 'bothBad',
};

interface RecentFeedbackTableProps {
  rows: RecentFeedbackItem[];
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Right-aligned controls in the section header — kind/comments-only filters scoped to this table only. */
  headerActions?: ReactNode;
}

export function RecentFeedbackTable({
  rows,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  headerActions,
}: RecentFeedbackTableProps) {
  const { t: tAnalytics } = useT('analytics');
  const { t: tChat } = useT('chat');

  const columns = useMemo<ColumnDef<RecentFeedbackItem>[]>(
    () => [
      {
        id: 'time',
        header: tAnalytics('feedback.recent.columns.time'),
        cell: ({ row }) => (
          <TableDateCell date={row.original.createdAt} preset="relative" />
        ),
        size: 120,
      },
      {
        id: 'user',
        header: tAnalytics('feedback.recent.columns.user'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="label"
            className="block max-w-[180px] truncate text-sm"
          >
            {row.original.userDisplayName}
          </Text>
        ),
        size: 180,
      },
      {
        id: 'type',
        header: tAnalytics('feedback.recent.columns.type'),
        cell: ({ row }) => (
          <Badge variant={row.original.isArena ? 'blue' : 'outline'}>
            {tAnalytics(
              row.original.isArena
                ? 'feedback.recent.types.arena'
                : 'feedback.recent.types.message',
            )}
          </Badge>
        ),
        size: 100,
      },
      {
        id: 'rating',
        header: tAnalytics('feedback.recent.columns.rating'),
        cell: ({ row }) =>
          row.original.isArena && row.original.arenaVerdict ? (
            <Text className="text-xs">
              {tChat(`arena.${VERDICT_I18N_KEY[row.original.arenaVerdict]}`)}
            </Text>
          ) : row.original.rating === 'positive' ? (
            <ThumbsUp
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-label={tAnalytics('feedback.recent.helpfulAria')}
            />
          ) : (
            <ThumbsDown
              className="size-4 text-rose-600 dark:text-rose-400"
              aria-label={tAnalytics('feedback.recent.notHelpfulAria')}
            />
          ),
        size: 100,
      },
      {
        id: 'agent',
        header: tAnalytics('feedback.recent.columns.agent'),
        cell: ({ row }) => (
          <Text
            as="span"
            className="text-muted-foreground block text-xs break-all"
          >
            {row.original.agentSlug ?? '—'}
          </Text>
        ),
        size: 140,
      },
      {
        id: 'model',
        header: tAnalytics('feedback.recent.columns.model'),
        cell: ({ row }) => {
          if (row.original.isArena) {
            const a = row.original.arenaModelA;
            const b = row.original.arenaModelB;
            if (a && b) {
              return (
                <Text
                  as="span"
                  className="text-muted-foreground block text-xs break-all"
                >
                  {a} vs {b}
                </Text>
              );
            }
          }
          return (
            <Text
              as="span"
              className="text-muted-foreground block text-xs break-all"
            >
              {row.original.model ?? '—'}
            </Text>
          );
        },
        size: 200,
      },
      {
        id: 'comment',
        header: tAnalytics('feedback.recent.columns.comment'),
        cell: ({ row }) => (
          <Text as="span" className="block max-w-[300px] truncate text-sm">
            {row.original.comment ?? '—'}
          </Text>
        ),
        size: 300,
      },
    ],
    [tAnalytics, tChat],
  );

  const renderExpandedRow = useCallback(
    (row: Row<RecentFeedbackItem>) => (
      <Stack className="bg-muted/30 px-5 py-4" gap={3}>
        <Stack gap={1}>
          <Text className="text-muted-foreground text-xs tracking-wide uppercase">
            {tAnalytics('feedback.recent.expanded.comment')}
          </Text>
          <Text className="text-sm whitespace-pre-wrap">
            {row.original.comment ?? tAnalytics('feedback.recent.noComment')}
          </Text>
        </Stack>
        {row.original.isArena ? (
          <Stack gap={1}>
            <Text className="text-muted-foreground text-xs tracking-wide uppercase">
              {tAnalytics('feedback.recent.expanded.arena')}
            </Text>
            <Text className="text-sm">
              {row.original.arenaModelA ?? '—'} vs{' '}
              {row.original.arenaModelB ?? '—'}
              {row.original.arenaVerdict
                ? ' · ' +
                  tChat(`arena.${VERDICT_I18N_KEY[row.original.arenaVerdict]}`)
                : ''}
            </Text>
          </Stack>
        ) : (
          <Stack gap={1}>
            <Text className="text-muted-foreground text-xs tracking-wide uppercase">
              {tAnalytics('feedback.recent.expanded.attribution')}
            </Text>
            <Text className="text-sm">
              {row.original.agentSlug ?? '—'} · {row.original.provider ?? '—'} /{' '}
              {row.original.model ?? '—'}
            </Text>
          </Stack>
        )}
      </Stack>
    ),
    [tAnalytics, tChat],
  );

  return (
    <div className={cn('flex flex-col gap-3')}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Text as="h3" className="text-foreground text-base font-semibold">
          {tAnalytics('feedback.recent.title')}
        </Text>
        {headerActions}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row._id}
        enableExpanding
        renderExpandedRow={renderExpandedRow}
        isLoading={isLoading}
        approxRowCount={isLoading ? 8 : rows.length}
        infiniteScroll={{
          hasMore,
          onLoadMore,
          isLoadingMore,
          isInitialLoading: isLoading,
        }}
        emptyState={{
          icon: MessageSquare,
          title: tAnalytics('feedback.recent.emptyTitle'),
          description: tAnalytics('feedback.recent.emptyDescription'),
        }}
      />
    </div>
  );
}
