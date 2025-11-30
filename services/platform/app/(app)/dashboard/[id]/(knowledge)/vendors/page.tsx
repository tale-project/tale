import { requireAuth } from '@/lib/auth/auth-server';
import VendorsTable from './vendors-table';
import { SuspenseLoader } from '@/components/suspense-loader';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

async function VendorsContent({ params, searchParams }: PageProps) {
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

  // Get search term from search params
  const searchTerm = resolvedSearchParams.query;

  // Prepare query params for pagination that preserves filters
  const baseQueryParams = new URLSearchParams();
  if (searchTerm) {
    baseQueryParams.set('query', searchTerm);
  }
  if (resolvedSearchParams.source) {
    baseQueryParams.set('source', resolvedSearchParams.source);
  }
  if (resolvedSearchParams.locale) {
    baseQueryParams.set('locale', resolvedSearchParams.locale);
  }
  if (pageSize !== 10) {
    baseQueryParams.set('size', pageSize.toString());
  }
  const queryString = baseQueryParams.toString();

  return (
    <VendorsTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
      searchTerm={searchTerm}
      queryParams={queryString}
    />
  );
}

export default function VendorsPage(props: PageProps) {
  return (
    <SuspenseLoader>
      <VendorsContent {...props} />
    </SuspenseLoader>
  );
}
