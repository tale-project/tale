'use client';

import { ConvexClientProvider } from '@/components/convex-auth-provider';
import { PostHogProvider } from '@/components/post-hog-provider';
import { ReactQueryProvider } from '@/components/react-query-provider';

export function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexClientProvider>
      <PostHogProvider>
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </PostHogProvider>
    </ConvexClientProvider>
  );
}
