import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
export function useDeleteVendor() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Build query params from URL to match the active query
  const queryParams = useMemo(() => {
    const organizationId = params.id as string;
    const pageSize = searchParams.get('size')
      ? Number.parseInt(searchParams.get('size')!)
      : 10;
    const sourceFilters = searchParams.get('source')?.split(',').filter(Boolean);
    const localeFilters = searchParams.get('locale')?.split(',').filter(Boolean);
    const searchTerm = searchParams.get('query') || undefined;

    return {
      organizationId,
      paginationOpts: {
        numItems: pageSize,
        cursor: null,
      },
      source: sourceFilters,
      locale: localeFilters,
      searchTerm,
    };
  }, [params.id, searchParams]);

  return useMutation(api.vendors.deleteVendor).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.vendors.getVendors, queryParams);

      if (current !== undefined) {
        const updatedPage = current.page.filter(
          (vendor) => vendor._id !== args.vendorId
        );
        localStore.setQuery(api.vendors.getVendors, queryParams, {
          ...current,
          page: updatedPage,
        });
      }
    }
  );
}
