/**
 * The name-keyed HTTP adapter registry — the ONE seam through which the
 * app-wide Convex hook wrappers (`useConvexQuery`, `useConvexMutation`,
 * `useConvexAction`, `useActionQuery`) serve a migrated family over the 0.5
 * backend while unmigrated families keep their Convex transport. Keys are
 * Convex function names (`getFunctionName`); a family swaps reads AND writes
 * together by contributing rows (see `projects.ts`) — call sites never
 * change. (The chat feature predates this seam and keeps its own table in
 * `app/features/chat/data/chat-backend.ts`.)
 *
 * Errors from the adapted lane are normalized to real `ConvexError`s
 * (`{ code, message, ...data }`) so every existing consumer — `instanceof`
 * branches, `convexErrorCode`, toast fallbacks — behaves exactly as on 0.4.
 */

import type { QueryClient } from '@tanstack/react-query';
import { ConvexError } from 'convex/values';

import {
  adminActionQueryAdapters,
  adminPaginatedAdapters,
  adminReadAdapters,
  adminWriteAdapters,
  adminDataResidencyActionQueries,
} from './admin';
import { BackendApiError } from './api-client';
import {
  documentPaginatedAdapters,
  documentReadAdapters,
  documentWriteAdapters,
} from './documents';
import {
  projectActionQueryAdapters,
  projectReadAdapters,
  projectWriteAdapters,
} from './projects';
import {
  settingsActionQueryAdapters,
  settingsReadAdapters,
  settingsWriteAdapters,
  settingsPaginatedAdapters,
} from './settings';
import { taskReadAdapters, taskWriteAdapters } from './tasks';

export interface AdapterContext {
  /** The active org from the route (`$id`) — the org scope for rows whose
   * 0.4 args don't carry `organizationId`. */
  organizationId?: string;
}

/**
 * The active organization, read straight from the URL (`/dashboard/$id/…`,
 * base path stripped). A PURE read — the hook wrappers run in components
 * above the RouterProvider too (BrandingProvider), where a router hook
 * throws. Every surface whose 0.4 args omit `organizationId` renders under
 * the dashboard org segment, so the URL is authoritative exactly where the
 * fallback matters.
 */
export function activeOrganizationId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const base = window.__ENV__?.BASE_PATH ?? '';
  const path =
    base.length > 0 && window.location.pathname.startsWith(base)
      ? window.location.pathname.slice(base.length)
      : window.location.pathname;
  const match = /^\/dashboard\/([^/]+)(?:\/|$)/.exec(path);
  const id = match?.[1];
  if (id === undefined || id === '' || id === 'switching') return undefined;
  return decodeURIComponent(id);
}

/** What an adapted read hands to react-query (queryFn already projected
 * to the 0.4 shape). `null` = the row cannot serve these args (no org in
 * scope) — the wrapper treats that as a skipped query. */
export interface AdaptedReadOptions {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  staleTime?: number;
  refetchInterval?: number;
}

export type ReadAdapter = (
  args: Record<string, unknown>,
  ctx: AdapterContext,
) => AdaptedReadOptions | null;

/** `useActionQuery` keeps the CALLER's queryKey; the adapter only supplies
 * the fetch. `null` = cannot serve (no org in scope) → skipped. */
export type ActionQueryAdapter = (
  args: Record<string, unknown>,
  ctx: AdapterContext,
) => (() => Promise<unknown>) | null;

export interface WriteAdapter {
  run: (args: Record<string, unknown>, ctx: AdapterContext) => Promise<unknown>;
  /** Invalidations to fire on success (before the caller's own onSuccess). */
  invalidate?: (
    client: QueryClient,
    args: Record<string, unknown>,
    ctx: AdapterContext,
  ) => void;
}

/** One fetched page on the adapted paginated lane (the 0.4 page envelope). */
export interface AdaptedPage {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
}

/** What an adapted PAGINATED read hands to the infinite-query lane. The
 * queryKey must sit under `backendEntityPrefix` so hints invalidate it. */
export interface AdaptedPaginatedOptions {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | null, numItems: number) => Promise<AdaptedPage>;
}

export type PaginatedAdapter = (
  args: Record<string, unknown>,
  ctx: AdapterContext,
) => AdaptedPaginatedOptions | null;

export const READ_ADAPTERS: Record<string, ReadAdapter> = {
  ...adminReadAdapters,
  ...documentReadAdapters,
  ...projectReadAdapters,
  ...settingsReadAdapters,
  ...taskReadAdapters,
};

export const PAGINATED_ADAPTERS: Record<string, PaginatedAdapter> = {
  ...adminPaginatedAdapters,
  ...documentPaginatedAdapters,
  ...settingsPaginatedAdapters,
};

export const ACTION_QUERY_ADAPTERS: Record<string, ActionQueryAdapter> = {
  ...adminActionQueryAdapters,
  ...adminDataResidencyActionQueries,
  ...projectActionQueryAdapters,
  ...settingsActionQueryAdapters,
};

export const WRITE_ADAPTERS: Record<string, WriteAdapter> = {
  ...adminWriteAdapters,
  ...documentWriteAdapters,
  ...projectWriteAdapters,
  ...settingsWriteAdapters,
  ...taskWriteAdapters,
};

/**
 * A deterministic backend answer (4xx with a machine code) becomes a REAL
 * `ConvexError` carrying `{ code, message, ...data }` — the 0.4 error
 * contract. Transport-ish failures (5xx, network) pass through untouched so
 * retry policies still see them as transient.
 */
export function toConvexError(error: unknown): unknown {
  if (error instanceof BackendApiError && error.status < 500) {
    return new ConvexError({
      ...error.data,
      ...(error.code !== undefined ? { code: error.code } : {}),
      message: error.message,
    });
  }
  return error;
}

export async function runAdapted<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // oxlint-disable-next-line no-throw-literal -- rethrowing the normalized error as-is
    throw toConvexError(error);
  }
}

/** Deterministic server answers never retry; transport errors retry 3×. */
export function retryAdaptedRead(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof ConvexError) return false;
  if (error instanceof BackendApiError && error.status < 500) return false;
  return failureCount < 3;
}
