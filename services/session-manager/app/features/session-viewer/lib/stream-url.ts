/**
 * The address of a session's live view: a WebSocket on the host that serves
 * this page, secure when the page is.
 */
export function streamUrl(
  sessionId: number,
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/api/sessions/${sessionId}/stream`;
}

/** First wait before the page looks again for a live view that was lost. */
const RECONNECT_BASE_MS = 1000;
/** The longest wait between two looks. */
const RECONNECT_MAX_MS = 10_000;

/**
 * How long to wait before the next try to connect after `failures` failed
 * ones in a row: a second, then two, four, eight, then ten seconds for as long
 * as it takes. A server that restarts is reached quickly; one that is gone is
 * not asked every second.
 */
export function reconnectDelay(failures: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** failures, RECONNECT_MAX_MS);
}
