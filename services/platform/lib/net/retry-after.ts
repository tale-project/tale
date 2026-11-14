/**
 * The wait an HTTP `Retry-After` header asks for, shared by every outbound
 * caller that honours a server's pause (the TTS client, the chat's web reads,
 * the website crawler).
 */

/**
 * Parse an HTTP `Retry-After` header value (RFC 7231) into milliseconds.
 * Accepts the `delta-seconds` form (`"5"`) and the `HTTP-date` form
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns `undefined` for malformed
 * input or negative deltas — the caller falls back to its default backoff.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
  }
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) return undefined;
  const delta = epoch - Date.now();
  return delta > 0 ? delta : undefined;
}
