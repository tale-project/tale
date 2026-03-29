/**
 * Workflow slug utilities for URL routing.
 *
 * Workflow slugs can contain `/` for subdirectories (e.g., "general/conversation-sync").
 * TanStack Router's $amId param cannot contain slashes, so we use `__` as separator in URLs.
 */

const SLUG_SEPARATOR = '__';

/**
 * Convert a filesystem slug (with /) to a URL-safe parameter (with __).
 * "general/conversation-sync" → "general__conversation-sync"
 * "my-workflow" → "my-workflow" (no change for flat slugs)
 */
export function slugToUrlParam(slug: string): string {
  return slug.replace(/\//g, SLUG_SEPARATOR);
}

/**
 * Convert a URL parameter (with __) back to a filesystem slug (with /).
 * "general__conversation-sync" → "general/conversation-sync"
 * "my-workflow" → "my-workflow" (no change for flat slugs)
 */
export function urlParamToSlug(param: string): string {
  return param.replace(new RegExp(SLUG_SEPARATOR, 'g'), '/');
}

/**
 * Extract the base name from a workflow slug.
 * "general/conversation-sync" → "conversation-sync"
 * "my-workflow" → "my-workflow"
 */
export function getSlugBaseName(slug: string): string {
  const slashIndex = slug.lastIndexOf('/');
  if (slashIndex === -1) return slug;
  return slug.slice(slashIndex + 1);
}
