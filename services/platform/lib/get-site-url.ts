/**
 * Get the site URL for client-side usage.
 * Uses NEXT_PUBLIC_SITE_URL environment variable with fallback to window.location.origin.
 * This provides consistency in production while maintaining flexibility in development.
 */
export function getSiteUrl(): string {
  // Use environment variable if available (works during SSR and CSR)
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  }

  // Fallback to window.location.origin for client-side
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Final fallback for SSR without env var
  return 'http://localhost:3000';
}

/**
 * Get the Convex WebSocket URL.
 * Uses getSiteUrl() to derive the WebSocket endpoint.
 */
export function getConvexUrl(): string {
  return `${getSiteUrl()}/ws_api`;
}
