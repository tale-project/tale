import { createFileRoute } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/convex-dashboard')({
  head: () => ({
    meta: seo({ title: 'Convex Dashboard - Tale' }),
  }),
  component: ConvexDashboardPage,
});

function ConvexDashboardPage() {
  const siteUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : '';

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <iframe
        src={`${siteUrl}/api/convex-dashboard-proxy`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Convex Dashboard"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
