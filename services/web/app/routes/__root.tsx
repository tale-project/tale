import { LocaleSync } from '@tale/ui/i18n/sync';
import { SkipLink } from '@tale/ui/skip-link';
import { Outlet, createRootRoute } from '@tanstack/react-router';

import { SiteFooter } from '@/app/components/layout/site-footer';
import { SiteHeader } from '@/app/components/layout/site-header';
import { NotFoundPage } from '@/app/pages/not-found-page';
import { useT } from '@/lib/i18n/client';
import { resolveRegionalLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
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
    <div className="bg-surface-site text-fg-base relative flex min-h-screen flex-col">
      {/* Top wash lives on the shell so the sticky transparent header always
          composites over the same paper — per-page pulls under the nav were
          easy to miss and read as a hairline seam. */}
      <div
        aria-hidden
        className="bg-gradient-site-hero pointer-events-none absolute inset-x-0 top-0 h-[min(72vh,40rem)]"
      />
      <LocaleSync locale={resolveRegionalLocale(locale)} htmlLang={locale} />
      <SkipLink>{t('skipToMain')}</SkipLink>
      <SiteHeader />
      <main id="main" className="relative flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
