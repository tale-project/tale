import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { createAuth } from '@/convex/auth';
// Dynamic import of betterAuth moved inside getAuthToken() to enable PPR/cacheComponents.
// Static imports of betterAuth cause prerender failures due to crypto.getRandomValues() usage.
import { cookies } from 'next/headers';

/**
 * Refresh the Convex JWT token using the current Better Auth session.
 * This is called automatically when a JWT expires but the session is still valid.
 *
 * @returns A new JWT token if the session is valid, undefined otherwise
 */
async function refreshAuthToken(): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const isHttps = siteUrl.startsWith('https://');

    const cookieName = isHttps
      ? '__Secure-better-auth.session_token'
      : 'better-auth.session_token';

    const sessionToken = cookieStore.get(cookieName)?.value;

    if (!sessionToken) {
      console.log('No session token found, cannot refresh JWT');
      return undefined;
    }

    console.log('Refreshing JWT token using session...');

    // Call the Better Auth Convex token endpoint to get a fresh JWT
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${siteUrl}/api/auth/convex/token`, {
      method: 'GET',
      headers: {
        Cookie: `${cookieName}=${sessionToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // 401 means the session itself expired - user needs to log in again
      if (response.status === 401) {
        console.log(
          'Session expired, cannot refresh JWT (user needs to re-login)',
        );
      } else {
        console.error(
          'Failed to refresh JWT:',
          response.status,
          await response.text(),
        );
      }
      return undefined;
    }

    const data = await response.json();
    if (data?.token) {
      console.log('JWT token refreshed successfully');
      return data.token;
    }

    console.error('No token in refresh response:', data);
    return undefined;
  } catch (error) {
    console.error('JWT refresh failed:', error);
    return undefined;
  }
}

/**
 * Get the current authenticated user from server-side context.
 * Returns null if no user is authenticated.
 *
 * Note: This function automatically opts out of static rendering
 * since authentication requires access to request context.
 */
export async function getCurrentUser() {
  // Opt out of static rendering since authentication requires request context
  await connection();

  const token = await getAuthToken();
  if (!token) return null;
  try {
    const user = await fetchQuery(api.users.getCurrentUser, {}, { token });
    return user || null;
  } catch (error) {
    // Treat Convex Unauthenticated errors (e.g. invalid/expired JWT) as
    // a signal to refresh the JWT if a valid session exists
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      console.warn(
        'Convex auth token invalid or expired, attempting to refresh JWT',
      );

      // Try to refresh the JWT using the session
      const refreshedToken = await refreshAuthToken();
      if (refreshedToken) {
        try {
          const user = await fetchQuery(
            api.users.getCurrentUser,
            {},
            { token: refreshedToken },
          );
          return user || null;
        } catch (retryError) {
          console.error('Failed to get user after JWT refresh:', retryError);
          return null;
        }
      }

      return null;
    }

    // For any other unexpected error, surface it so it can be diagnosed.
    console.error('Unexpected error in getCurrentUser:', error);
    throw error;
  }
}

/**
 * Get a Convex auth token (JWT) for authenticating with Convex.
 * This uses the Better Auth Convex integration which generates JWTs from sessions.
 *
 * Note: This function signals dynamic rendering via connection() to ensure
 * Next.js knows this route requires request context (cookies).
 */
export async function getAuthToken(): Promise<string | undefined> {
  // Signal dynamic rendering since this function accesses cookies
  await connection();

  try {
    // Dynamic import AFTER connection() to defer betterAuth initialization to request time.
    // This enables PPR/cacheComponents by avoiding crypto.getRandomValues() during prerender.
    const { convexBetterAuthNextJs } =
      await import('@convex-dev/better-auth/nextjs');
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

    // First, try the standard Next.js token getter
    const token = await convexBetterAuthNextJs({
      convexUrl,
      convexSiteUrl: `${siteUrl}/http_api`,
    }).getToken();
    if (token) {
      return token;
    }
  } catch (error) {
    console.warn('getTokenNextjs failed, trying HTTP fallback:', error);
  }

  // Fallback: Call Better Auth's /api/auth/convex/token endpoint
  // This endpoint converts a Better Auth session to a Convex JWT
  try {
    const cookieStore = await cookies();
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const isHttps = siteUrl.startsWith('https://');

    // Use the correct cookie name based on whether we're running over HTTPS
    const cookieName = isHttps
      ? '__Secure-better-auth.session_token'
      : 'better-auth.session_token';

    const sessionToken = cookieStore.get(cookieName)?.value;

    console.log({ isHttps, siteUrl });

    if (!sessionToken) {
      console.log('No session token cookie found');
      return undefined;
    }

    console.log('Attempting HTTP fallback to /api/auth/convex/token');

    // Call the Better Auth Convex token endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${siteUrl}/api/auth/convex/token`, {
      method: 'GET',
      headers: {
        Cookie: `${cookieName}=${sessionToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // 401 is expected when session is expired or invalid - don't log as error
      if (response.status === 401) {
        console.log('No valid session found (401 from /api/auth/convex/token)');
      } else {
        const errorText = await response.text();
        console.error(
          'Failed to fetch JWT from Better Auth:',
          response.status,
          errorText,
        );
      }
      return undefined;
    }

    const data = await response.json();
    console.log('Received response from /api/auth/convex/token:', {
      hasToken: !!data?.token,
      tokenPreview: data?.token?.substring(0, 20) + '...',
    });

    // The response should contain a JWT token
    if (data?.token) {
      return data.token;
    }

    console.error('No token in response from /api/auth/convex/token:', data);
    return undefined;
  } catch (error) {
    console.error('HTTP fallback failed:', error);
    return undefined;
  }
}

/**
 * Require authentication for a page or API route.
 * Redirects to sign-in page if not authenticated.
 */
export async function requireAuth() {
  await connection();
  const user = await getCurrentUser();
  if (!user) {
    redirect('/log-in');
  }
  return user;
}

