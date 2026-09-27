/**
 * The name-keyed HTTP adapter registry — the ONE seam through which the
 * app-wide Convex hook wrappers (`useBackendQuery`, `useBackendMutation`,
 * `useBackendAction`, `useActionQuery`) serve a migrated family over the 0.5
 * backend while unmigrated families keep their Convex transport. Keys are
 * Convex function names (`getFunctionName`); a family swaps reads AND writes
 * together by contributing rows (see `projects.ts`) — call sites never
 * change. (The chat feature predates this seam and keeps its own table in
 * `app/features/chat/data/chat-backend.ts`.)
 *
 * Errors from the adapted lane are normalized to real `AppError`s
 * (`{ code, message, ...data }`) so every existing consumer — `instanceof`
 * branches, `backendErrorCode`, toast fallbacks — behaves exactly as on 0.4.
 */

import type { QueryClient } from '@tanstack/react-query';

import { AppError } from '@/lib/shared/errors/app-error';
import {
  backendErrorCode,
  backendRefusalReason,
} from '@/lib/utils/backend-error';

import {
  accountActionQueryAdapters,
  accountReadAdapters,
  accountWriteAdapters,
} from './account';
import {
  adminActionQueryAdapters,
  adminPaginatedAdapters,
  adminReadAdapters,
  adminWriteAdapters,
  adminDataResidencyActionQueries,
} from './admin';
import { BackendApiError, readBackendApiError } from './api-client';
import {
  automationActionQueryAdapters,
  automationReadAdapters,
  automationWriteAdapters,
} from './automations';
import {
  conversationReadAdapters,
  conversationWriteAdapters,
} from './conversations';
import {
  documentActionQueryAdapters,
  documentPaginatedAdapters,
  documentReadAdapters,
  documentWriteAdapters,
} from './documents';
import {
  engagementPaginatedAdapters,
  engagementReadAdapters,
  engagementWriteAdapters,
} from './engagement';
import { libraryActionQueryAdapters, libraryWriteAdapters } from './library';
import { metricsPaginatedAdapters, metricsReadAdapters } from './metrics';
import { orgWriteAdapters } from './org';
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
import {
  taskPaginatedAdapters,
  taskReadAdapters,
  taskWriteAdapters,
} from './tasks';

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
  /**
   * The caller's view of a SHARED answer: reads whose args only narrow one
   * fetched body (a status picked out of a counts map) key on the fetch and
   * project here, so react-query issues one request for every narrowing —
   * keyed on the narrowing, four status counts fetched the same body four
   * times on every cold load.
   */
  select?: (data: unknown) => unknown;
}

export type ReadAdapter = (
  args: Record<string, unknown>,
  ctx: AdapterContext,
) => AdaptedReadOptions | null;

/** The caller's view of what an adapted read fetched: the fetched body,
 * through the row's `select` when it has one. Every consumer that hands a
 * read's answer to a caller — the hook, the loaders, the imperative client
 * — projects through this, so a shared body never reaches a caller raw. */
export function projectAdaptedRead(
  adapted: Pick<AdaptedReadOptions, 'select'>,
  data: unknown,
): unknown {
  return adapted.select === undefined ? data : adapted.select(data);
}

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
  ...accountReadAdapters,
  ...adminReadAdapters,
  ...automationReadAdapters,
  ...conversationReadAdapters,
  ...engagementReadAdapters,
  ...metricsReadAdapters,
  ...documentReadAdapters,
  ...projectReadAdapters,
  ...settingsReadAdapters,
  ...taskReadAdapters,
};

export const PAGINATED_ADAPTERS: Record<string, PaginatedAdapter> = {
  ...adminPaginatedAdapters,
  ...engagementPaginatedAdapters,
  ...metricsPaginatedAdapters,
  ...documentPaginatedAdapters,
  ...settingsPaginatedAdapters,
  ...taskPaginatedAdapters,
};

export const ACTION_QUERY_ADAPTERS: Record<string, ActionQueryAdapter> = {
  ...accountActionQueryAdapters,
  ...adminActionQueryAdapters,
  ...adminDataResidencyActionQueries,
  ...automationActionQueryAdapters,
  ...documentActionQueryAdapters,
  ...libraryActionQueryAdapters,
  ...projectActionQueryAdapters,
  ...settingsActionQueryAdapters,
};

export const WRITE_ADAPTERS: Record<string, WriteAdapter> = {
  ...accountWriteAdapters,
  ...adminWriteAdapters,
  ...automationWriteAdapters,
  ...conversationWriteAdapters,
  ...libraryWriteAdapters,
  ...engagementWriteAdapters,
  ...documentWriteAdapters,
  ...orgWriteAdapters,
  ...projectWriteAdapters,
  ...settingsWriteAdapters,
  ...taskWriteAdapters,
};

/**
 * A deterministic backend answer (4xx with a machine code) becomes a REAL
 * `AppError` carrying `{ code, message, ...data }` — the 0.4 error
 * contract. Transport-ish failures (5xx, network) pass through untouched so
 * retry policies still see them as transient.
 */
export function toBackendError(error: unknown): unknown {
  if (error instanceof BackendApiError && error.status < 500) {
    return new AppError({
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
    throw toBackendError(error);
  }
}

/**
 * A raw `fetch`'s non-2xx answer as the error an adapted call throws for it
 * ({@link toBackendError}) — for the lanes `backendFetch` cannot carry
 * because their body is a file, the upload POSTs: the door's `{ error,
 * message, data }` becomes the `AppError` a surface reads a refusal from,
 * and a 5xx stays a transient `BackendApiError`.
 */
export async function backendErrorFromResponse(
  response: Response,
): Promise<AppError | BackendApiError> {
  const error = await readBackendApiError(response);
  const normalized = toBackendError(error);
  return normalized instanceof AppError ? normalized : error;
}

/**
 * A deterministic server answer: the `AppError` a 4xx becomes (or that a
 * client-side refusal throws), or a raw `BackendApiError` under 500. A 5xx
 * and a network failure are faults, not answers.
 */
export function isBackendRefusal(error: unknown): boolean {
  if (error instanceof AppError) return true;
  return error instanceof BackendApiError && error.status < 500;
}

/**
 * What a refusal says about itself, for the description under a surface's
 * localized title: the sentence the handler wrote, else its bare code — a
 * door that answers only `{ error: <code> }` names why with nothing else.
 * Reads a raw-lane `BackendApiError` and an adapted `AppError` alike.
 * Undefined for a fault (a 5xx, a network failure) and for an answer that
 * carried no code (a proxy page).
 */
export function backendRefusalDetail(error: unknown): string | undefined {
  if (error instanceof BackendApiError && error.status >= 500) {
    return undefined;
  }
  const refusal = toBackendError(error);
  const code = backendErrorCode(refusal);
  if (code === undefined) return undefined;
  return backendRefusalReason(refusal) ?? code;
}

/** Deterministic server answers never retry; transport errors retry 3×. */
export function retryAdaptedRead(
  failureCount: number,
  error: unknown,
): boolean {
  if (isBackendRefusal(error)) return false;
  return failureCount < 3;
}
