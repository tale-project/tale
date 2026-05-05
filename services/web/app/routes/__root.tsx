import { Outlet, createRootRoute } from '@tanstack/react-router';

import { SiteFooter } from '@/app/components/layout/site-footer';
import { SiteHeader } from '@/app/components/layout/site-header';
import { useT } from '@/lib/i18n/client';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { t } = useT('nav');
  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-[color:var(--color-accent-base)] focus:px-4 focus:py-2 focus:text-[color:var(--color-accent-fg)] focus:ring-2 focus:ring-[color:var(--color-accent-base)]/40 focus:outline-none"
      >
        {t('skipToMain')}
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
