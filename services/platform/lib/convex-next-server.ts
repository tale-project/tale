import {
	fetchQuery as baseFetchQuery,
	fetchMutation as baseFetchMutation,
	fetchAction as baseFetchAction,
	type NextjsOptions,
} from 'convex/nextjs';
import type {
	ArgsAndOptions,
	FunctionReference,
	FunctionReturnType,
} from 'convex/server';

let cachedConvexHttpUrl: string | null = null;

function getConvexHttpUrl(): string {
	if (cachedConvexHttpUrl) return cachedConvexHttpUrl;

	// SITE_URL is the single source of truth. We derive the Convex deployment
	// URL from it and avoid any additional Convex-specific env vars.
	//
	// Convex clients (both browser and server) talk to the "Convex origin",
	// which in this app is always exposed at `${SITE_URL}/ws_api` and
	// proxied to the Convex backend port by Next.js rewrites.
	const rawSiteUrl = process.env.SITE_URL || 'http://localhost:3000';
	const trimmed = rawSiteUrl.replace(/\/+$/, '');
	const url = `${trimmed}/ws_api`;

	cachedConvexHttpUrl = url;
	if (process.env.NODE_ENV !== 'production') {
	  // Helpful for debugging misconfiguration in local/dev environments.
	  // eslint-disable-next-line no-console
	  console.log('[convex-next-server] Using Convex HTTP URL:', cachedConvexHttpUrl);
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
	Mutation extends FunctionReference<'mutation'>
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

