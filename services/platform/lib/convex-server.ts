import type {
  FunctionReference,
  FunctionReturnType,
  FunctionArgs,
} from 'convex/server';

import { ConvexHttpClient } from 'convex/browser';

import { getEnv } from '@/lib/env';

let cachedConvexHttpUrl: string | null = null;
let cachedClient: ConvexHttpClient | null = null;

function getConvexHttpUrl(): string {
  if (cachedConvexHttpUrl) return cachedConvexHttpUrl;

  const siteUrl = getEnv('SITE_URL');
  const trimmed = siteUrl.replace(/\/+$/, '');
  cachedConvexHttpUrl = `${trimmed}/ws_api`;
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
