/**
 * How long a presigned file link lives, in seconds — the object store's
 * default (`DEFAULT_PRESIGN_TTL_SEC`, `backend/core/lib/storage/object_store.ts`),
 * after which the store answers the link with 403.
 *
 * The store and the app read this one value: the app's batch of file links
 * (`files/queries:getFileUrls`, `app/lib/backend/documents.ts`) renews the
 * links it keeps before they run out, and a picture whose link no longer
 * loads asks for a new one (`app/features/shared/files/use-file-link-renewal.ts`),
 * so a page left open longer than this still shows its pictures.
 */
export const FILE_LINK_LIFETIME_SEC = 15 * 60;
