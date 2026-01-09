'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useQuery } from 'convex/react';
import { Copy, Check } from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { parseISO, formatISO } from 'date-fns';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { type Preloaded } from '@/lib/convex-next-server';
import { DataTable } from '@/components/ui/data-table';
import { HStack } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/ui/json-viewer';
import { useT, useLocale } from '@/lib/i18n';
import { formatDuration } from '@/lib/utils/format/number';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { executionFilterDefinitions } from '../filter-definitions';
import { useExecutionsTableConfig } from './use-executions-table-config';

interface ExecutionsTableProps {
  preloadedExecutions: Preloaded<
    typeof api.wf_executions.listExecutionsCursor
  >;
  amId: Id<'wfDefinitions'>;
}

// Status badge variants - defined outside component to avoid recreation
const STATUS_BADGE_VARIANTS: Record<
  string,
  'green' | 'destructive' | 'blue' | 'outline'
> = {
  completed: 'green',
  failed: 'destructive',
  running: 'blue',
  pending: 'outline',
};

export interface Execution {
  _id: Id<'wfExecutions'>;
  status: string;
  startedAt: number;
  completedAt?: number;
  triggeredBy?: string;
  waitingFor?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  variables?: string;
  error?: string;
  metadata?: string;
  componentWorkflowId?: string;
}

// Component to display all execution details in a single viewer
const ExecutionDetails = memo(function ExecutionDetails({
  execution,
}: {
  execution: Execution;
}) {
  const journal = useQuery(
    api.wf_executions.getExecutionStepJournal,
    execution._id ? { executionId: execution._id } : 'skip',
  );

  // Memoize parsed metadata and variables to avoid JSON parsing on every render
  const { metadata, parsedVariables, variables } = useMemo(() => {
    const meta = execution.metadata
      ? (() => {
          try {
            return JSON.parse(execution.metadata);
          } catch {
            return {};
          }
        })()
      : undefined;

    const parsed: Record<string, unknown> | undefined = execution.variables
      ? (() => {
          try {
            return JSON.parse(execution.variables) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const vars = parsed
      ? (() => {
          const { steps: _steps, ...rest } = parsed as Record<string, unknown>;
          return Object.keys(rest).length > 0 ? rest : undefined;
        })()
      : undefined;

    return { metadata: meta, parsedVariables: parsed, variables: vars };
  }, [execution.metadata, execution.variables]);

  // Transform journal array to object keyed by stepSlug and flatten structure
  const steps = useMemo(() => {
    if (!journal) return undefined;

    const logs: Record<string, any> = {};
    journal.forEach((log: any) => {
      const stepSlug = log.step?.args?.stepSlug;
      let key = log._id;

      if (stepSlug) {
        key = stepSlug;
      } else {
        // Try to derive a readable key from the step name for system steps
        // e.g. "workflow/core/mark_execution_completed:markExecutionCompleted" -> "markExecutionCompleted"
        if (log.step?.name && typeof log.step.name === 'string') {
          const parts = log.step.name.split(':');
          if (parts.length > 1) {
            key = parts[parts.length - 1];
          }
        }
      }

      // Flatten: merge log and log.step, remove log.step
      const { step, ...restLog } = log;
      const entry = { ...restLog, ...step };

      // Enrich with output from variables if available
      if (stepSlug && parsedVariables && (parsedVariables as any).steps) {
        const stepVar = ((parsedVariables as any).steps as Record<string, any>)[
          stepSlug
        ];
        if (stepVar && typeof stepVar === 'object' && 'output' in stepVar) {
          entry.output = stepVar.output;
        }
      }

      logs[key] = entry;
    });
    return logs;
  }, [journal, parsedVariables]);

  const data = useMemo(
    () => ({
      ...(execution.error && { error: execution.error }),
      ...(execution.input && { input: execution.input }),
      ...(execution.output && { output: execution.output }),
      ...(variables && { variables }),
      ...(metadata && { metadata }),
      ...(steps && { steps }),
    }),
    [
      execution.error,
      execution.input,
      execution.output,
      variables,
      metadata,
      steps,
    ],
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

export function ExecutionsTable({
  preloadedExecutions,
  amId,
}: ExecutionsTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const locale = useLocale();
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  // Use shared table config (columns defined locally due to interactive elements)
  const {
    searchPlaceholder,
    stickyLayout,
    pageSize,
  } = useExecutionsTableConfig();

  // Use unified URL filters hook (without sorting for cursor-based pagination)
  const {
    filters: filterValues,
    setFilter,
    clearAll,
    isPending,
  } = useUrlFilters({
    filters: executionFilterDefinitions,
    pagination: { defaultPageSize: pageSize },
  });

  // Build query args for cursor-based pagination
  const queryArgs = useMemo(
    () => ({
      wfDefinitionId: amId,
      searchTerm: filterValues.query || undefined,
      status: filterValues.status.length > 0 ? filterValues.status : undefined,
      triggeredBy:
        filterValues.triggeredBy.length > 0
          ? filterValues.triggeredBy
          : undefined,
      dateFrom: filterValues.dateRange?.from || undefined,
      dateTo: filterValues.dateRange?.to || undefined,
    }),
    [amId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: executions, isLoading, isLoadingMore, hasMore, loadMore } =
    useCursorPaginatedQuery({
      query: api.wf_executions.listExecutionsCursor,
      preloadedData: preloadedExecutions,
      args: queryArgs,
      numItems: pageSize,
    });

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const getStatusBadge = useCallback(
    (status: string) => (
      <Badge
        dot
        variant={STATUS_BADGE_VARIANTS[status] || 'outline'}
        className="capitalize text-xs"
      >
        {status}
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

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Execution>[]>(
    () => [
      {
        accessorKey: '_id',
        header: tTables('headers.executionId'),
        size: 160,
        cell: ({ row }) => (
          <HStack gap={2}>
            <span
              className="font-mono text-xs truncate"
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
                <Check className="size-4 text-success p-0.5" />
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
          <span className="text-xs text-muted-foreground">
            {formatTimestampWithMillis(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: 'duration',
        header: tTables('headers.duration'),
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {calculateDuration(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'triggeredBy',
        header: tTables('headers.triggeredBy'),
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
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

  // Build filter configs for DataTableFilters component
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
        selectedValues: filterValues.status,
        onChange: (values: string[]) => setFilter('status', values),
      },
    ],
    [filterValues, setFilter, tTables, tCommon],
  );

  // Render expanded row content
  const renderExpandedRow = useCallback(
    (row: Row<Execution>) => <ExecutionDetails execution={row.original} />,
    [],
  );

  // Handle date range change
  const handleDateRangeChange = useCallback(
    (range: { from?: Date; to?: Date } | undefined) => {
      setFilter('dateRange', {
        from: range?.from
          ? formatISO(range.from, { representation: 'date' })
          : undefined,
        to: range?.to
          ? formatISO(range.to, { representation: 'date' })
          : undefined,
      });
    },
    [setFilter],
  );

  // Loading state is handled by the hook
  if (isLoading) {
    return null; // Let the Suspense boundary handle the loading state
  }

  return (
    <DataTable
      className="py-6 px-4"
      columns={columns}
      data={executions as Execution[]}
      getRowId={(row) => row._id}
      enableExpanding
      renderExpandedRow={renderExpandedRow}
      stickyLayout={stickyLayout}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      dateRange={{
        from: filterValues.dateRange?.from
          ? parseISO(filterValues.dateRange.from)
          : undefined,
        to: filterValues.dateRange?.to
          ? parseISO(filterValues.dateRange.to)
          : undefined,
        onChange: handleDateRangeChange,
      }}
      emptyState={{
        title: tCommon('search.noResults'),
        description: tCommon('search.tryAdjusting'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}
