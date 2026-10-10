'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { createSelectColumn } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DataTableFilters } from '@tale/ui/data-table/data-table-filters';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { TableTimestampCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { ArrowLeftRight, History, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { PageItemOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { useAutomationRunsPage } from '../hooks/queries';
import { useRunStarterLabel } from '../hooks/use-run-starter-label';
import { automationDetailPathname } from '../lib/detail-paths';
import { isRunFailureCode, runFailureText } from '../lib/run-failure';
import { readRunStatus, runReasonKey } from '../lib/run-view';
import { RunBadge } from './run-status-badge';

type RunRow = PageItemOf<'automations/queries:listRunsPaginated'>;

/** The statuses a reader can narrow the list to, in the order they read. */
const STATUSES = [
  'running',
  'waiting',
  'queued',
  'success',
  'failed',
  'cancelled',
  'quarantined',
] as const;

/**
 * One automation's runs as a table, newest first, a page at a time: how
 * each ended, when it started, why a failed one failed and what a waiting
 * one waits for, its version, mode and starter. Narrowed by status and
 * mode; a row opens its run; two selected runs open their comparison.
 *
 * Mode is on every row and never implied: a test run reaches nothing
 * outside the platform, a live one may have changed things on the
 * organization's behalf.
 */
export function RunsTable({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep run links inside the project shell. */
  projectId?: string;
}) {
  const { t } = useT('automationRuns');
  const { t: tAutomations } = useT('automations');
  const navigate = useNavigate();
  const starterLabel = useRunStarterLabel(organizationId);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [mode, setMode] = useState<'mock' | 'live' | undefined>();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const result = useAutomationRunsPage({
    organizationId,
    name: automationSlug,
    ...(projectId !== undefined && { projectId }),
    statuses,
    ...(mode !== undefined && { mode }),
  });
  const runsPath = `${automationDetailPathname({
    organizationId,
    automationSlug,
    ...(projectId !== undefined && { projectId }),
  })}/runs`;

  const columns = useMemo<ColumnDef<RunRow>[]>(() => {
    // Why a failed run failed in the reader's words, what a waiting one
    // waits for; nothing for a run that needs no account.
    const resultText = (run: RunRow): string => {
      const reason = runReasonKey(run);
      if (reason === undefined) return '';
      if (reason.kind !== 'failed')
        return tAutomations(reason.key, reason.values);
      return isRunFailureCode(run.failureCode)
        ? runFailureText(run.failureCode, { t }).title
        : reason.detail;
    };
    return [
      createSelectColumn<RunRow>(),
      {
        id: 'status',
        header: t('list.columns.status'),
        cell: ({ row }) => (
          <RunBadge
            status={readRunStatus(row.original.status)}
            stalled={row.original.stalled === true}
          />
        ),
        meta: { skeleton: { type: 'badge' as const } },
        size: 160,
      },
      {
        id: 'started',
        header: t('list.columns.started'),
        cell: ({ row }) => (
          <TableTimestampCell
            timestamp={row.original.startedAt}
            preset="long"
          />
        ),
        size: 180,
      },
      {
        id: 'result',
        header: t('list.columns.result'),
        cell: ({ row }) => {
          const text = resultText(row.original);
          return (
            <Text as="span" truncate title={text}>
              {text}
            </Text>
          );
        },
        size: 260,
      },
      {
        id: 'version',
        header: t('list.columns.version'),
        cell: ({ row }) =>
          tAutomations('versions.versionLabel', {
            version: row.original.version,
          }),
        size: 90,
      },
      {
        id: 'mode',
        header: t('list.columns.mode'),
        cell: ({ row }) => (
          <Badge variant={row.original.mode === 'live' ? 'orange' : 'slate'}>
            {row.original.mode === 'live'
              ? tAutomations('runs.mode.live')
              : tAutomations('runs.mode.mock')}
          </Badge>
        ),
        meta: { skeleton: { type: 'badge' as const } },
        size: 90,
      },
      {
        id: 'startedBy',
        header: t('list.columns.startedBy'),
        cell: ({ row }) => {
          const text = starterLabel(row.original);
          return (
            <Text as="span" truncate title={text}>
              {text}
            </Text>
          );
        },
        size: 200,
      },
    ];
  }, [t, tAutomations, starterLabel]);

  const selected = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const filtered = statuses.length > 0 || mode !== undefined;
  const hasMore =
    result.status === 'CanLoadMore' || result.status === 'LoadingMore';

  return (
    <div className="flex flex-col gap-3">
      <DataTableFilters
        filters={[
          {
            key: 'status',
            title: t('list.filters.status'),
            multiSelect: true,
            options: STATUSES.map((status) => ({
              value: status,
              label: tAutomations(`runs.status.${status}`),
            })),
            selectedValues: statuses,
            onChange: (values) => {
              setStatuses(values);
              setRowSelection({});
            },
          },
          {
            key: 'mode',
            title: t('list.filters.mode'),
            options: [
              { value: 'mock', label: tAutomations('runs.mode.mock') },
              { value: 'live', label: tAutomations('runs.mode.live') },
            ],
            selectedValues: mode === undefined ? [] : [mode],
            onChange: (values) => {
              const next = values[0];
              setMode(next === 'mock' || next === 'live' ? next : undefined);
              setRowSelection({});
            },
          },
        ]}
      />
      <DataTable<RunRow>
        columns={columns}
        data={result.results}
        caption={t('list.caption')}
        isLoading={result.status === 'LoadingFirstPage'}
        approxRowCount={result.results.length}
        getRowId={(row) => row.id}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        clickableRows
        onRowClick={(row) => {
          void navigate({ to: `${runsPath}/${row.original.id}` });
        }}
        infiniteScroll={{
          hasMore,
          onLoadMore: () => result.loadMore(DEFAULT_LIST_PAGE_SIZE),
          isLoadingMore: result.status === 'LoadingMore',
          isInitialLoading: result.status === 'LoadingFirstPage',
          entityLabel: {
            one: t('list.entity.one'),
            other: t('list.entity.other'),
          },
        }}
        emptyState={{
          icon: History,
          title: filtered ? t('list.noMatch') : tAutomations('runs.empty'),
        }}
        footer={
          selected.length > 0 ? (
            <div className="bg-muted/80 border-border flex items-center justify-between gap-3 rounded-lg border px-4 py-2">
              <div className="flex items-center gap-2">
                <Text as="span" variant="label" className="text-sm">
                  {t('list.selected', { count: selected.length })}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  aria-label={t('list.clear')}
                  onClick={() => setRowSelection({})}
                />
              </div>
              <Button
                size="sm"
                icon={ArrowLeftRight}
                {...(selected.length !== 2 && {
                  disabled: true,
                  disabledReason: t('list.compareDisabled'),
                })}
                onClick={() => {
                  const [a, b] = selected;
                  if (a === undefined || b === undefined) return;
                  void navigate({
                    to: `${runsPath}/compare`,
                    search: { a, b },
                  });
                }}
              >
                {t('list.compare')}
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
