'use server';

/**
 * Server action to get the site URL.
 * Reads SITE_URL from environment variable (set by env.sh from USE_SSL and HOST).
 * This is a server action and can only be called from server components or other server actions.
 */
export async function getSiteUrl(): Promise<string> {
  const siteUrl = process.env.SITE_URL;

  if (siteUrl) {
    return siteUrl.replace(/\/+$/, '');
  }

  // Fallback for development without env var
  return 'http://localhost:3000';
}

/**
 * Get the Convex WebSocket URL.
 * Uses getSiteUrl() to derive the WebSocket endpoint.
 */
export async function getConvexUrl(): Promise<string> {
  const siteUrl = await getSiteUrl();
  return `${siteUrl}/ws_api`;
}

