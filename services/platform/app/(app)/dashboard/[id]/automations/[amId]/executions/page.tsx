import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { preloadQuery } from '@/lib/convex-next-server';
import { ExecutionsTable } from './components/executions-table';
import { ExecutionsTableSkeleton } from './components/executions-table-skeleton';
import { Suspense } from 'react';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams } from '@/lib/pagination/parse-search-params';
import { executionFilterDefinitions } from './filter-definitions';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('automationExecutions.title'),
    description: t('automationExecutions.description'),
  };
}

/** Skeleton wrapper for SSR Suspense */
function ExecutionsSkeleton() {
  return (
    <div className="py-6 px-4">
      <ExecutionsTableSkeleton />
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

  // Parse URL params using unified filter definitions
  const { filters, pagination } = parseSearchParams(
    search as Record<string, string | undefined>,
    executionFilterDefinitions,
  );

  // Preload executions for SSR + real-time reactivity on client
  // Using cursor-based pagination to avoid 16MB bytes read limit
  const preloadedExecutions = await preloadQuery(
    api.wf_executions.listExecutionsCursor,
    {
      wfDefinitionId: amId,
      numItems: pagination.pageSize,
      cursor: null, // First page, no cursor
      searchTerm: filters.query || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      triggeredBy:
        filters.triggeredBy.length > 0 ? filters.triggeredBy : undefined,
      dateFrom: filters.dateRange?.from || undefined,
      dateTo: filters.dateRange?.to || undefined,
    },
  );

  return (
    <ExecutionsTable preloadedExecutions={preloadedExecutions} amId={amId} />
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
