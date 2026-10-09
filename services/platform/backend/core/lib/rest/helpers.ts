/**
 * Helpers of the 0.4-era HTTP door that still parses raw requests: the SCIM
 * door (`core/scim/http_actions.ts` — `extractPathParts`, `parseIntParam`).
 * The `/api/v1` REST families do NOT come through here: `backend/rest/`
 * authenticates, rate limits, validates and maps errors on its own
 * (`rest/shared.ts`), and the MCP door hands its protocol layer a proven
 * caller (`domains/mcp/caller.ts`). The 0.4 CORS-bearing `jsonError` is gone
 * with the last door that used it: a Bearer key is not ambient authority a
 * browser page could use, so no `/api/v1` response grants an origin.
 */

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Extract path segments after a prefix.
 *
 * The prefix is LOCATED in the pathname rather than assumed at position 0:
 * some doors are mounted on more than one path (the SCIM routes serve
 * `/scim/v2/...` and the 0.4 proxy-era alias `/http_api/scim/v2/...` — the
 * one the admin UI advertises as the tenant URL), and the handlers parse the
 * RAW request URL, which carries whichever mount the caller used. Every
 * prefix starts with `/`, so a match always sits on a segment boundary. A
 * pathname that does not contain the prefix yields an empty id — the caller
 * answers 400/404 — instead of mis-slicing unrelated segments into an id
 * (the bug that broke per-resource SCIM ops on the advertised alias, where
 * `/http_api/scim/` is exactly as long as `/scim/v2/Users/`).
 *
 * Example: extractPathParts('/api/v1/documents/abc123/retry-indexing', '/api/v1/documents/')
 *   → { id: 'abc123', subPath: 'retry-indexing' }
 *
 * Example: extractPathParts('/http_api/scim/v2/Users/u1', '/scim/v2/Users/')
 *   → { id: 'u1', subPath: null }
 */
export function extractPathParts(
  url: URL,
  prefix: string,
): { id: string; subPath: string | null } {
  const at = url.pathname.indexOf(prefix);
  if (at === -1) {
    return { id: '', subPath: null };
  }
  const rest = url.pathname.slice(at + prefix.length);
  const parts = rest.split('/').filter(Boolean);
  return {
    id: parts[0] ?? '',
    subPath: parts.length > 1 ? parts.slice(1).join('/') : null,
  };
}

/**
 * Parse numeric query parameter with a default value.
 */
export function parseIntParam(
  url: URL,
  key: string,
  defaultValue: number,
): number {
  const val = url.searchParams.get(key);
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
