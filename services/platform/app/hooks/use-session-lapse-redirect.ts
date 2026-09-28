import { useEffect } from 'react';

import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import {
  onSessionLapsed,
  reportSessionLapsed,
  sessionLapseCheckVersion,
} from '@/app/lib/auth/session-lapse';
import { authClient } from '@/lib/auth-client';

/** How long after the document began to unload redirects stay off. */
const LEAVING_MS = 10_000;

/**
 * Take a signed-in tab to sign-in once a backend answer says its session has
 * ended (signed out in another tab, expired, revoked), the way the dashboard
 * does when its session probe finds nobody: re-check with Better Auth, and
 * on a clean signed-out answer hard-navigate to `/log-in`, carrying the page
 * to come back to and the notice to show there. The surface that met the
 * answer has already said "your session has ended" in its own toast.
 *
 * Only a clean answer redirects. A re-check that gets no answer (0, 5xx, a
 * thrown fetch) holds the page — a blip must not sign anyone out — and a
 * session that is alive after all (the old one rotated away while a request
 * was in flight, as a TOTP verify does) keeps it. Either way the next
 * lapsed-session answer checks again; answers that land while a check runs
 * share it.
 *
 * A document that has begun to unload is left alone: the navigation under
 * way (a reload, a typed address, a sign-out's own hard navigation to its
 * notice) is someone's deliberate step, and a redirect now would cancel it.
 * A leave that the unsaved-changes prompt called off lets redirects back in
 * after {@link LEAVING_MS}.
 *
 * `enabled` is the dashboard's own verdict that the tab is signed in: while
 * its probe says otherwise, that lane is the one re-checking and redirecting.
 */
export function useSessionLapseRedirect(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let checking = false;
    let leftAt: number | undefined;
    const onLeave = (): void => {
      leftAt = Date.now();
    };
    const leaving = (): boolean =>
      leftAt !== undefined && Date.now() - leftAt < LEAVING_MS;
    // TanStack's browser history already listens for `beforeunload` for the
    // app's lifetime, so this adds no back/forward-cache cost.
    window.addEventListener('beforeunload', onLeave);
    const unsubscribe = onSessionLapsed(() => {
      const version = sessionLapseCheckVersion();
      if (checking || version === null || leaving()) return;
      checking = true;
      void sessionIsGone().then((gone) => {
        checking = false;
        if (!active || leaving()) return;
        if (sessionLapseCheckVersion() !== version) {
          // A sign-out now owns navigation, or a rotation replaced the cookie
          // this answer judged. Recheck only after that transition releases.
          reportSessionLapsed();
          return;
        }
        if (gone) redirectToLogIn('session-ended');
      });
    });
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [enabled]);
}

/** Better Auth's own verdict: true only for a clean "nobody is signed in". */
async function sessionIsGone(): Promise<boolean> {
  try {
    const session = await authClient.getSession();
    const status = session?.error?.status;
    if (status !== undefined && (status === 0 || status >= 500)) {
      console.warn(
        `[auth] Session re-check after a lapsed-session answer failed with ${status}`,
      );
      return false;
    }
    return !session?.data?.user;
  } catch (error) {
    console.warn(
      '[auth] Session re-check after a lapsed-session answer failed',
      error,
    );
    return false;
  }
}
