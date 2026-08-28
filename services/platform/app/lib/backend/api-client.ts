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

export class BackendApiError extends Error {
  readonly status: number;
  /** The backend's machine-readable error code, when the body carried one. */
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    if (code !== undefined) {
      this.code = code;
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

export async function backendFetch<T>(
  route: string,
  options: BackendFetchOptions = {},
): Promise<T> {
  const response = await fetch(backendUrl(route, options.orgId), {
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
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let code: string | undefined;
    try {
      const body: unknown = await response.json();
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
      }
    } catch {
      // A non-JSON error body (proxy page, empty 502) keeps the status text.
    }
    throw new BackendApiError(response.status, message, code);
  }
  if (response.status === 204) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 204 callers declare T = undefined
    return undefined as T;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fetch boundary: T states the endpoint's contract
  return (await response.json()) as T;
}
