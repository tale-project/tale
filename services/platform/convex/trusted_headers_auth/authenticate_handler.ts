/**
 * Trusted headers authentication HTTP handler.
 *
 * Called when the user's browser is redirected here from the login page.
 * The authenticating reverse proxy (Authelia, Authentik, oauth2-proxy) has
 * already verified the user's identity and set headers on the request.
 *
 * This handler:
 * 1. Reads identity headers from the request
 * 2. Finds or creates the user and session via Convex mutation
 * 3. Signs the session token and generates a JWT cookie via Better Auth
 * 4. Returns an HTML page that sets cookies and redirects to the app
 */

import { makeFunctionReference } from 'convex/server';

import type { ActionCtx } from '../_generated/server';
import { createAuth } from '../auth';
import { signCookieValue } from '../sso_providers/sign_cookie_value';

// Use makeFunctionReference to avoid dependency on generated types.
// The referenced mutation is defined in ./internal_mutations.ts.
const authenticateMutation = makeFunctionReference<'mutation'>(
  'trusted_headers_auth/internal_mutations:authenticate',
);

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Default header names — override via env vars for proxy compatibility. */
function getHeaderName(envVar: string, fallback: string): string {
  return process.env[envVar] || fallback;
}

interface TrustedTeamEntry {
  id: string;
  name: string;
}

/**
 * Parse the teams header value into structured entries.
 * Expected format: "id1:Name One, id2:Name Two"
 */
function parseTeamsHeader(value: string): TrustedTeamEntry[] | null {
  if (!value.trim()) return null;

  const entries: TrustedTeamEntry[] = [];
  for (const segment of value.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const id = trimmed.slice(0, colonIndex).trim();
    const name = trimmed.slice(colonIndex + 1).trim();
    if (id && name) {
      entries.push({ id, name });
    }
  }

  return entries.length > 0 ? entries : null;
}

export async function trustedHeadersAuthenticateHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const frontendOrigin = url.origin;
  const basePath = process.env.BASE_PATH || '';
  const redirectTo =
    url.searchParams.get('redirect') || `${basePath}/dashboard`;

  // Guard: trusted headers must be enabled
  if (process.env.TRUSTED_HEADERS_ENABLED !== 'true') {
    return createErrorResponse(
      frontendOrigin,
      basePath,
      'Trusted headers authentication is not enabled',
    );
  }

  // Read identity from proxy headers
  const emailHeader = getHeaderName('TRUSTED_EMAIL_HEADER', 'Remote-Email');
  const nameHeader = getHeaderName('TRUSTED_NAME_HEADER', 'Remote-Name');
  const roleHeader = getHeaderName('TRUSTED_ROLE_HEADER', 'Remote-Role');
  const teamsHeader = getHeaderName('TRUSTED_TEAMS_HEADER', 'Remote-Teams');

  const email = req.headers.get(emailHeader);
  if (!email) {
    return createErrorResponse(
      frontendOrigin,
      basePath,
      `Missing required header: ${emailHeader}`,
    );
  }

  const name = req.headers.get(nameHeader) || email.split('@')[0];
  const role = req.headers.get(roleHeader) || 'member';
  const teamsRaw = req.headers.get(teamsHeader);
  const teams = teamsRaw !== null ? parseTeamsHeader(teamsRaw) : null;

  // Extract existing session token from cookie (for session reuse)
  const isHttps = frontendOrigin.startsWith('https://');
  const cookieName = isHttps
    ? `__Secure-${SESSION_COOKIE_NAME}`
    : SESSION_COOKIE_NAME;
  const existingSessionToken = extractCookieValue(
    req.headers.get('Cookie'),
    cookieName,
  );

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;
  const userAgent = req.headers.get('user-agent') || undefined;

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.error('[Trusted Headers] BETTER_AUTH_SECRET not configured');
    return createErrorResponse(
      frontendOrigin,
      basePath,
      'Server configuration error',
    );
  }

  try {
    // Authenticate: find/create user + create/reuse session
    const result: {
      sessionToken: string;
      userId: string;
      organizationId: string | null;
      shouldClearOldSession: boolean;
      trustedHeadersChanged: boolean;
    } = await ctx.runMutation(authenticateMutation, {
      email,
      name,
      role,
      teams,
      existingSessionToken: existingSessionToken || undefined,
      ipAddress: ip,
      userAgent,
      secret: process.env.TRUSTED_HEADERS_INTERNAL_SECRET || undefined,
    });

    // Sign the session token (replicates Better Auth cookie signing)
    const signedToken = await signCookieValue(result.sessionToken, secret);

    // Build the session_token cookie
    const sessionCookieParts = [
      `${cookieName}=${signedToken}`,
      `Max-Age=${SESSION_MAX_AGE}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (isHttps) {
      sessionCookieParts.push('Secure');
    }
    const sessionCookie = sessionCookieParts.join('; ');

    // Call Better Auth to generate the JWT cookie
    const auth = createAuth(ctx);
    const tokenRequest = new Request(
      new URL('/api/auth/convex/token', url.origin).toString(),
      {
        method: 'GET',
        headers: {
          Cookie: `${cookieName}=${signedToken}`,
        },
      },
    );

    const tokenResponse = await auth.handler(tokenRequest);

    // Collect all Set-Cookie headers
    const cookies: string[] = [sessionCookie];
    tokenResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });

    // Return HTML that sets cookies and redirects to the app
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${escapeHtmlAttr(redirectTo)}">
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login, please wait...</p>
  <script>window.location.href = '${escapeJs(redirectTo)}';</script>
</body>
</html>`;

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    for (const cookie of cookies) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(html, { status: 200, headers });
  } catch (error) {
    console.error('[Trusted Headers] Authentication error:', error);
    return createErrorResponse(
      frontendOrigin,
      basePath,
      'Authentication failed',
    );
  }
}

function extractCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key.trim() === name) {
      return decodeURIComponent(rest.join('=').trim());
    }
  }
  return null;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
    .replace(/\v/g, '\\v')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createErrorResponse(
  _origin: string,
  basePath: string,
  message: string,
): Response {
  // Redirect back to the login page with an error flag so the login page
  // breaks the redirect loop and shows the regular login form.
  const loginPath = `${basePath}/log-in?trusted_headers_error=1`;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${escapeHtmlAttr(loginPath)}">
  <title>Authentication Error</title>
</head>
<body>
  <p>Error: ${escapeHtmlAttr(message)}</p>
  <p><a href="${escapeHtmlAttr(loginPath)}">Return to login</a></p>
  <script>window.location.href = '${escapeJs(loginPath)}';</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
