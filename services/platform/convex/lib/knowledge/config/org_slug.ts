/**
 * Re-export of the shared org-slug validator.
 *
 * The canonical implementation lives in `@tale/shared/config/org-slug` — one source of
 * truth shared across the platform, crawler, and RAG. This thin shim keeps the
 * in-Convex import path stable for the ported knowledge actions; do not
 * re-inline the implementation here.
 */
export * from '@tale/shared/config/org-slug';
