'use client';

import { ConvexReactClient } from 'convex/react';
import { type ReactNode, useRef } from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';

interface ConvexClientProviderProps {
  children: ReactNode;
  convexUrl: string;
}

export function ConvexClientProvider({
  children,
  convexUrl,
}: ConvexClientProviderProps) {
  // Use ref to ensure client is only created once per component lifecycle
  const clientRef = useRef<ConvexReactClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new ConvexReactClient(convexUrl, {
      expectAuth: true,
    });
  }

  return (
    <ConvexBetterAuthProvider client={clientRef.current} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
