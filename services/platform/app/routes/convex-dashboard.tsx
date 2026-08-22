import { createFileRoute } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/convex-dashboard')({
  head: () => ({
    meta: seo('convexDashboard'),
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
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the embedded
          first-party dashboard needs full script and storage access through
          the proxy; a sandbox attribute blanks it. */}
      <iframe
        src={`${siteUrl}/api/convex-dashboard-proxy`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Convex Dashboard"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
