'use client';

import { ConvexClientProvider } from '@/components/convex-auth-provider';
import { ReactQueryProvider } from '@/components/react-query-provider';

export function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexClientProvider>
      <ReactQueryProvider>{children}</ReactQueryProvider>
    </ConvexClientProvider>
  );
}
