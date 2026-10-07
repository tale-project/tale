import { LocaleSync } from '@tale/ui/i18n/sync';
import { ThemeAssets } from '@tale/ui/theme/assets';
import { Toaster } from '@tale/ui/toaster';
import {
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';

import { UiDocsLayout } from '@/app/components/docs/ui-docs-layout';
import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';

/**
 * Every route uses the shared documentation frame, mounted once at the root
 * just as in the product docs. Each page owns its header strip and article.
 */
function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      <LocaleSync locale="en" htmlLang="en" />
      <ThemeAssets />
      <UiDocsLayout
        activeHref={pathname === '/' ? docPath(firstNavSlug()) : pathname}
      >
        <Outlet />
      </UiDocsLayout>
      <Toaster />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
