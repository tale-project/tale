import { headers } from 'next/headers';

/**
 * Convex Dashboard Page - Server Component
 *
 * Embeds the Convex dashboard via a proxy API route.
 * Uses the request host to determine the iframe source URL.
 */
export default async function ConvexDashboardPage() {
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  const siteUrl = `${protocol}://${host}`;

  return (
    <iframe
      src={`${siteUrl}/api/convex-dashboard-proxy`}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="Convex Dashboard"
      allow="clipboard-read; clipboard-write"
    />
  );
}
