import { LocaleSync } from '@tale/ui/i18n/sync';
import { Outlet, createRootRoute } from '@tanstack/react-router';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { useT } from '@/lib/i18n/client';
import { resolveRegionalLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Top-level layout. Reads the active locale from the URL on every route
 * change; `<LocaleSync>` keeps the i18n instance and `<html lang>` aligned.
 * Components elsewhere never call `i18n.changeLanguage` directly.
 */
function RootComponent() {
  const { t } = useT('nav');
  const locale = useCurrentLocale();

  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)]">
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
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
