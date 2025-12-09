import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { fetchQuery } from '@/lib/convex-next-server';
import { ExecutionsTable, type Execution } from './components/executions-table';
import { SuspenseLoader } from '@/components/suspense-loader';

async function ExecutionsContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; amId: Id<'wfDefinitions'> }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { amId } = await params;
  const search = await searchParams;

  // Extract filter params from URL
  const searchQuery = (search.search as string) || undefined;
  const statusFilter = (search.status as string) || undefined;
  const triggeredByFilter = (search.triggeredBy as string) || undefined;
  const dateFrom = (search.dateFrom as string) || undefined;
  const dateTo = (search.dateTo as string) || undefined;

  const executions = (await fetchQuery(api.wf_executions.listExecutions, {
    wfDefinitionId: amId,
    limit: 100,
    search: searchQuery,
    status: statusFilter,
    triggeredBy: triggeredByFilter,
    dateFrom,
    dateTo,
  })) as Execution[];

  return (
    <div className="py-6 px-4">
      <ExecutionsTable executions={executions} amId={amId} />
    </div>
  );
}

export default function ExecutionsPage(props: {
  params: Promise<{ id: string; amId: Id<'wfDefinitions'> }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <SuspenseLoader>
      <ExecutionsContent {...props} />
    </SuspenseLoader>
  );
}
