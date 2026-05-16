import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { AppShell } from '@tale/ui/app-shell';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LazyMotion, domAnimation } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BrandingProvider } from '@/app/components/branding/branding-provider';
import { BackupCodesDialogProvider } from '@/app/features/settings/account/components/backup-codes-dialog-provider';
import { authClient } from '@/lib/auth-client';
import { i18n } from '@/lib/i18n/i18n';
import { SiteUrlProvider } from '@/lib/site-url-context';
import { loadDayjsLocale } from '@/lib/utils/date/format';

import { convexQueryClient, queryClient, router } from './router';

import './globals.css';
import './locals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SiteUrlProvider>
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={authClient}
      >
        <AppShell
          i18n={i18n}
          locale={{ mode: 'client', onChange: loadDayjsLocale }}
          theme={{ defaultTheme: 'system' }}
        >
          <QueryClientProvider client={queryClient}>
            <LazyMotion features={domAnimation} strict>
              <BrandingProvider>
                <BackupCodesDialogProvider>
                  <RouterProvider router={router} />
                </BackupCodesDialogProvider>
              </BrandingProvider>
            </LazyMotion>
          </QueryClientProvider>
        </AppShell>
      </ConvexBetterAuthProvider>
    </SiteUrlProvider>
  </StrictMode>,
);
