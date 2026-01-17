import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/auth-server';
import {
  shouldUseTrustedHeaders,
  authenticateViaTrustedHeaders,
} from '@/lib/auth/trusted-headers-token';

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();

  // 1. First handle canonical redirects (www to non-www or vice versa)
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.replace('www.', '');
    return NextResponse.redirect(url, 301);
  }

  // 2. Then handle authentication (either Trusted Headers or Better Auth)
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = pathname.startsWith('/dashboard');
  const isAuthRoute = pathname.startsWith('/log-in') || pathname.startsWith('/sign-up');

  // Handle Trusted Headers mode for auth routes (auto-login)
  if (isAuthRoute && shouldUseTrustedHeaders()) {
    const authResult = await authenticateViaTrustedHeaders(request);

    if (authResult) {
      // User is authenticated via trusted headers - redirect to dashboard
      const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
      const isHttps = siteUrl.startsWith('https://');
      const cookieName = isHttps
        ? '__Secure-better-auth.session_token'
        : 'better-auth.session_token';

      // Check for redirectTo parameter
      const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard';
      const redirectUrl = new URL(redirectTo, request.url);

      const response = NextResponse.redirect(redirectUrl);

      if (authResult.shouldClearOldSession) {
        response.cookies.delete(cookieName);
      }

      response.cookies.set(cookieName, authResult.signedSessionToken, {
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return response;
    }
    // If trusted headers auth fails, fall through to show login page
  }

  if (isProtectedRoute) {
    // Check if trusted headers authentication is enabled
    if (shouldUseTrustedHeaders()) {
      // Trusted Headers Authentication Mode
      // IMPORTANT: Always validate headers on EVERY request, even if session exists
      // This ensures users are immediately logged out when upstream proxy stops sending headers
      const authResult = await authenticateViaTrustedHeaders(request);

      if (!authResult) {
        // Trusted headers enabled but missing or invalid - reject request
        console.warn(
          'Trusted headers authentication failed: headers missing or invalid',
        );
        return new NextResponse(
          'Unauthorized: Trusted headers authentication required',
          {
            status: 401,
            headers: {
              'Content-Type': 'text/plain',
            },
          },
        );
      }

      // Handle account switching: if the user switched accounts in the upstream auth,
      // we need to clear the old session cookie and set a new one
      const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
      const isHttps = siteUrl.startsWith('https://');
      const sessionCookieName = isHttps
        ? '__Secure-better-auth.session_token'
        : 'better-auth.session_token';
      const jwtCookieName = isHttps
        ? '__Secure-better-auth.convex_jwt'
        : 'better-auth.convex_jwt';

      const response = NextResponse.next();

      // If we detected an account switch, clear the old cookie first
      if (authResult.shouldClearOldSession) {
        response.cookies.delete(sessionCookieName);
      }

      // If trusted headers changed (role or teams), clear JWT cookie to force refresh
      // This ensures the JWT claims are regenerated with the new values
      if (authResult.trustedHeadersChanged) {
        response.cookies.delete(jwtCookieName);
      }

      // Set the new session cookie. Use the HMAC-signed value so Better Auth's
      // `getSignedCookie` can validate it and allow `/convex/token` to issue JWTs.
      response.cookies.set(sessionCookieName, authResult.signedSessionToken, {
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return response;
    } else {
      // Better Auth Authentication Mode
      // Delegate token handling and Convex error handling to the shared
      // server-side getCurrentUser helper so we don't duplicate
      // try/catch logic here. If the token is missing, invalid, or expired,
      // getCurrentUser will return null.
      const user = await getCurrentUser();

      if (!user || !user._id) {
        // No authenticated user - redirect to login
        const redirectUrl = new URL('/log-in', request.url);
        redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals, Auth.js API routes, and all static files
    '/((?!api/auth|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes except auth
    '/api/((?!auth).+)',
    '/trpc/(.*)',
  ],
};
