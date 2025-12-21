import {
  fetchQuery as baseFetchQuery,
  fetchMutation as baseFetchMutation,
  fetchAction as baseFetchAction,
  preloadQuery as basePreloadQuery,
  preloadedQueryResult as basePreloadedQueryResult,
  type NextjsOptions,
} from 'convex/nextjs';
import type {
  ArgsAndOptions,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import type { Preloaded } from 'convex/react';

// Re-export Preloaded type for use in component props
export type { Preloaded } from 'convex/react';

// Re-export preloadedQueryResult for extracting data from preloaded queries in server components
export const preloadedQueryResult = basePreloadedQueryResult;

let cachedConvexHttpUrl: string | null = null;

function getConvexHttpUrl(): string {
  if (cachedConvexHttpUrl) return cachedConvexHttpUrl;

  // For server-side requests, we need to use an internal URL that can be
  // reached from within the Docker container. The external SITE_URL (e.g.,
  // https://demo.tale.dev) often cannot be reached from inside the container
  // due to network/DNS issues (the container can't route back to itself).
  //
  // CONVEX_INTERNAL_URL allows specifying the internal Convex backend address
  // (e.g., http://127.0.0.1:3210) for server-side requests.
  //
  // If not set, we fall back to ${SITE_URL}/ws_api which works for local
  // development but may fail in production Docker deployments.
  const internalUrl = process.env.CONVEX_INTERNAL_URL;
  if (internalUrl) {
    cachedConvexHttpUrl = internalUrl.replace(/\/+$/, '');
  } else {
    // Fallback to SITE_URL-based URL (works for local dev)
    const rawSiteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const trimmed = rawSiteUrl.replace(/\/+$/, '');
    cachedConvexHttpUrl = `${trimmed}/ws_api`;
  }

  if (process.env.NODE_ENV !== 'production') {
    // Helpful for debugging misconfiguration in local/dev environments.
    // eslint-disable-next-line no-console
    console.log(
      '[convex-next-server] Using Convex HTTP URL:',
      cachedConvexHttpUrl,
    );
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

export async function fetchQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...args: ArgsAndOptions<Query, NextjsOptions>
): Promise<FunctionReturnType<Query>> {
  const [fnArgs, options] = args as any;
  try {
    return await baseFetchQuery(query, fnArgs ?? {}, withDefaultUrl(options));
  } catch (error) {
    // Surface additional context in server logs to make production
    // failures (like 404s from Convex) diagnosable.
    // eslint-disable-next-line no-console
    console.error('[convex-next-server] fetchQuery failed', {
      query,
      args: fnArgs,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}

export async function fetchMutation<
  Mutation extends FunctionReference<'mutation'>,
>(
  mutation: Mutation,
  ...args: ArgsAndOptions<Mutation, NextjsOptions>
): Promise<FunctionReturnType<Mutation>> {
  const [fnArgs, options] = args as any;
  try {
    return await baseFetchMutation(
      mutation,
      fnArgs ?? {},
      withDefaultUrl(options),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[convex-next-server] fetchMutation failed', {
      mutation,
      args: fnArgs,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}

export async function fetchAction<Action extends FunctionReference<'action'>>(
  action: Action,
  ...args: ArgsAndOptions<Action, NextjsOptions>
): Promise<FunctionReturnType<Action>> {
  const [fnArgs, options] = args as any;
  try {
    return await baseFetchAction(action, fnArgs ?? {}, withDefaultUrl(options));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[convex-next-server] fetchAction failed', {
      action,
      args: fnArgs,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}

/**
 * Preload a Convex query for server-side rendering with reactivity on the client.
 *
 * Use this in Server Components to preload data that will be passed to Client
 * Components using `usePreloadedQuery`. This provides the best of both worlds:
 * - Server-side rendering for fast initial page load
 * - Real-time reactivity after hydration
 *
 * @example
 * ```tsx
 * // Server Component (page.tsx)
 * import { preloadQuery } from '@/lib/convex-next-server';
 * import { api } from '@/convex/_generated/api';
 *
 * export default async function Page() {
 *   const token = await getAuthToken();
 *   const preloadedData = await preloadQuery(
 *     api.items.list,
 *     { organizationId },
 *     { token }
 *   );
 *   return <ItemsList preloadedData={preloadedData} />;
 * }
 *
 * // Client Component (items-list.tsx)
 * 'use client';
 * import { usePreloadedQuery, type Preloaded } from '@/lib/convex-next-server';
 * import { api } from '@/convex/_generated/api';
 *
 * export function ItemsList({ preloadedData }: {
 *   preloadedData: Preloaded<typeof api.items.list>
 * }) {
 *   const data = usePreloadedQuery(preloadedData);
 *   // data is now reactive and will update in real-time!
 *   return <div>{data.map(item => ...)}</div>;
 * }
 * ```
 */
export async function preloadQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...args: ArgsAndOptions<Query, NextjsOptions>
): Promise<Preloaded<Query>> {
  const [fnArgs, options] = args as any;
  try {
    return await basePreloadQuery(query, fnArgs ?? {}, withDefaultUrl(options));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[convex-next-server] preloadQuery failed', {
      query,
      args: fnArgs,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}
