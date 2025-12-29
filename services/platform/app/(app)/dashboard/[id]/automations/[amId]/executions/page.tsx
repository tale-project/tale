import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { preloadQuery } from '@/lib/convex-next-server';
import { ExecutionsTable } from './components/executions-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { HStack } from '@/components/ui/layout';
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

/** Skeleton for the executions table with header and rows - matches ExecutionsTable layout */
async function ExecutionsSkeleton() {
  const { t } = await getT('automations');
  return (
    <div className="py-6 px-4">
      <DataTableSkeleton
        rows={10}
        columns={[
          { header: t('executions.columns.executionId'), size: 160 },
          { header: t('executions.columns.status'), size: 128 },
          { header: t('executions.columns.startedAt'), size: 192 },
          { header: t('executions.columns.duration'), size: 128 },
          { header: t('executions.columns.triggeredBy'), size: 128 },
        ]}
        showHeader
        customHeader={
          <HStack gap={4} className="justify-between">
            <HStack gap={3}>
              <Skeleton className="h-10 w-[18.75rem]" />
              <Skeleton className="h-10 w-24" />
            </HStack>
          </HStack>
        }
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

  // Parse URL params using unified filter definitions
  const { filters, pagination } = parseSearchParams(
    search as Record<string, string | undefined>,
    executionFilterDefinitions,
  );

  // Preload executions for SSR + real-time reactivity on client
  const preloadedExecutions = await preloadQuery(
    api.wf_executions.listExecutionsPaginated,
    {
      wfDefinitionId: amId,
      currentPage: pagination.page,
      pageSize: pagination.pageSize,
      searchTerm: filters.query || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      triggeredBy:
        filters.triggeredBy.length > 0 ? filters.triggeredBy : undefined,
      dateFrom: filters.dateRange?.from || undefined,
      dateTo: filters.dateRange?.to || undefined,
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
