import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { PageItemOf } from '@/app/lib/backend/contract';

/** One file the Storage meter counts. */
export type UploadUsageFile =
  PageItemOf<'documents/queries:listUploadUsageFiles'>;

/**
 * The files behind the Storage meter, largest first, a page at a time: the
 * rows the meter adds up and the upload limit counts, in Trash too.
 */
export function useUploadUsageFiles(
  organizationId: string,
  initialNumItems: number,
) {
  return useCachedPaginatedQuery(
    'documents/queries:listUploadUsageFiles',
    { organizationId },
    { initialNumItems },
  );
}
