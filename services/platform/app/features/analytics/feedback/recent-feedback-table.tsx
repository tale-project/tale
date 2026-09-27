'use client';

import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import { Stack } from '@tale/ui/layout';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

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

  // Column sizes double as the table's min-width floor (DataTable sums them):
  // 996px with the expand column, inside the settings content column of a
  // 1366px laptop. The comment takes the slack.
  const columns = useMemo<ColumnDef<RecentFeedbackItem>[]>(
    () => [
      {
        id: 'time',
        header: tAnalytics('feedback.recent.columns.time'),
        cell: ({ row }) => (
          // `truncate`: "a few seconds ago", shown for the first 45 seconds,
          // runs past the column in every locale and clips instead of
          // painting over the user.
          <TableDateCell
            date={row.original.createdAt}
            preset="relative"
            className="block truncate"
          />
        ),
        // A relative time up to "vor einem Monat".
        size: 136,
      },
      {
        id: 'user',
        header: tAnalytics('feedback.recent.columns.user'),
        cell: ({ row }) => (
          <Text as="span" variant="label" className="block truncate text-sm">
            {row.original.userDisplayName}
          </Text>
        ),
        // A full name such as "Andrea Zimmermann"; a longer one truncates.
        size: 168,
      },
      {
        id: 'type',
        header: tAnalytics('feedback.recent.columns.type'),
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => (
          <Badge variant={row.original.isArena ? 'blue' : 'outline'}>
            {tAnalytics(
              row.original.isArena
                ? 'feedback.recent.types.arena'
                : 'feedback.recent.types.message',
            )}
          </Badge>
        ),
        // The wider badge, "Arena".
        size: 80,
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
              className="text-chart-success size-4"
              aria-label={tAnalytics('feedback.recent.helpfulAria')}
            />
          ) : (
            <ThumbsDown
              className="text-chart-failure size-4"
              aria-label={tAnalytics('feedback.recent.notHelpfulAria')}
            />
          ),
        // The German verdict "Unentschieden", the longest word; the French
        // "Les deux sont mauvais" wraps onto a second line.
        size: 112,
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
        // A slug such as "customer-support"; a longer one wraps.
        size: 128,
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
        // A model slug such as "anthropic/claude-sonnet-4.5" on one line; an
        // arena pair wraps.
        size: 188,
      },
      {
        id: 'comment',
        header: tAnalytics('feedback.recent.columns.comment'),
        // The comment, not the leading time column, takes the slack; this is
        // its floor. The expanded row shows it in full.
        meta: { flex: true },
        cell: ({ row }) => (
          <Text as="span" className="block truncate text-sm">
            {row.original.comment ?? '—'}
          </Text>
        ),
        size: 136,
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
    <MetricsSection
      title={tAnalytics('feedback.recent.title')}
      actions={headerActions}
    >
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
          entityLabel: {
            one: tAnalytics('feedback.recent.entityLabelOne'),
            other: tAnalytics('feedback.recent.entityLabel'),
          },
        }}
        emptyState={{
          icon: MessageSquare,
          title: tAnalytics('feedback.recent.emptyTitle'),
          description: tAnalytics('feedback.recent.emptyDescription'),
        }}
      />
    </MetricsSection>
  );
}
