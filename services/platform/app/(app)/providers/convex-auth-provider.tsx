'use client';

import { ConvexReactClient } from 'convex/react';
import { type ReactNode } from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';

/**
 * Get the Convex WebSocket URL from environment variable.
 * Falls back to localhost for development.
 */
function getConvexUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return `${siteUrl.replace(/\/+$/, '')}/ws_api`;
}

// Singleton client instance - created once per browser session
const convexClient = new ConvexReactClient(getConvexUrl(), { expectAuth: true });

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convexClient} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
