/**
 * The one credential the gateway itself checks.
 *
 * The token endpoints are the only doors the app guards: everything a machine
 * can reach carries `AI_GATEWAY_API_KEY`. The panel has no login of its own —
 * whatever fronts the gateway decides who reaches it — so there is no session,
 * no cookie, and nothing for a browser to present.
 */

/**
 * Read the API key off a request, accepting either spelling.
 *
 * `Authorization: Bearer <key>` is what a caller reaches for first;
 * `x-api-key` is what the simpler HTTP clients and webhook senders emit.
 */
export function readApiKey(headers: Headers): string | null {
  const authorization = headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value) return value;
  }
  const headerKey = headers.get('x-api-key')?.trim();
  return headerKey ? headerKey : null;
}
