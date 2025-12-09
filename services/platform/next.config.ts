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
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
      // Proxy Convex API requests to internal backend
      {
        source: '/ws_api/:path*',
        destination: 'http://127.0.0.1:3210/:path*',
      },
      {
        source: '/http_api/:path*',
        destination: 'http://127.0.0.1:3211/:path*',
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
	  // Keep Cache Components disabled for now.
	  // Enabling this turns on Partial Prerendering / Cache Components, which
	  // requires dynamic data access (cookies(), headers(), DB queries, etc.)
	  // to live behind <Suspense> or 'use cache'. Our app has many
	  // authentication-protected, per-tenant routes that currently read
	  // cookies() directly in layouts/pages, so migrating would be non-trivial
	  // for limited benefit compared to straightforward SSR today.
  cacheComponents: false,
  experimental: {
    // See: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions#bodysizelimit
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
} satisfies NextConfig;
