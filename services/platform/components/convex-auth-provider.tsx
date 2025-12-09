'use client';

import { ConvexReactClient } from 'convex/react';
import { ReactNode, useState, useEffect } from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';

/**
 * Get the Convex WebSocket URL.
 * Derives from window.location.origin at runtime, appending /ws_api.
 */
function getConvexUrl(): string {
  return `${window.location.origin}/ws_api`;
}

// Singleton client instance - only created in browser
let convexClient: ConvexReactClient | null = null;

function getConvexClient(): ConvexReactClient {
  if (!convexClient) {
    const url = getConvexUrl();
    convexClient = new ConvexReactClient(url, { expectAuth: true });
  }
  return convexClient;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Track whether we're mounted on the client
  const [client, setClient] = useState<ConvexReactClient | null>(null);

  useEffect(() => {
    // Only runs on the client after hydration - safe to use Math.random() here
    setClient(getConvexClient());
  }, []);

  // During SSR or before hydration, render nothing to avoid Math.random() during prerender
  if (!client) {
    return null;
  }

  // Wire Better Auth tokens into Convex client
  return (
    <ConvexBetterAuthProvider client={client} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
