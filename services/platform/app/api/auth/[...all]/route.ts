import { nextJsHandler } from '@convex-dev/better-auth/nextjs';

export const { GET, POST } = nextJsHandler({
  // Derive Convex HTTP API URL from SITE_URL
  // Routes through Next.js proxy: /http_api/* -> http://127.0.0.1:3211/*
  convexSiteUrl: `${process.env.SITE_URL}/http_api`,
});
