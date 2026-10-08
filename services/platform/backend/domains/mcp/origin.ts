import { siteOrigins } from '../../core/lib/helpers/public_origin.ts';

/**
 * The MCP transport's Origin rule: a request that carries an `Origin` must
 * come from the deployment's own origins (`SITE_URL`,
 * `ADDITIONAL_SITE_URLS`) or one the operator lists in
 * `TALE_MCP_ALLOWED_ORIGINS`. A coding agent on a terminal or a server
 * sends no `Origin` and is never judged; a web page another site serves
 * does, and a key in such a page is how a site would reach the endpoint.
 *
 * Enforcement is the operator's switch, `TALE_MCP_ORIGIN_ENFORCE=true`,
 * off by default for now: some desktop clients send origins of their own
 * (an editor's `vscode-file://…`), and which ones is being recorded before
 * the default flips. Until then a mismatch is logged and answered.
 *
 * Both variables are read on each request, like the site origins, so a
 * changed environment holds from the next request on; `backend/env.ts`
 * refuses a malformed list at boot.
 */

const ORIGIN_SHAPE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+$/i;

/**
 * An origin in one comparable spelling (`https://tale.example`, a default
 * port dropped, a scheme and host lower-cased), or null when the value is
 * not an origin at all (a path, a query, credentials, free text).
 */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (!ORIGIN_SHAPE.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  // `new URL` gives a non-web scheme (`vscode-file://vscode-app`) the
  // opaque origin "null"; such an origin is compared as written.
  return parsed.origin === 'null' ? value.toLowerCase() : parsed.origin;
}

/** The entries of `TALE_MCP_ALLOWED_ORIGINS` (comma- or space-separated)
 * that are not origins — empty when every entry is one. */
export function invalidAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .filter((entry) => entry !== '' && normalizeOrigin(entry) === null);
}

function allowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const listed = (env.TALE_MCP_ALLOWED_ORIGINS ?? '')
    .split(/[\s,]+/)
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
  return new Set([
    ...siteOrigins(env).map((origin) => normalizeOrigin(origin) ?? origin),
    ...listed,
  ]);
}

/** Whether the operator turned enforcement on. */
export function mcpOriginEnforced(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TALE_MCP_ORIGIN_ENFORCE?.trim().toLowerCase() === 'true';
}

/**
 * How a request's `Origin` header stands: `absent` (no header — a CLI or a
 * server), `allowed`, or `mismatch`.
 */
export function judgeMcpOrigin(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): 'absent' | 'allowed' | 'mismatch' {
  if (origin === undefined) return 'absent';
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowedOrigins(env).has(normalized)
    ? 'allowed'
    : 'mismatch';
}

/** The origin as a log line may print it: its normalized spelling, or a
 * placeholder for a value that is not one — never a caller's free text. */
export function loggableOrigin(origin: string): string {
  return normalizeOrigin(origin)?.slice(0, 200) ?? '(not an origin)';
}
