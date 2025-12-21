/**
 * Data Access Layer with Caching
 *
 * This module provides a centralized data access layer with built-in caching
 * for server-side data fetching. It uses Next.js 15+ caching primitives.
 *
 * ## Usage:
 *
 * ```tsx
 * // In a Server Component or cached function:
 * import { cachedConvexQuery, getCachedAuthToken } from '@/lib/data/cache';
 *
 * async function MyComponent() {
 *   'use cache';
 *   cacheLife('minutes'); // Use a cache profile from next.config.ts
 *   cacheTag('conversations', `org-${orgId}`); // Tag for invalidation
 *
 *   const token = await getCachedAuthToken();
 *   const data = await cachedConvexQuery(api.conversations.list, { orgId }, token);
 *   return <div>{data}</div>;
 * }
 * ```
 *
 * ## Invalidation:
 *
 * Use `revalidateTag('tag-name')` from 'next/cache' in Server Actions:
 *
 * ```tsx
 * 'use server';
 * import { revalidateTag } from 'next/cache';
 *
 * export async function createConversation(orgId: string) {
 *   // ... create conversation
 *   revalidateTag('conversations');
 *   revalidateTag(`org-${orgId}`);
 * }
 * ```
 *
 * ## Performance Impact:
 * - Reduces Convex query load by caching responses
 * - Enables PPR by allowing static shell + streamed dynamic content
 * - Tag-based invalidation ensures fresh data when mutations occur
 *
 * ## Verification:
 * - Check Network tab: cached responses show `x-nextjs-cache: HIT`
 * - Use `next build && next start` to see PPR in action
 * - Monitor Convex dashboard for reduced query volume
 */

import {
  fetchQuery as baseFetchQuery,
  type NextjsOptions,
} from 'convex/nextjs';
import type {
  ArgsAndOptions,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

// Re-export cache primitives for convenience
export { cacheLife, cacheTag } from 'next/cache';
export { revalidateTag, revalidatePath } from 'next/cache';

/**
 * Convex URL configuration
 *
 * For server-side requests inside Docker, we need to use an internal URL that can
 * be reached from within the container. The external SITE_URL (e.g., https://demo.tale.dev)
 * often cannot be reached from inside the container due to hairpin NAT issues.
 */
let cachedConvexHttpUrl: string | null = null;

function getConvexHttpUrl(): string {
  if (cachedConvexHttpUrl) return cachedConvexHttpUrl;

  // CONVEX_INTERNAL_URL allows specifying the internal Convex backend address
  // (e.g., http://127.0.0.1:3210) for server-side requests.
  const internalUrl = process.env.CONVEX_INTERNAL_URL;
  if (internalUrl) {
    cachedConvexHttpUrl = internalUrl.replace(/\/+$/, '');
  } else {
    // Fallback to SITE_URL-based URL (works for local dev)
    const rawSiteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const trimmed = rawSiteUrl.replace(/\/+$/, '');
    cachedConvexHttpUrl = `${trimmed}/ws_api`;
  }

  return cachedConvexHttpUrl;
}

function withDefaultUrl(options?: NextjsOptions): NextjsOptions {
  return {
    ...(options ?? {}),
    url: getConvexHttpUrl(),
    skipConvexDeploymentUrlCheck: true,
  };
}

/**
 * Execute a Convex query with caching support.
 *
 * This is designed to be used inside 'use cache' components/functions.
 * The caching behavior is controlled by the surrounding cache directives.
 *
 * @param query - The Convex query function reference
 * @param args - Arguments to pass to the query
 * @param token - Optional auth token for authenticated queries
 *
 * @example
 * ```tsx
 * async function CachedUserList({ orgId }: { orgId: string }) {
 *   'use cache';
 *   cacheLife('minutes');
 *   cacheTag('users', `org-${orgId}`);
 *
 *   const token = await getCachedAuthToken();
 *   const users = await cachedConvexQuery(
 *     api.users.list,
 *     { organizationId: orgId },
 *     token
 *   );
 *   return <UserList users={users} />;
 * }
 * ```
 */
export async function cachedConvexQuery<
  Query extends FunctionReference<'query'>,
>(
  query: Query,
  args: Query extends FunctionReference<'query', 'public', infer Args>
    ? Args
    : never,
  token?: string,
): Promise<FunctionReturnType<Query>> {
  const options = token ? { ...withDefaultUrl(), token } : withDefaultUrl();

  try {
    return await baseFetchQuery(query, args ?? {}, options);
  } catch (error) {
    // Log for debugging but don't expose internal details
    console.error('[data/cache] Query failed:', {
      query: query.toString(),
      hasToken: !!token,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Cache tags for common entities.
 * Use these as constants to ensure consistent tag naming across the app.
 *
 * @example
 * ```tsx
 * cacheTag(CACHE_TAGS.CONVERSATIONS, CACHE_TAGS.forOrg(orgId));
 * ```
 */
export const CACHE_TAGS = {
  // Entity tags
  CONVERSATIONS: 'conversations',
  CUSTOMERS: 'customers',
  PRODUCTS: 'products',
  DOCUMENTS: 'documents',
  AUTOMATIONS: 'automations',
  APPROVALS: 'approvals',
  MEMBERS: 'members',
  ORGANIZATIONS: 'organizations',

  // Dynamic tag generators
  forOrg: (orgId: string) => `org-${orgId}`,
  forUser: (userId: string) => `user-${userId}`,
  forEntity: (type: string, id: string) => `${type}-${id}`,
} as const;
