'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, usePreloadedQuery } from 'convex/react';
import { Search, X, Copy, Check } from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { type Preloaded } from '@/lib/convex-next-server';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ExecutionsFilterDropdown, {
  ExecutionsFilterState,
} from './executions-filter-dropdown';
import { JsonViewer } from '@/components/ui/json-viewer';

interface ExecutionsTableProps {
  preloadedExecutions: Preloaded<typeof api.wf_executions.listExecutions>;
  amId: Id<'wfDefinitions'>;
}

export interface Execution {
  _id: Id<'wfExecutions'>;
  status: string;
  startedAt: number;
  completedAt?: number;
  triggeredBy?: string;
  waitingFor?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  variables?: string; // JSON string from Convex; parsed on the client
  error?: string;
  metadata?: string; // JSON string that needs parsing
  componentWorkflowId?: string;
}

// Component to display all execution details in a single viewer
function ExecutionDetails({ execution }: { execution: Execution }) {
  const journal = useQuery(
    api.wf_executions.getExecutionStepJournal,
    execution._id ? { executionId: execution._id } : 'skip',
  );

  const metadata = execution.metadata
    ? (() => {
        try {
          return JSON.parse(execution.metadata);
        } catch {
          return {};
        }
      })()
    : undefined;

  // Parse variables JSON and transform to exclude steps (since they are shown separately)
  const parsedVariables: Record<string, unknown> | undefined =
    execution.variables
      ? (() => {
          try {
            return JSON.parse(execution.variables) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const variables = parsedVariables
    ? (() => {
        const { steps, ...rest } = parsedVariables as Record<string, unknown>;
        return Object.keys(rest).length > 0 ? rest : undefined;
      })()
    : undefined;

  // Transform journal array to object keyed by stepSlug and flatten structure
  const steps = journal
    ? (() => {
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
            const stepVar = (
              (parsedVariables as any).steps as Record<string, any>
            )[stepSlug];
            if (stepVar && typeof stepVar === 'object' && 'output' in stepVar) {
              entry.output = stepVar.output;
            }
          }

          logs[key] = entry;
        });
        return logs;
      })()
    : undefined;

  const data = {
    ...(execution.error && { error: execution.error }),
    ...(execution.input && { input: execution.input }),
    ...(execution.output && { output: execution.output }),
    ...(variables && { variables }),
    ...(metadata && { metadata }),
    ...(steps && { steps }),
  };

  return (
    <JsonViewer
      enableClipboard
      collapsed={2}
      className="rounded-b-xl border border-t-0"
      data={data}
    />
  );
}

export function ExecutionsTable({
  preloadedExecutions,
  amId,
}: ExecutionsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Read from searchParams hook
  const searchQuery = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || 'All';
  const triggeredByFilter = searchParams.get('triggeredBy') || 'All';
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');

  // Use preloaded data with real-time reactivity
  const preloadedData = usePreloadedQuery(preloadedExecutions) as Execution[];

  // Fetch executions reactively when filters change from initial state
  const liveExecutions = useQuery(api.wf_executions.listExecutions, {
    wfDefinitionId: amId,
    limit: 100,
    search: searchQuery || undefined,
    status: statusFilter === 'All' ? undefined : statusFilter,
    triggeredBy: triggeredByFilter === 'All' ? undefined : triggeredByFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }) as Execution[] | undefined;

  // Use live data if available, otherwise fall back to preloaded data
  const executions = liveExecutions ?? preloadedData;

  // Local state for filters (before applying)
  const [localFilters, setLocalFilters] = useState<ExecutionsFilterState>({
    status: statusFilter,
    triggeredBy: triggeredByFilter,
    dateFrom,
    dateTo,
  });

  // Local search state for debouncing
  const [searchInput, setSearchInput] = useState(searchQuery);

  // Get unique triggeredBy values for filter options
  const triggeredByOptions = useMemo<string[]>(() => {
    const unique = new Set<string>(
      executions
        .map((e: Execution) => e.triggeredBy || 'unknown')
        .filter(Boolean),
    );
    return Array.from(unique).sort();
  }, [executions]);

  // Keep filters in sync with URL (for browser back/forward)
  useEffect(() => {
    setLocalFilters({
      status: statusFilter,
      triggeredBy: triggeredByFilter,
      dateFrom,
      dateTo,
    });
  }, [statusFilter, triggeredByFilter, dateFrom, dateTo]);

  // Keep searchInput in sync with URL
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      updateSearchParam('search', searchInput || null);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Update URL search params
  const updateSearchParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const updateMultipleParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'All') count++;
    if (triggeredByFilter !== 'All') count++;
    if (dateFrom || dateTo) count++;
    return count;
  }, [statusFilter, triggeredByFilter, dateFrom, dateTo]);

  const handleFiltersChange = (newFilters: ExecutionsFilterState) => {
    setLocalFilters(newFilters);
    updateMultipleParams({
      status: newFilters.status === 'All' ? null : newFilters.status,
      triggeredBy:
        newFilters.triggeredBy === 'All' ? null : newFilters.triggeredBy,
      dateFrom: newFilters.dateFrom,
      dateTo: newFilters.dateTo,
    });
  };

  const clearFilters = () => {
    setSearchInput('');
    setLocalFilters({
      status: 'All',
      triggeredBy: 'All',
      dateFrom: null,
      dateTo: null,
    });
    updateMultipleParams({
      search: null,
      status: null,
      triggeredBy: null,
      dateFrom: null,
      dateTo: null,
    });
  };

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    const variants: Record<
      string,
      'green' | 'destructive' | 'blue' | 'outline'
    > = {
      completed: 'green',
      failed: 'destructive',
      running: 'blue',
      pending: 'outline',
    };

    return (
      <Badge
        dot
        variant={variants[status] || 'outline'}
        className="capitalize text-xs"
      >
        {status}
      </Badge>
    );
  }, []);

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

  const calculateDuration = useCallback((execution: Execution) => {
    if (execution.status === 'running') {
      return 'Running...';
    }
    if (execution.completedAt && execution.startedAt) {
      const duration = execution.completedAt - execution.startedAt;
      return `${duration.toLocaleString()}ms`;
    }
    return '-';
  }, []);

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Execution>[]>(
    () => [
      {
        accessorKey: '_id',
        header: 'Execution ID',
        size: 160,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
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
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 128,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'startedAt',
        header: 'Started at',
        size: 192,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatTimestampWithMillis(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: 'duration',
        header: 'Duration',
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {calculateDuration(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'triggeredBy',
        header: 'Triggered by',
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.triggeredBy || '-'}
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
    ],
  );

  // Render expanded row content
  const renderExpandedRow = useCallback(
    (row: Row<Execution>) => <ExecutionDetails execution={row.original} />,
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={executions}
      getRowId={(row) => row._id}
      enableExpanding
      renderExpandedRow={renderExpandedRow}
      header={
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative w-[18.75rem]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
              <Input
                placeholder="Search executions..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10"
              />
            </div>

            <ExecutionsFilterDropdown
              filters={localFilters}
              onFiltersChange={handleFiltersChange}
              triggeredByOptions={triggeredByOptions}
            />
          </div>

          <div className="flex items-center gap-3">
            {(searchInput || activeFiltersCount > 0) && (
              <Button variant="ghost" onClick={clearFilters} className="gap-2">
                <X className="size-4" />
                Clear all
              </Button>
            )}
          </div>
        </div>
      }
      emptyState={{
        title: 'No executions found',
        description: 'Try adjusting your search or filters',
        isFiltered: true,
      }}
    />
  );
}
