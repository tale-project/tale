import { useConvex } from 'convex/react';
import { useEffect, type ReactNode } from 'react';

import { initSyncManager } from '@/lib/offline';

interface OfflineProviderProps {
  children: ReactNode;
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const convex = useConvex();

  useEffect(() => {
    const cleanup = initSyncManager(convex);
    return cleanup;
  }, [convex]);

  return <>{children}</>;
}
