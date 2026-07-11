import { AppShell } from '@tale/ui/app-shell';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ConvexProviderWithAuth, useConvexAuth } from 'convex/react';
import { LazyMotion, domAnimation } from 'framer-motion';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { BrandingProvider } from '@/app/components/branding/branding-provider';
import { OnlineGate } from '@/app/components/connectivity/online-gate';
import { SwUpdateListener } from '@/app/components/connectivity/sw-update-listener';
import { BackupCodesDialogProvider } from '@/app/features/settings/account/components/backup-codes-dialog-provider';
import { useAuthFromBetterAuth } from '@/app/hooks/use-auth-from-better-auth';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { i18n } from '@/lib/i18n/i18n';
import { SiteUrlProvider } from '@/lib/site-url-context';
import { loadDayjsLocale } from '@/lib/utils/date/format';

import { convexQueryClient, queryClient, router } from './router';

import './globals.css';
import './locals.css';

/**
 * Dev-only probe: marks the end of the WebSocket auth handshake. Must live
 * inside ConvexProviderWithAuth so `useConvexAuth` sees the Convex client.
 */
function ColdLoadProbe() {
  const { isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading) markColdLoad('convex-authenticated');
  }, [isLoading]);
  return null;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SiteUrlProvider>
      {/* convex/react's provider with our own Better Auth bridge
          (use-auth-from-better-auth) instead of ConvexBetterAuthProvider: the
          bridge pre-authenticates the WS with the persisted last-known token
          and runs the session + token HTTP hops in parallel (epic #2386).
          ConvexBetterAuthProvider is this same wrapper plus a cross-domain
          one-time-token effect Tale doesn't use. */}
      <ConvexProviderWithAuth
        client={convexQueryClient.convexClient}
        useAuth={useAuthFromBetterAuth}
      >
        <ColdLoadProbe />
        <AppShell
          i18n={i18n}
          locale={{ mode: 'client', onChange: loadDayjsLocale }}
          theme
        >
          <QueryClientProvider client={queryClient}>
            <LazyMotion features={domAnimation} strict>
              <BrandingProvider>
                <BackupCodesDialogProvider>
                  <OnlineGate>
                    <RouterProvider router={router} />
                  </OnlineGate>
                  <SwUpdateListener />
                </BackupCodesDialogProvider>
              </BrandingProvider>
            </LazyMotion>
          </QueryClientProvider>
        </AppShell>
      </ConvexProviderWithAuth>
    </SiteUrlProvider>
  </StrictMode>,
);
