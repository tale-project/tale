import { ConvexHttpClient } from 'convex/browser';
import type {
  FunctionReference,
  FunctionReturnType,
  FunctionArgs,
} from 'convex/server';

let cachedConvexHttpUrl: string | null = null;
let cachedClient: ConvexHttpClient | null = null;

function getConvexHttpUrl(): string {
  if (cachedConvexHttpUrl) return cachedConvexHttpUrl;

  const rawSiteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const trimmed = rawSiteUrl.replace(/\/+$/, '');
  const url = `${trimmed}/ws_api`;

  cachedConvexHttpUrl = url;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[convex-server] Using Convex HTTP URL:', cachedConvexHttpUrl);
  }
  return cachedConvexHttpUrl;
}

function getClient(): ConvexHttpClient {
  if (cachedClient) return cachedClient;
  cachedClient = new ConvexHttpClient(getConvexHttpUrl());
  return cachedClient;
}

interface ServerOptions {
  token?: string;
}

export async function fetchQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query>,
  options?: ServerOptions,
): Promise<FunctionReturnType<Query>> {
  const client = getClient();
  if (options?.token) {
    client.setAuth(options.token);
  }
  try {
    return await client.query(query, args);
  } catch (error) {
    console.error('[convex-server] fetchQuery failed', {
      query,
      args,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}

export async function fetchAction<Action extends FunctionReference<'action'>>(
  action: Action,
  args: FunctionArgs<Action>,
  options?: ServerOptions,
): Promise<FunctionReturnType<Action>> {
  const client = getClient();
  if (options?.token) {
    client.setAuth(options.token);
  }
  try {
    return await client.action(action, args);
  } catch (error) {
    console.error('[convex-server] fetchAction failed', {
      action,
      args,
      url: getConvexHttpUrl(),
      error,
    });
    throw error;
  }
}
