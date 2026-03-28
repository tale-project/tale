/**
 * Workflow slug utilities for URL routing.
 *
 * Workflow slugs can contain `/` for subdirectories (e.g., "general/conversation-sync").
 * TanStack Router's $amId param cannot contain slashes, so we use `--` as separator in URLs.
 */

const SLUG_SEPARATOR = '--';

/**
 * Convert a filesystem slug (with /) to a URL-safe parameter (with --).
 * "general/conversation-sync" → "general--conversation-sync"
 * "my-workflow" → "my-workflow" (no change for flat slugs)
 */
export function slugToUrlParam(slug: string): string {
  return slug.replace(/\//g, SLUG_SEPARATOR);
}

/**
 * Convert a URL parameter (with --) back to a filesystem slug (with /).
 * "general--conversation-sync" → "general/conversation-sync"
 * "my-workflow" → "my-workflow" (no change for flat slugs)
 */
export function urlParamToSlug(param: string): string {
  return param.replace(new RegExp(SLUG_SEPARATOR, 'g'), '/');
}

/**
 * Extract the folder name from a workflow slug.
 * "general/conversation-sync" → "general"
 * "my-workflow" → undefined (no folder)
 */
export function getSlugFolder(slug: string): string | undefined {
  const slashIndex = slug.indexOf('/');
  if (slashIndex === -1) return undefined;
  return slug.substring(0, slashIndex);
}

/**
 * Extract the base name from a workflow slug.
 * "general/conversation-sync" → "conversation-sync"
 * "my-workflow" → "my-workflow"
 */
export function getSlugBaseName(slug: string): string {
  const slashIndex = slug.lastIndexOf('/');
  if (slashIndex === -1) return slug;
  return slug.substring(slashIndex + 1);
}
