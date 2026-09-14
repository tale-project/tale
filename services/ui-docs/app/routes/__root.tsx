import { LocaleSync } from '@tale/ui/i18n/sync';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { Toaster } from '@tale/ui/toaster';
import { createRootRoute, Outlet } from '@tanstack/react-router';

/**
 * The root shell is deliberately thin. This site speaks TWO design languages
 * and each page owns its own chrome: `/` renders the marketing header and
 * footer from `@tale/marketing-ui`, everything under `/docs` renders the app
 * chrome from `@tale/ui`. Putting a shared header here would force one of the
 * two to fight it.
 */
function RootLayout() {
  return (
    <>
      <LocaleSync locale="en" htmlLang="en" />
      <ThemeAssets />
      <Outlet />
      <Toaster />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
