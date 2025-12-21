import WebsitesTable from './websites-table';
import { SuspenseLoader } from '@/components/suspense-loader';
import { DataTableSkeleton } from '@/components/ui/data-table';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    size?: string;
    status?: string;
  }>;
}

/**
 * Skeleton for the websites page that matches the actual layout.
 */
function WebsitesPageSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'URL', width: 'w-48' },
        { header: 'Status', width: 'w-24' },
        { header: 'Pages', width: 'w-16' },
        { header: 'Last Crawled', width: 'w-28' },
        { isAction: true },
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
    <SuspenseLoader fallback={<WebsitesPageSkeleton />}>
      <WebsitesContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
