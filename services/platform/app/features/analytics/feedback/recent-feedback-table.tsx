'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import { Stack } from '@tale/ui/layout';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import type { ArenaVerdict, RecentFeedbackItem } from './types';

function ExpandedComment({
  row,
  tAnalytics,
}: {
  row: RecentFeedbackItem;
  tAnalytics: ReturnType<typeof useT>['t'];
}) {
  const { data, isLoading, isError } = useBackendQuery(
    'feedback/queries:getFeedbackComment',
    row.commentTruncated === true ? { feedbackId: row._id } : 'skip',
  );

  return (
    <Stack gap={1} aria-live="polite">
      <Text className="text-sm whitespace-pre-wrap">
        {(row.commentTruncated === true && data !== undefined
          ? data.comment
          : row.comment) ?? tAnalytics('feedback.recent.noComment')}
      </Text>
      {row.commentTruncated === true && data === undefined && isLoading && (
        <Text role="status" className="text-sm">
          {tAnalytics('feedback.recent.loadingComment')}
        </Text>
      )}
      {row.commentTruncated === true && data === undefined && isError && (
        <Text role="alert" className="text-destructive text-sm">
          {tAnalytics('feedback.recent.commentLoadFailed')}
        </Text>
      )}
    </Stack>
  );
}

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
  error?: Error | null;
  retry?: () => void;
  isRetrying?: boolean;
  /** Right-aligned controls in the section header — kind/comments-only filters scoped to this table only. */
  headerActions?: ReactNode;
}

export function RecentFeedbackTable({
  rows,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  error = null,
  retry,
  isRetrying = false,
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
              className="text-chart-success size-4"
              aria-label={tAnalytics('feedback.recent.helpfulAria')}
            />
          ) : (
            <ThumbsDown
              className="text-chart-failure size-4"
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
          <ExpandedComment row={row.original} tAnalytics={tAnalytics} />
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
      {error ? (
        <Alert
          variant="destructive"
          title={tAnalytics('feedback.recent.loadFailed')}
          description={failureDetail(error)}
        >
          {retry ? (
            <Button variant="secondary" onClick={retry} disabled={isRetrying}>
              {tAnalytics('feedback.recent.retry')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
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
        emptyState={
          error
            ? undefined
            : {
                icon: MessageSquare,
                title: tAnalytics('feedback.recent.emptyTitle'),
                description: tAnalytics('feedback.recent.emptyDescription'),
              }
        }
      />
    </MetricsSection>
  );
}
