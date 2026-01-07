'use client';

import { ConvexReactClient } from 'convex/react';
import { type ReactNode } from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';
import { getConvexUrl } from '@/lib/get-site-url';

// Singleton client instance - created once per browser session
const convexClient = new ConvexReactClient(getConvexUrl(), {
  expectAuth: true,
});

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convexClient} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
