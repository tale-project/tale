import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { SiteFooter } from '@/app/components/layout/site-footer';
import { SiteHeader } from '@/app/components/layout/site-header';
import { useT } from '@/lib/i18n/client';
import { resolveRegionalLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Top-level layout. Reads the active locale from the URL on every route
 * change and syncs `i18n.language` to the matching regional bundle. This
 * is the single mechanism keeping translations in sync with the URL —
 * components elsewhere never call `i18n.changeLanguage` directly.
 */
function RootComponent() {
  const { t } = useT('nav');
  const locale = useCurrentLocale();
  const { i18n } = useTranslation();

  useEffect(() => {
    const target = resolveRegionalLocale(locale);
    if (i18n.language !== target) {
      void i18n.changeLanguage(target);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale, i18n]);

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
