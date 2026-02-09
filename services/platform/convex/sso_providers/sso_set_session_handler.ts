import { ActionCtx } from '../_generated/server';
import { createAuth } from '../auth';
import { signCookieValue } from './sign_cookie_value';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/**
 * SSO Set Session Handler
 *
 * This endpoint receives a raw session token and:
 * 1. Signs the token and sets it as the session_token cookie
 * 2. Calls Better Auth to generate and set the JWT cookie
 * 3. Returns an HTML page that redirects to the dashboard
 *
 * Using an HTML response instead of a 302 redirect ensures
 * that Set-Cookie headers are properly processed by the browser.
 */
export async function ssoSetSessionHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const frontendOrigin = url.origin;

  if (!token) {
    return createErrorResponse(frontendOrigin, 'Missing session token');
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.error('[SSO Set Session] BETTER_AUTH_SECRET not configured');
    return createErrorResponse(frontendOrigin, 'Server configuration error');
  }

  try {
    // Sign the session token
    const signedToken = await signCookieValue(token, secret);

    // Determine if we should use secure cookies (HTTPS)
    const isHttps = frontendOrigin.startsWith('https://');
    const cookieName = isHttps
      ? `__Secure-${SESSION_COOKIE_NAME}`
      : SESSION_COOKIE_NAME;

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

    // Now get the JWT by calling Better Auth with the signed session cookie
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

    // Extract Set-Cookie headers from the token response
    tokenResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });

    // Return an HTML page that sets cookies and redirects
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=/dashboard">
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login, please wait...</p>
  <script>window.location.href = '/dashboard';</script>
</body>
</html>`;

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');

    // Set all cookies
    for (const cookie of cookies) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(html, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[SSO Set Session] Error:', error);
    return createErrorResponse(frontendOrigin, 'Failed to complete login');
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createErrorResponse(origin: string, message: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Error</title>
</head>
<body>
  <p>Error: ${escapeHtml(message)}</p>
  <p><a href="/log-in">Return to login</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
