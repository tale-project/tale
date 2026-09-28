/**
 * The app's one reading of a lapsed session, and the signal its fetch seam
 * raises when a backend answer says so.
 *
 * The session door (`backend/auth/session.ts`) refuses a request whose
 * session has ended — signed out in another tab, expired, revoked — with a
 * 401 `UNAUTHORIZED`. (The API-key header guard answers the same pair, but
 * only to a request carrying a key header, which the app never sends.) The
 * refusal's words are normalized in `toBackendError`; the tab is taken to
 * sign-in by `useSessionLapseRedirect`, which listens here. Kept free of
 * imports so the fetch seam can report without pulling in the auth client.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let transitionCount = 0;
let transitionVersion = 0;
let deferredLapse = false;

/**
 * A local auth change owns the session until its response has installed the
 * replacement cookie, or its sign-out cleanup has navigated away. A sign-out
 * keeps this hold through cleanup and releases when its navigation begins;
 * a failed sign-out or completed rotation releases immediately. Starting a
 * change also invalidates a recheck that was already in flight.
 */
export function holdSessionLapseRedirects(): () => void {
  transitionCount++;
  transitionVersion++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitionCount--;
    transitionVersion++;
    if (transitionCount === 0 && deferredLapse) {
      deferredLapse = false;
      reportSessionLapsed();
    }
  };
}

/**
 * Cleanup has finished and its caller will hard-navigate. Let the unload
 * guard take over only once that leave starts, so a cancelled dirty-editor
 * prompt can re-arm recovery after the guard expires. Queue after the other
 * beforeunload listeners so releasing a deferred lapse cannot race the guard.
 */
export function releaseSessionLapseHoldOnLeave(release: () => void): void {
  window.addEventListener('beforeunload', () => queueMicrotask(release), {
    once: true,
  });
}

/** A recheck may act only while the session has not changed beneath it. */
export function sessionLapseCheckVersion(): number | null {
  return transitionCount === 0 ? transitionVersion : null;
}

/** True for the session door's answer: the session this tab had is gone. */
export function isLapsedSessionAnswer(
  status: number,
  code: string | undefined,
): boolean {
  return status === 401 && code === 'UNAUTHORIZED';
}

/** A backend answer said the session has ended. */
export function reportSessionLapsed(): void {
  if (transitionCount > 0) {
    deferredLapse = true;
    return;
  }
  for (const listener of listeners) listener();
}

/** Hear every lapsed-session answer from now on; returns the unsubscribe. */
export function onSessionLapsed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
