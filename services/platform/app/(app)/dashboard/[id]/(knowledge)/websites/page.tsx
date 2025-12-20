import WebsitesTable from './websites-table';
import { SuspenseLoader } from '@/components/suspense-loader';
import { TableSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

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
    <>
      {/* Actions bar skeleton */}
      <div className="flex items-center justify-end gap-4 mb-4">
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      {/* Table skeleton */}
      <TableSkeleton
        rows={10}
        headers={['URL', 'Status', 'Pages', 'Last Crawled', '']}
      />
    </>
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

  // Prepare query params for pagination that preserves filters
  const baseQueryParams = new URLSearchParams();
  if (resolvedSearchParams.status) {
    baseQueryParams.set('status', resolvedSearchParams.status);
  }
  if (pageSize !== 10) {
    baseQueryParams.set('size', pageSize.toString());
  }
  const queryString = baseQueryParams.toString();

  return (
    <WebsitesTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
      queryParams={queryString}
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
