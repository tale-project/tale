'use node';

/**
 * Re-export of the shared SOPS provider-secrets reader.
 *
 * The canonical implementation lives in `@tale/shared/utils/sops` — one source of
 * truth shared across the platform, crawler, and RAG. This thin shim keeps the
 * in-Convex import path stable for the ported knowledge actions; do not
 * re-inline the implementation here.
 *
 * `'use node'` because the shared module reaches for Node built-ins.
 */
export * from '@tale/shared/utils/sops';
