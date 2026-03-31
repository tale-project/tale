import { useAction } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/convex/_generated/api';

interface BrandingData {
  appName?: string;
  textLogo?: string;
  logoUrl: string | null;
  faviconLightUrl: string | null;
  faviconDarkUrl: string | null;
  logoFilename?: string;
  faviconLightFilename?: string;
  faviconDarkFilename?: string;
  brandColor?: string;
  accentColor?: string;
  hash: string;
}

export function useBranding() {
  const readBrandingFn = useAction(api.branding.file_actions.readBranding);
  const [data, setData] = useState<BrandingData | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await readBrandingFn({});
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [readBrandingFn]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
