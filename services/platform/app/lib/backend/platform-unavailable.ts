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
