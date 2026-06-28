import type { ActionCtx } from '../../_generated/server';
import { createAuth } from '../../auth';
import { signCookieValue } from '../sign_cookie_value';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/**
 * Receives a raw session token, signs it into the session cookie, asks Better
 * Auth to mint the JWT cookie, and returns an HTML page that redirects to the
 * dashboard (HTML rather than 302 so Set-Cookie is reliably applied).
 */
export async function ssoSetSessionHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const frontendOrigin = url.origin;

  if (!token) return createErrorResponse('Missing session token');

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.error('[SSO Set Session] BETTER_AUTH_SECRET not configured');
    return createErrorResponse('Server configuration error');
  }

  try {
    const signedToken = await signCookieValue(token, secret);
    const isHttps = frontendOrigin.startsWith('https://');
    const cookieName = isHttps
      ? `__Secure-${SESSION_COOKIE_NAME}`
      : SESSION_COOKIE_NAME;

    const sessionCookieParts = [
      `${cookieName}=${signedToken}`,
      `Max-Age=${SESSION_MAX_AGE}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (isHttps) sessionCookieParts.push('Secure');
    const sessionCookie = sessionCookieParts.join('; ');

    const auth = createAuth(ctx);
    const tokenRequest = new Request(
      new URL('/api/auth/convex/token', url.origin).toString(),
      { method: 'GET', headers: { Cookie: `${cookieName}=${signedToken}` } },
    );
    const tokenResponse = await auth.handler(tokenRequest);

    const cookies: string[] = [sessionCookie];
    tokenResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') cookies.push(value);
    });

    const basePath = process.env.BASE_PATH || '';
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${basePath}/dashboard">
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login, please wait...</p>
  <script>window.location.href = '${basePath}/dashboard';</script>
</body>
</html>`;

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    for (const cookie of cookies) headers.append('Set-Cookie', cookie);
    return new Response(html, { status: 200, headers });
  } catch (error) {
    console.error('[SSO Set Session] Error:', error);
    return createErrorResponse('Failed to complete login');
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

function createErrorResponse(message: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Login Error</title></head>
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
