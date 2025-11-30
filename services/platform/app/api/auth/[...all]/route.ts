import { nextJsHandler } from '@convex-dev/better-auth/nextjs';

export const { GET, POST } = nextJsHandler({
  // Prefer internal Convex site origin for server-to-server calls inside the container,
  // fall back to the public URL only for client-side usage.
  convexSiteUrl:
    process.env.CONVEX_SITE_ORIGIN || process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
});
