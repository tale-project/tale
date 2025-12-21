import { nextJsHandler } from '@convex-dev/better-auth/nextjs';

// For server-side requests inside Docker, we need to use an internal URL that can
// be reached from within the container. The external SITE_URL (e.g., https://demo.tale.dev)
// often cannot be reached from inside the container due to hairpin NAT issues.
//
// CONVEX_HTTP_INTERNAL_URL (default: http://127.0.0.1:3211) points directly to the
// Convex HTTP backend port.
const convexHttpInternalUrl =
  process.env.CONVEX_HTTP_INTERNAL_URL || 'http://127.0.0.1:3211';

export const { GET, POST } = nextJsHandler({
  // Use internal URL for server-side requests to Convex HTTP API
  // This bypasses the external domain which may not be reachable from inside Docker
  convexSiteUrl: convexHttpInternalUrl,
});
