import WebsitesTable from './websites-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    size?: string;
    status?: string;
  }>;
}

/** Skeleton for the websites table with header and rows - matches websites-table.tsx column sizes */
function WebsitesSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'Website' }, // No size = expands to fill remaining space
        { header: 'Title', size: 192 },
        { header: 'Description', size: 256 },
        { header: 'Scanned', size: 128 },
        { header: 'Interval', size: 96 },
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

export default function WebsitesPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={<WebsitesSkeleton />}>
      <WebsitesContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
