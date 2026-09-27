/**
 * The 0.5 backend's HTTP client — the fetch seam every migrated feature
 * hook goes through. One place owns the base path, the org scoping, the
 * cookie posture, and the error normalization, so feature code says
 * `backendFetch('/tasks', { orgId })` and nothing else.
 *
 * Auth rides the Better Auth session cookie (same-origin; the auth client
 * already talks to `/api/auth`), so there is no token plumbing here — a 401
 * surfaces as a `BackendApiError` the caller (or the router's error
 * recovery) can act on.
 */

import { isAbortError } from '@/lib/utils/abort-error';

import {
  reportBackendReachable,
  reportBackendUnreachable,
} from './connection-state';

export class BackendApiError extends Error {
  readonly status: number;
  /** The backend's machine-readable error code, when the body carried one. */
  readonly code?: string;
  /** Structured payload beside the code (`body.data`, e.g. the bound
   * automation names on a refused project delete), when the body carried one. */
  readonly data?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code?: string,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    if (code !== undefined) {
      this.code = code;
    }
    if (data !== undefined) {
      this.data = data;
    }
  }
}

export interface BackendFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialized as the request body. */
  body?: unknown;
  /** Appended as the `orgId` query parameter — the backend's org scope. */
  orgId?: string;
  signal?: AbortSignal;
}

function basePath(): string {
  return window.__ENV__?.BASE_PATH ?? '';
}

/** `/api/app` + route, with the deployment base path and org scope applied. */
export function backendUrl(route: string, orgId?: string): string {
  const url = `${basePath()}/api/app${route}`;
  if (orgId === undefined) {
    return url;
  }
  const separator = route.includes('?') ? '&' : '?';
  return `${url}${separator}orgId=${encodeURIComponent(orgId)}`;
}

/** The `/events` hint-stream URL for one organization. */
export function eventsUrl(orgId: string): string {
  return `${basePath()}/events?orgId=${encodeURIComponent(orgId)}`;
}

/**
 * The `BackendApiError` a non-2xx answer's parsed body becomes — the one
 * reading of the app's error envelope (`{ error: <code>, message?, data? }`)
 * that {@link backendFetch} and the raw-fetch lanes (the chat turn, the
 * upload POSTs) share: the handler's `message`, else its `error`, as the
 * message; `error` as the code; `data` beside them. A body that is not an
 * object (a proxy page, an empty 502) keeps the status text.
 */
export function backendApiErrorFromBody(
  status: number,
  body: unknown,
): BackendApiError {
  let message = `Request failed with status ${status}`;
  let code: string | undefined;
  let data: Record<string, unknown> | undefined;
  if (body !== null && typeof body === 'object') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object; string-typeof guards gate every field read
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.length > 0) {
      message = record.message;
    } else if (typeof record.error === 'string') {
      message = record.error;
    }
    if (typeof record.error === 'string') {
      code = record.error;
    }
    if (record.data !== null && typeof record.data === 'object') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object just above
      data = record.data as Record<string, unknown>;
    }
  }
  return new BackendApiError(status, message, code, data);
}

/** Read a non-2xx `response`'s body into its {@link BackendApiError}. */
export async function readBackendApiError(
  response: Response,
): Promise<BackendApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    // A non-JSON error body (proxy page, empty 502) keeps the status text.
    console.warn(
      `[backend] the ${response.status} answer carried no JSON body`,
      error,
    );
  }
  return backendApiErrorFromBody(response.status, body);
}

export async function backendFetch<T>(
  route: string,
  options: BackendFetchOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(backendUrl(route, options.orgId), {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      ...(options.body !== undefined
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(options.body),
          }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // A cancelled request — TanStack Query aborting a read whose last
    // observer unmounted on navigation — was withdrawn by its caller, not
    // lost by the network: it says nothing about reachability either way.
    if (isAbortError(error)) {
      throw error;
    }
    // No HTTP response (refused, DNS, offline). Statused replies — including
    // 5xx — still mean the server is reachable; the offline overlay must not
    // fire for those.
    reportBackendUnreachable();
    throw error;
  }
  reportBackendReachable();
  if (!response.ok) {
    throw await readBackendApiError(response);
  }
  if (response.status === 204) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 204 callers declare T = undefined
    return undefined as T;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fetch boundary: T states the endpoint's contract
  return (await response.json()) as T;
}
