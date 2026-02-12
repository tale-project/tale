import { useEffect, type ReactNode } from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { initSyncManager } from '@/lib/offline';

interface OfflineProviderProps {
  children: ReactNode;
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const convex = useConvexClient();

  useEffect(() => {
    const cleanup = initSyncManager(convex);
    return cleanup;
  }, [convex]);

  return <>{children}</>;
}
