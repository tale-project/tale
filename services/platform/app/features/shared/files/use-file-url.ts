import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// `fileId` is a blob REFERENCE (a `_storage` id or an `s3:` ref) — the server
// query resolves the URL backend-aware either way.
export function useFileUrl(fileId: string | undefined, skip = false) {
  return useConvexQuery(
    api.files.queries.getFileUrl,
    !fileId || skip ? 'skip' : { fileId },
  );
}

export function useFileUrls(fileIds: string[], skip = false) {
  return useConvexQuery(
    api.files.queries.getFileUrls,
    skip || fileIds.length === 0 ? 'skip' : { fileIds },
  );
}
