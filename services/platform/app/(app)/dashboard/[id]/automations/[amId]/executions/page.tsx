import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { preloadQuery } from '@/lib/convex-next-server';
import { ExecutionsTable } from './components/executions-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';

/** Skeleton for the executions table with header and rows - matches executions-table.tsx column sizes */
function ExecutionsSkeleton() {
  return (
    <div className="py-6 px-4">
      <DataTableSkeleton
        rows={10}
        columns={[
          { header: 'Execution ID' }, // No size = expands to fill remaining space
          { header: 'Status', size: 128 },
          { header: 'Started at', size: 192 },
          { header: 'Duration', size: 128 },
          { header: 'Triggered by', size: 128 },
        ]}
        showHeader
      />
    </div>
  );
}

interface ExecutionsContentProps {
  params: Promise<{ id: string; amId: Id<'wfDefinitions'> }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function ExecutionsContent({
  params,
  searchParams,
}: ExecutionsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { amId } = await params;
  const search = await searchParams;

  // Extract filter params from URL
  const searchQuery = (search.search as string) || undefined;
  const statusFilter = (search.status as string) || undefined;
  const triggeredByFilter = (search.triggeredBy as string) || undefined;
  const dateFrom = (search.dateFrom as string) || undefined;
  const dateTo = (search.dateTo as string) || undefined;

  // Preload executions for SSR + real-time reactivity on client
  const preloadedExecutions = await preloadQuery(
    api.wf_executions.listExecutions,
    {
      wfDefinitionId: amId,
      limit: 100,
      search: searchQuery,
      status: statusFilter,
      triggeredBy: triggeredByFilter,
      dateFrom,
      dateTo,
    },
  );

  return (
    <div className="py-6 px-4">
      <ExecutionsTable preloadedExecutions={preloadedExecutions} amId={amId} />
    </div>
  );
}

export default function ExecutionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; amId: Id<'wfDefinitions'> }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<ExecutionsSkeleton />}>
      <ExecutionsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
