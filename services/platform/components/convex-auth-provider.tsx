'use client';

import { ConvexReactClient } from 'convex/react';
import { ReactNode } from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';

// Validate required environment variables
// During build time, use a placeholder URL to allow prerendering.
// At runtime (in the browser), this validation will catch missing env vars.
const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL || 'http://placeholder:3210';

// Important: ConvexReactClient must point to the Convex deployment URL (WS/HTTP),
// not the Convex site URL. In dev this is usually http://localhost:3210.
const convex = new ConvexReactClient(convexUrl, { expectAuth: true });

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Validate at runtime (in browser) that the env var is actually set
  if (typeof window !== 'undefined' && !process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error(
      'NEXT_PUBLIC_CONVEX_URL is not set. Please add it to your .env.local file. ' +
        'Example: NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210',
    );
  }

  // Wire Better Auth tokens into Convex client
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
