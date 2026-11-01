'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { isAutomationSubject } from '@/lib/shared/constants/usage';

export interface UserRow {
  userId: string;
  displayName: string;
  teamId: string | null;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
  requests: number;
  /** An API key's own identity, not a person: what the key belongs to. */
  apiKey?: {
    kind: 'team' | 'project' | 'organization';
    teamName: string | null;
    projectName: string | null;
  };
}

/** The row's name, as its first line says it: runs a trigger started book
 * under one id the table names rather than shows. */
function userLabel(row: UserRow, t: ReturnType<typeof useT>['t']): string {
  return isAutomationSubject(row.userId)
    ? t('usage.tables.users.automations')
    : row.displayName;
}

/** What an API key that is not a person belongs to, as the row's second
 * line says it. */
function apiKeyLabel(
  apiKey: NonNullable<UserRow['apiKey']>,
  t: ReturnType<typeof useT>['t'],
): string {
  switch (apiKey.kind) {
    case 'team':
      return t('usage.tables.users.teamKey', { name: apiKey.teamName ?? '—' });
    case 'project':
      return t('usage.tables.users.projectKey', {
        name: apiKey.projectName ?? '—',
      });
    default:
      return t('usage.tables.users.organizationKey');
  }
}

interface UsersTableProps {
  rows: UserRow[];
  isLoading: boolean;
  /** The read the rows answer, by its period and facets: a new one starts
   *  the display window over. */
  windowKey?: string;
}

export function UsersTable({ rows, isLoading, windowKey }: UsersTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Keep the total ≤ 940px so the table fits the settings content column on
  // common laptop widths instead of clipping behind a horizontal scroll.
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: 'user',
        header: t('usage.tables.users.user'),
        cell: ({ row }) => (
          <div className="flex max-w-[220px] min-w-0 flex-col">
            <Text as="span" variant="label" className="block truncate text-sm">
              {userLabel(row.original, t)}
            </Text>
            {row.original.apiKey !== undefined && (
              <Text as="span" variant="muted" className="truncate text-xs">
                {apiKeyLabel(row.original.apiKey, t)}
              </Text>
            )}
          </div>
        ),
        size: 220,
      },
      {
        id: 'inputTokens',
        header: () => (
          <div className="text-right">
            {t('usage.tables.users.inputTokens')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.inputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
      {
        id: 'outputTokens',
        header: () => (
          <div className="text-right">
            {t('usage.tables.users.outputTokens')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.outputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 136,
      },
      {
        id: 'cost',
        header: () => (
          <div className="text-right">{t('usage.tables.users.cost')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCostCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
      {
        id: 'requests',
        header: () => (
          <div className="text-right">{t('usage.tables.users.requests')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.requests)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
    ],
    [t, formatNumber, formatCostCents],
  );

  // The server sends every user and API key of the period, cost first. Like
  // the other settings lists, the table shows a window of them that grows as
  // the reader scrolls, and its search matches what the User cell shows.
  const list = useListPage<UserRow>({
    dataSource: { type: 'query', data: rows },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    windowKey,
    search: {
      fields: [
        (row) => userLabel(row, t),
        (row) => (row.apiKey ? apiKeyLabel(row.apiKey, t) : undefined),
      ],
      placeholder: t('usage.tables.users.searchPlaceholder'),
    },
    getRowId: (row) => `${row.userId}-${row.teamId ?? ''}`,
    approxRowCount: isLoading ? 5 : rows.length,
    entityLabel: {
      one: t('usage.tables.users.entityLabelOne'),
      other: t('usage.tables.users.entityLabel'),
    },
  });

  return (
    <MetricsSection title={t('usage.tables.users.title')}>
      {/* No `stickyLayout`: the table sits in the scrolling metrics page. */}
      <DataTable
        columns={columns}
        isLoading={isLoading}
        emptyState={{
          icon: BarChart3,
          title: t('usage.empty.title'),
          description: t('usage.empty.description'),
        }}
        {...list.tableProps}
      />
      <Text as="p" variant="muted">
        {t('usage.tables.users.note')}
      </Text>
    </MetricsSection>
  );
}
