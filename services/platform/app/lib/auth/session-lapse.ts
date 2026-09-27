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

/** True for the session door's answer: the session this tab had is gone. */
export function isLapsedSessionAnswer(
  status: number,
  code: string | undefined,
): boolean {
  return status === 401 && code === 'UNAUTHORIZED';
}

/** A backend answer said the session has ended. */
export function reportSessionLapsed(): void {
  for (const listener of listeners) listener();
}

/** Hear every lapsed-session answer from now on; returns the unsubscribe. */
export function onSessionLapsed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
