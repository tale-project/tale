/**
 * Convex Dashboard Page - Server Component
 *
 * Embeds the Convex dashboard via a proxy API route.
 * Uses SITE_URL environment variable for the iframe source.
 */
export default function ConvexDashboardPage() {
  const siteUrl =
    process.env.SITE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000');

  return (
    <iframe
      src={`${siteUrl}/api/convex-dashboard-proxy`}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="Convex Dashboard"
      allow="clipboard-read; clipboard-write"
    />
  );
}
