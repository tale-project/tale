import { getEnv } from '@/lib/env';

/** Why a signed-in tab was sent to sign in — the log-in page's `reason`,
 * which it names in a notice above the form. */
export type LogInRedirectReason = 'session-ended';

/**
 * The sign-in page's address for this tab: `redirectTo` carries the page it
 * is on (base path stripped, query and hash kept), so signing in brings the
 * person back to it.
 */
export function logInRedirectUrl(reason?: LogInRedirectReason): string {
  const basePath = getEnv('BASE_PATH');
  const { pathname, search, hash } = window.location;
  const routePath =
    basePath !== '' && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : pathname;
  const returnTo = encodeURIComponent(routePath + search + hash);
  const why = reason !== undefined ? `&reason=${reason}` : '';
  return `${basePath}/log-in?redirectTo=${returnTo}${why}`;
}

/**
 * Take a tab whose session is gone to sign-in. A full load, never the
 * router: it drops the signed-out tab's React Query cache and every
 * in-memory auth state, as the idle watchdog's and the user button's
 * sign-outs do.
 */
export function redirectToLogIn(reason?: LogInRedirectReason): void {
  window.location.href = logInRedirectUrl(reason);
}
