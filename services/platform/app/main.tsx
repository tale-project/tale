import {
  startBrowserAnalytics,
  analyticsRouteTemplate,
} from '@tale/ui/analytics/browser';
import { AppShell } from '@tale/ui/app-shell';
import { loadDayjsLocale } from '@tale/ui/date';
import { SwUpdateToasts } from '@tale/ui/pwa/sw-update-toasts';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LazyMotion, domAnimation } from 'framer-motion';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { BrandingProvider } from '@/app/components/branding/branding-provider';
import { OnlineGate } from '@/app/components/connectivity/online-gate';
import { BackupCodesDialogProvider } from '@/app/features/settings/account/components/backup-codes-dialog-provider';
import { useSessionUser } from '@/app/hooks/use-session-user';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { i18n } from '@/lib/i18n/i18n';
import { SiteUrlProvider } from '@/lib/site-url-context';

import { queryClient, router } from './router';

import './globals.css';
import './locals.css';

startBrowserAnalytics(
  (resolved) => router.subscribe('onResolved', resolved),
  () => {
    const match = router.state.matches.at(-1);
    if (match?.status !== 'success' || match.globalNotFound) return undefined;
    return analyticsRouteTemplate(router.routesById[match.routeId].fullPath);
  },
);

/** Dev-only probe: marks the end of the session handshake (the one request
 * every auth-gated read waits on). */
function ColdLoadProbe() {
  const { isLoading } = useSessionUser();
  useEffect(() => {
    if (!isLoading) markColdLoad('session-resolved');
  }, [isLoading]);
  return null;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');
// Narrowed alias: the non-null check above doesn't flow into the hoisted
// renderApp function declaration below.
const root: HTMLElement = rootElement;

// React's first commit replaces #root's children — including the
// server-injected boot shell (lib/shared/boot-shell.ts). Mounting while the
// router is still resolving the initial location (the session fetch in
// /dashboard's beforeLoad, route chunk imports) would commit a router with
// no matches yet: a tree with zero host nodes, i.e. a blank flash between
// the served shell and the first real frame. Resolve the initial matches
// first — the static shell stays on screen for exactly that window — so the
// first commit already paints the resolved route (on dashboard navigations,
// the same shell frame the served HTML shows). Redirects thrown in
// beforeLoad (e.g. signed-out → /log-in) are handled inside load(); a
// failure falls through to render so the router's own error surface owns
// it. RouterProvider's mount load then re-runs as a background transition
// over the already-active matches (the router.invalidate() path — stable
// match ids, no remount), which keeps the current frame rendered.
function renderApp() {
  markColdLoad('router-loaded');
  createRoot(root).render(<App />);
}

router
  .load()
  .catch((error: unknown) => {
    console.warn('Initial route load failed; mounting anyway', error);
  })
  .finally(renderApp);

function App() {
  return (
    <StrictMode>
      <SiteUrlProvider>
        <AppShell
          i18n={i18n}
          locale={{ mode: 'client', onChange: loadDayjsLocale }}
          theme
        >
          <QueryClientProvider client={queryClient}>
            <ColdLoadProbe />
            <LazyMotion features={domAnimation} strict>
              <BrandingProvider>
                <BackupCodesDialogProvider>
                  <OnlineGate>
                    <RouterProvider router={router} />
                  </OnlineGate>
                  <SwUpdateToasts />
                </BackupCodesDialogProvider>
              </BrandingProvider>
            </LazyMotion>
          </QueryClientProvider>
        </AppShell>
      </SiteUrlProvider>
    </StrictMode>
  );
}
