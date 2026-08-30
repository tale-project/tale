import { useConvexQuery } from '@/app/hooks/use-convex-query';

// `fileId` is a blob REFERENCE (a `_storage` id or an `s3:` ref) — the server
// query resolves the URL backend-aware either way. Pass `fileName` when the
// URL is a download target: the resolved URL then carries the real name via
// Content-Disposition, so the browser saves it instead of the storage uuid.
// Leave it off for URLs that must render inline (images, embedded previews).
export function useFileUrl(
  fileId: string | undefined,
  skip = false,
  fileName?: string,
) {
  return useConvexQuery(
    'files/queries:getFileUrl',
    !fileId || skip
      ? 'skip'
      : fileName === undefined
        ? { fileId }
        : { fileId, fileName },
  );
}

export function useFileUrls(fileIds: string[], skip = false) {
  return useConvexQuery(
    'files/queries:getFileUrls',
    skip || fileIds.length === 0 ? 'skip' : { fileIds },
  );
}
