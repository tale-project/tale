'use server';

import { revalidateTag } from 'next/cache';
import { cacheTags, type CacheResource } from './tags';

/**
 * Invalidate all cached data for an organization.
 * Use sparingly - prefer invalidating specific resources.
 *
 * Uses 'max' profile for stale-while-revalidate semantics:
 * - Stale content served immediately
 * - Fresh content fetched in background
 */
export async function invalidateOrg(orgId: string): Promise<void> {
  revalidateTag(cacheTags.org(orgId), 'max');
}

/**
 * Invalidate cached data for a specific resource type within an organization.
 * Also invalidates the existence check cache for that resource.
 *
 * Uses 'minutes' profile for existence checks (short TTL),
 * and 'max' for resource data (SWR semantics).
 */
export async function invalidateResource(
  orgId: string,
  resource: CacheResource,
): Promise<void> {
  revalidateTag(cacheTags.orgResource(orgId, resource), 'max');
  revalidateTag(cacheTags.orgResourceExists(orgId, resource), 'minutes');
}

/**
 * Invalidate only the existence check cache for a resource.
 * Use when adding the first item of a resource type.
 */
export async function invalidateResourceExists(
  orgId: string,
  resource: CacheResource,
): Promise<void> {
  revalidateTag(cacheTags.orgResourceExists(orgId, resource), 'minutes');
}

/**
 * Invalidate translation cache.
 * Use after translation updates (rare - usually requires redeploy).
 */
export async function invalidateTranslations(namespace?: string): Promise<void> {
  revalidateTag(cacheTags.translations(namespace), 'days');
}
