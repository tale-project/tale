import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { createAuth } from '@/convex/auth';
import { getToken as getTokenNextjs } from '@convex-dev/better-auth/nextjs';
import { cookies } from 'next/headers';
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
    // an unauthenticated session so callers (like requireAuth) can
    // gracefully redirect to the login page.
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      console.warn(
        'Convex auth token invalid or expired in getCurrentUser; treating as unauthenticated',
      );
      return null;
    }

    // For any other unexpected error, surface it so it can be diagnosed.
    console.error('Unexpected error in getCurrentUser:', error);
    throw error;
  }
}

/**
 * Minimal session shape backed by Convex/Better Auth.
 */
export async function getCurrentSession() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;
  return { user };
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
    // First, try the standard Next.js token getter
    const token = await getTokenNextjs(createAuth);
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

    // For server-side requests inside Docker, use an internal URL that can be
    // reached from within the container. The external SITE_URL may not be
    // reachable due to hairpin NAT issues.
    const internalApiUrl =
      process.env.NEXT_INTERNAL_URL || 'http://127.0.0.1:3000';

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

    // Call the Better Auth Convex token endpoint using internal URL
    const response = await fetch(`${internalApiUrl}/api/auth/convex/token`, {
      method: 'GET',
      headers: {
        Cookie: `${cookieName}=${sessionToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        'Failed to fetch JWT from Better Auth:',
        response.status,
        errorText,
      );
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

/**
 * Get user ID from session.
 */
export async function getCurrentUserId(): Promise<string | null> {
  await connection();
  const user = await getCurrentUser();
  return (user?._id as string) || null;
}
