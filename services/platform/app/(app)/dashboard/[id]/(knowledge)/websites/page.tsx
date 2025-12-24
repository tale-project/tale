import WebsitesTable from './websites-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { getT } from '@/lib/i18n/server';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    size?: string;
    status?: string;
  }>;
}

/** Skeleton for the websites table with header and rows - matches websites-table.tsx column sizes */
async function WebsitesSkeleton() {
  const { t } = await getT('tables');

  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.website') }, // No size = expands to fill remaining space
        { header: t('headers.title'), size: 192 },
        { header: t('headers.description'), size: 256 },
        { header: t('headers.scanned'), size: 128 },
        { header: t('headers.interval'), size: 96 },
        { isAction: true, size: 128 },
      ]}
      showHeader
      showFilters
    />
  );
}

interface WebsitesContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    size?: string;
    status?: string;
  }>;
}

async function WebsitesContent({ params, searchParams }: WebsitesContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { id: organizationId } = await params;
  const resolvedSearchParams = await searchParams;

  const currentPage = resolvedSearchParams.page
    ? parseInt(resolvedSearchParams.page)
    : 1;

  // Get page size from search params (default to 10)
  const pageSize = resolvedSearchParams.size
    ? Number.parseInt(resolvedSearchParams.size)
    : 10;

  return (
    <WebsitesTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
    />
  );
}

export default async function WebsitesPage({
  params,
  searchParams,
}: PageProps) {
  const skeletonFallback = await Promise.resolve(<WebsitesSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <WebsitesContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
