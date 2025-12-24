import type { NextConfig } from 'next';

export default {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Disable React Compiler as it's not yet stable and can cause issues with
  // certain React patterns and third-party libraries. We'll enable it once
  // it's more mature and has better compatibility.
  reactCompiler: false,

  images: {
    remotePatterns: [
      {
        hostname: 'cdn.shopify.com',
      },
      {
        hostname: 'picsum.photos',
      },
      {
        hostname: 'shop.lanserhof.com',
      },
      {
        hostname: 'images.unsplash.com',
      },
    ],
  },
  async rewrites() {
    return [
      // Proxy Convex API requests to internal backend
      {
        source: '/ws_api/:path*',
        destination: 'http://127.0.0.1:3210/:path*',
      },
      {
        source: '/http_api/:path*',
        destination: 'http://127.0.0.1:3211/:path*',
      },
      // Proxy Convex Dashboard API calls to the Convex backend
      // The dashboard JavaScript is rewritten to use /convex-dashboard-api/
      // instead of /api/ to avoid conflicts with platform API routes
      {
        source: '/convex-dashboard-api/:path*',
        destination: 'http://127.0.0.1:3210/api/:path*',
      },
      // Also handle WebSocket and API calls that go through the dashboard proxy path
      // The dashboard constructs WebSocket URLs by appending /api/... to the iframe's origin path
      {
        source: '/api/convex-dashboard-proxy/api/:path*',
        destination: 'http://127.0.0.1:3210/api/:path*',
      },
    ];
  },
  skipTrailingSlashRedirect: true,

  // Cache Components (PPR) is currently disabled due to incompatibility with
  // the betterAuth library which uses Math.random() internally during auth
  // token generation. This causes prerender failures because Math.random()
  // is non-deterministic and can't be used during static prerendering.
  //
  // TODO: Re-enable once betterAuth is updated to be PPR-compatible, or
  // when we migrate to a different auth solution that doesn't use Math.random().
  //
  // When enabled, Cache Components provides:
  // - Static shell prerendered at build time (navigation, layout chrome)
  // - Dynamic content streams in at request time via Suspense boundaries
  // - Use 'use cache' directive on components/functions for cached dynamic data
  // - All cookie/header access must be wrapped in Suspense or use 'use cache'
  cacheComponents: false,

  // Define cache profiles for different data freshness needs
  cacheLife: {
    // Short-lived data that should refresh frequently (1 minute)
    seconds: {
      stale: 60,
      revalidate: 30,
      expire: 120,
    },
    // Data that can be cached for a few minutes (5 minutes)
    minutes: {
      stale: 300,
      revalidate: 60,
      expire: 600,
    },
    // Data that can be cached for hours (1 hour)
    hours: {
      stale: 3600,
      revalidate: 900,
      expire: 7200,
    },
    // Nearly static data (1 day)
    days: {
      stale: 86400,
      revalidate: 3600,
      expire: 172800,
    },
    // Maximum caching for truly static data
    max: {
      stale: Infinity,
      revalidate: 86400,
      expire: Infinity,
    },
  },

  experimental: {
    // See: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions#bodysizelimit
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
} satisfies NextConfig;
