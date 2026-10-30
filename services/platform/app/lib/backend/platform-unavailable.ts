import { BackendApiError, isPlatformUnavailableAnswer } from './api-client';

/**
 * The answers that say the platform is briefly not there — restarting, or a
 * deployment rolling — and to retry after `Retry-After`, by code and the
 * statuses each comes with:
 * - `UPSTREAM_UNAVAILABLE` (502, 503 or 504), which the edge answers for the
 *   platform when it cannot reach it (`services/proxy/Caddyfile`);
 * - `DATABASE_UNAVAILABLE` (503), which the platform answers while its
 *   database restarts (`backend/error-reporting.ts`) and does not report
 *   itself.
 */
/**
 * Whether a request failed because the platform, or its database, was
 * briefly gone. Every request in flight meets such an answer at once, so the
 * browser reports none of them as a defect (`app/lib/sentry-normalize.ts`).
 * Any other 5xx stays a fault, and so does either code at another status.
 */
export function isPlatformUnavailable(error: unknown): boolean {
  return (
    error instanceof BackendApiError &&
    isPlatformUnavailableAnswer(error.status, error.code)
  );
}

/**
 * Whether a request failed because the knowledge database did not answer —
 * the deployment's default or the organization's own: the platform's 503
 * `KNOWLEDGE_DATABASE_UNAVAILABLE`, with `Retry-After`
 * (`backend/error-reporting.ts`). The platform itself answered, so the
 * browser keeps it reachable (`api-client.ts`). The server reports an outage
 * that lasts, once per database and outage, so the browser reports none of
 * the failed requests (`app/lib/sentry-normalize.ts`), and the person reads
 * that the knowledge database is not answering (`failureDetail`). The code at
 * another status stays a fault.
 */
export function isKnowledgeDatabaseUnavailable(error: unknown): boolean {
  return (
    error instanceof BackendApiError &&
    error.status === 503 &&
    error.code === 'KNOWLEDGE_DATABASE_UNAVAILABLE'
  );
}
