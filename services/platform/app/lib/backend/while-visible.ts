/**
 * How long a hidden page keeps its long-lived connections before it gives
 * them back. Long enough that a glance at another tab costs nothing, short
 * enough that a handful of background tabs cannot pile up.
 */
export const HIDDEN_RELEASE_MS = 5_000;

export interface VisibleLane {
  /** Open the connection. Called at start on a visible page, and on every return. */
  open: () => void;
  /** Close the connection. Called once the page has stayed hidden past the grace. */
  release: () => void;
}

/**
 * Hold a long-lived connection (an `EventSource`) only while the page is
 * visible.
 *
 * Over HTTP/1.1 a browser opens at most six connections to one host, shared
 * by every tab of the profile, and an open stream holds one for as long as
 * it lives. The dev server speaks HTTP/1.1 (Vite drops to it whenever it
 * proxies), so a few background tabs, each holding its org stream and maybe
 * a thread stream, used to leave the next tab rendered but stuck: its reads
 * queued behind sockets that would never free.
 *
 * A page that starts hidden (a tab opened in the background) counts as
 * already released: `release` runs at once, and `open` waits for the first
 * time the tab is shown. Returns a stop function that detaches the listener;
 * the caller still closes whatever it opened.
 */
export function whileVisible(lane: VisibleLane): () => void {
  if (typeof document === 'undefined') {
    lane.open();
    return () => undefined;
  }
  let released = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelRelease = (): void => {
    if (releaseTimer !== undefined) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
    }
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      if (!released && releaseTimer === undefined) {
        releaseTimer = setTimeout(() => {
          releaseTimer = undefined;
          released = true;
          lane.release();
        }, HIDDEN_RELEASE_MS);
      }
      return;
    }
    cancelRelease();
    if (released) {
      released = false;
      lane.open();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState === 'hidden') {
    released = true;
    lane.release();
  } else {
    lane.open();
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    cancelRelease();
  };
}
