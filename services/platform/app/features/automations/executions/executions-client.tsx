'use client';

import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { parseISO, formatISO } from 'date-fns';
import { Copy, Check } from 'lucide-react';
import { useState, useMemo, useCallback, memo } from 'react';

import type { Doc, Id } from '@/convex/_generated/dataModel';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useListPage } from '@/app/hooks/use-list-page';
import { useLocale } from '@/app/hooks/use-locale';
import { useT } from '@/lib/i18n/client';
import { formatDuration } from '@/lib/utils/format/number';

import { useExecutionJournal, useListExecutions } from '../hooks/queries';
import { ExecutionsTableSkeleton } from './executions-table-skeleton';
import { useExecutionsTableConfig } from './use-executions-table-config';

interface ExecutionsClientProps {
  amId: Id<'wfDefinitions'>;
  organizationId: string;
  searchTerm?: string;
  status?: string[];
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

const STATUS_BADGE_VARIANTS: Record<
  string,
  'green' | 'destructive' | 'blue' | 'outline'
> = {
  completed: 'green',
  failed: 'destructive',
  running: 'blue',
  pending: 'outline',
};

type Execution = Doc<'wfExecutions'>;

const ExecutionDetails = memo(function ExecutionDetails({
  execution,
}: {
  execution: Execution;
}) {
  const { data: journal, error: journalError } = useExecutionJournal(
    execution._id,
  );

  const {
    metadata,
    parsedVariables,
    variables: _variables,
  } = useMemo(() => {
    const meta = execution.metadata
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(execution.metadata);
            return parsed;
          } catch {
            return execution.metadata;
          }
        })()
      : null;

    const vars = execution.variables;
    let parsedVars: unknown = null;
    if (vars) {
      try {
        parsedVars = JSON.parse(vars);
      } catch {
        parsedVars = vars;
      }
    }

    return { metadata: meta, parsedVariables: parsedVars, variables: vars };
  }, [execution.metadata, execution.variables]);

  const data = useMemo(
    () => ({
      execution: {
        id: execution._id,
        status: execution.status,
        startedAt: new Date(execution.startedAt).toISOString(),
        completedAt: execution.completedAt
          ? new Date(execution.completedAt).toISOString()
          : null,
        triggeredBy: execution.triggeredBy,
        error: execution.error,
      },
      metadata: metadata,
      variables: parsedVariables,
      journal: journal ?? [],
      ...(journalError ? { journalError: journalError.message } : {}),
    }),
    [execution, metadata, parsedVariables, journal, journalError],
  );

  return (
    <JsonViewer
      enableClipboard
      collapsed={2}
      className="rounded-b-xl border border-t-0"
      data={data}
    />
  );
});

export function ExecutionsClient({
  amId,
  organizationId,
  searchTerm,
  status,
  triggeredBy,
  dateFrom,
  dateTo,
}: ExecutionsClientProps) {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { locale } = useLocale();
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const { searchPlaceholder, stickyLayout, pageSize } =
    useExecutionsTableConfig();

  const queryArgs = useMemo(
    () => ({
      wfDefinitionId: amId,
      searchTerm: searchTerm || undefined,
      status: status && status.length > 0 ? status : undefined,
      triggeredBy: triggeredBy || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      cursor: undefined,
      numItems: pageSize,
    }),
    [amId, searchTerm, status, triggeredBy, dateFrom, dateTo, pageSize],
  );

  const { data: executionsResult } = useListExecutions(queryArgs);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex codegen TS2589 collapses query return type
  const allExecutions = useMemo(
    () => executionsResult?.page ?? [],
    [executionsResult],
  );

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const getStatusBadge = useCallback(
    (statusVal: string) => (
      <Badge
        dot
        variant={STATUS_BADGE_VARIANTS[statusVal] || 'outline'}
        className="text-xs capitalize"
      >
        {statusVal}
      </Badge>
    ),
    [],
  );

  const formatTimestampWithMillis = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
  }, []);

  const calculateDuration = useCallback(
    (execution: Execution) => {
      if (execution.status === 'running') {
        return tCommon('actions.loading');
      }
      if (execution.completedAt && execution.startedAt) {
        const duration = execution.completedAt - execution.startedAt;
        return formatDuration(duration, locale);
      }
      return tTables('cells.empty');
    },
    [tCommon, tTables, locale],
  );

  const columns = useMemo<ColumnDef<Execution>[]>(
    () => [
      {
        accessorKey: '_id',
        header: tTables('headers.executionId'),
        size: 160,
        cell: ({ row }) => (
          <HStack gap={2}>
            <span
              className="truncate font-mono text-xs"
              title={row.original._id}
            >
              {row.original._id}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="p-1"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(row.original._id);
              }}
            >
              {copiedId === row.original._id ? (
                <Check className="text-success size-4 p-0.5" />
              ) : (
                <Copy className="size-4 p-0.5" />
              )}
            </Button>
          </HStack>
        ),
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 128,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'startedAt',
        header: tTables('headers.startedAt'),
        size: 192,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {formatTimestampWithMillis(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: 'duration',
        header: () => (
          <span className="block w-full text-right">
            {tTables('headers.duration')}
          </span>
        ),
        size: 128,
        cell: ({ row }) => (
          <span className="text-muted-foreground block w-full text-right text-xs">
            {calculateDuration(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'triggeredBy',
        header: tTables('headers.triggeredBy'),
        size: 128,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.triggeredBy || tTables('cells.empty')}
          </span>
        ),
      },
    ],
    [
      copiedId,
      copyToClipboard,
      getStatusBadge,
      formatTimestampWithMillis,
      calculateDuration,
      tTables,
    ],
  );

  const handleSearchChange = (value: string) => {
    void navigate({
      to: '/dashboard/$id/automations/$amId/executions',
      params: { id: organizationId, amId },
      search: {
        query: value || undefined,
        status: status?.[0],
        triggeredBy: triggeredBy,
        dateFrom,
        dateTo,
      },
    });
  };

  const handleStatusChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/automations/$amId/executions',
        params: { id: organizationId, amId },
        search: {
          query: searchTerm,
          status: values[0] || undefined,
          triggeredBy: triggeredBy,
          dateFrom,
          dateTo,
        },
      });
    },
    [navigate, organizationId, amId, searchTerm, triggeredBy, dateFrom, dateTo],
  );

  const handleTriggeredByChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/automations/$amId/executions',
        params: { id: organizationId, amId },
        search: {
          query: searchTerm,
          status: status?.[0],
          triggeredBy: values[0] || undefined,
          dateFrom,
          dateTo,
        },
      });
    },
    [navigate, organizationId, amId, searchTerm, status, dateFrom, dateTo],
  );

  const handleDateRangeChange = (
    range: { from?: Date; to?: Date } | undefined,
  ) => {
    void navigate({
      to: '/dashboard/$id/automations/$amId/executions',
      params: { id: organizationId, amId },
      search: {
        query: searchTerm,
        status: status?.[0],
        triggeredBy: triggeredBy,
        dateFrom: range?.from
          ? formatISO(range.from, { representation: 'date' })
          : undefined,
        dateTo: range?.to
          ? formatISO(range.to, { representation: 'date' })
          : undefined,
      },
    });
  };

  const handleClearFilters = () => {
    void navigate({
      to: '/dashboard/$id/automations/$amId/executions',
      params: { id: organizationId, amId },
      search: {},
    });
  };

  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'running', label: tCommon('status.running') },
          { value: 'completed', label: tCommon('status.completed') },
          { value: 'failed', label: tCommon('status.failed') },
          { value: 'pending', label: tCommon('status.pending') },
        ],
        selectedValues: status ?? [],
        onChange: handleStatusChange,
      },
      {
        key: 'triggeredBy',
        title: tTables('headers.triggeredBy'),
        multiSelect: false,
        options: [
          { value: 'schedule', label: tCommon('triggerSource.schedule') },
          { value: 'manual', label: tCommon('triggerSource.manual') },
          { value: 'event', label: tCommon('triggerSource.event') },
          { value: 'webhook', label: tCommon('triggerSource.webhook') },
          { value: 'api', label: tCommon('triggerSource.api') },
          { value: 'system', label: tCommon('triggerSource.system') },
        ],
        selectedValues: triggeredBy ? [triggeredBy] : [],
        onChange: handleTriggeredByChange,
      },
    ],
    [
      status,
      triggeredBy,
      tTables,
      tCommon,
      handleStatusChange,
      handleTriggeredByChange,
    ],
  );

  const list = useListPage({
    dataSource: {
      type: 'query',
      data: executionsResult === undefined ? undefined : allExecutions,
    },
    pageSize,
    search: {
      value: searchTerm ?? '',
      onChange: handleSearchChange,
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
  });

  const renderExpandedRow = useCallback(
    (row: Row<Execution>) => <ExecutionDetails execution={row.original} />,
    [],
  );

  if (executionsResult === undefined) {
    return <ExecutionsTableSkeleton />;
  }

  return (
    <DataTable<Execution>
      className="px-4 py-6"
      columns={columns}
      enableExpanding
      renderExpandedRow={renderExpandedRow}
      stickyLayout={stickyLayout}
      dateRange={{
        from: dateFrom ? parseISO(dateFrom) : undefined,
        to: dateTo ? parseISO(dateTo) : undefined,
        onChange: handleDateRangeChange,
        presets: ['today', 'last7Days', 'last30Days', 'allTime'],
      }}
      emptyState={{
        title: tCommon('search.noResults'),
        description: tCommon('search.tryAdjusting'),
      }}
      {...list.tableProps}
    />
  );
}
