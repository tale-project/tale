'use client';

import { useEffect, useState } from 'react';

export default function ConvexDashboardPage() {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  useEffect(() => {
    const origin = window.location.origin;
    setIframeSrc(`${origin}/api/convex-dashboard-proxy`);
  }, []);

  if (!iframeSrc) {
    return <div>Loading...</div>;
  }

  return (
    <iframe
      src={iframeSrc}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="Convex Dashboard"
      allow="clipboard-read; clipboard-write"
    />
  );
}

