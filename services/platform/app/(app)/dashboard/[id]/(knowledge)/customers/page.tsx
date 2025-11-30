import { requireAuth } from '@/lib/auth/auth-server';
import CustomersTable from './customers-table';
import { CustomerStatus } from '@/constants/convex-enums';
import { SuspenseLoader } from '@/components/suspense-loader';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    import?: string;
    status?: string;
    query?: string;
    size?: string;
  }>;
}

async function CustomersContent({ params, searchParams }: PageProps) {
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

  // Get status filter from search params
  const status = resolvedSearchParams.status as CustomerStatus | undefined;

  // Get search term from search params
  const searchTerm = resolvedSearchParams.query;

  // Prepare query params for pagination that preserves the status filter, search term, and page size
  const baseQueryParams = new URLSearchParams();
  if (status) {
    baseQueryParams.set('status', status);
  }
  if (searchTerm) {
    baseQueryParams.set('query', searchTerm);
  }
  if (pageSize !== 10) {
    baseQueryParams.set('size', pageSize.toString());
  }
  const queryString = baseQueryParams.toString();

  return (
    <CustomersTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
      status={status}
      searchTerm={searchTerm}
      queryParams={queryString}
    />
  );
}

export default function CustomersPage(props: PageProps) {
  return (
    <SuspenseLoader>
      <CustomersContent {...props} />
    </SuspenseLoader>
  );
}
