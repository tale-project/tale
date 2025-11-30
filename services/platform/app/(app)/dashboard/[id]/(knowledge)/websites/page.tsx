import { requireAuth } from '@/lib/auth/auth-server';
import WebsitesTable from './websites-table';
import { SuspenseLoader } from '@/components/suspense-loader';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    size?: string;
    status?: string;
  }>;
}

async function WebsitesContent({ params, searchParams }: PageProps) {
  await requireAuth();

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

export default function WebsitesPage(props: PageProps) {
  return (
    <SuspenseLoader>
      <WebsitesContent {...props} />
    </SuspenseLoader>
  );
}
