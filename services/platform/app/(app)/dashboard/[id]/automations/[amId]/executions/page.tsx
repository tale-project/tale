import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { preloadQuery } from '@/lib/convex-next-server';
import { ExecutionsTable } from './components/executions-table';
import { SuspenseLoader } from '@/components/suspense-loader';
import { TableSkeleton } from '@/components/skeletons';

/**
 * Skeleton for the executions table.
 */
function ExecutionsSkeleton() {
  return (
    <div className="py-6 px-4">
      <TableSkeleton
        rows={10}
        headers={[
          'Execution ID',
          'Status',
          'Triggered By',
          'Started',
          'Duration',
          '',
        ]}
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
    <SuspenseLoader fallback={<ExecutionsSkeleton />}>
      <ExecutionsContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
