import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const config: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // React Compiler v1.0 is now stable (Oct 2025) and supported in Next.js 16.
  // Benefits: Automatic memoization, up to 12% faster initial loads, >2.5x faster interactions.
  // Trade-off: Increases build times as it relies on Babel.
  // To enable: Set to true and test thoroughly. Consider incremental rollout.
  // See: https://react.dev/blog/2025/10/07/react-compiler-1
  reactCompiler: false,

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

  // Cache Components (PPR) is disabled.
  // The 'use cache' directive and PPR are not working as expected in production.
  //
  // Alternative caching strategy:
  // - Use Convex's built-in real-time subscriptions via preloadQuery
  // - Rely on browser caching for static assets
  // - Consider ISR for pages that don't need real-time data
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
    // Optimize imports for large libraries - only import what's used
    // This significantly reduces bundle size for packages with many exports
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'lodash',
      'date-fns',
      'recharts',
      '@tanstack/react-table',
      '@xyflow/react',
      'framer-motion',
      'react-day-picker',
    ],
  },
};

// Compose plugins: withBundleAnalyzer -> withNextIntl -> config
export default withBundleAnalyzer(withNextIntl(config));
