import { Stack } from '@tale/ui/layout';
import { TaleLogo } from '@tale/ui/logo';
import { Link } from '@tanstack/react-router';

import { useNavItems } from '@/app/hooks/use-nav-items';
import { useT } from '@/lib/i18n/client';

import { RailList } from './rail-list';

/**
 * The app rail: a permanent 52px icon column of the sections, with Settings at
 * its foot. Hidden below `md`, where the bottom tab bar takes over. It follows
 * the platform's rail (`app-sidebar/app-sidebar.tsx`, `sidebar-header.tsx`,
 * `sidebar-footer.tsx`): the sidebar is named for what it is, the logo link for
 * where it goes, the sections and the pinned tile are one navigation, and the
 * pinned tile stands under a hairline.
 */
export function AppRail() {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');
  const { primary, pinned } = useNavItems();

  return (
    <aside
      aria-label={t('landmark')}
      className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex"
    >
      <Stack gap={0} className="h-full w-full overflow-hidden px-2">
        <div className="shrink-0 pt-3 pb-4">
          <Link
            to="/sessions"
            aria-label={tCommon('appName')}
            className="focus-visible:ring-ring flex size-9 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <TaleLogo wordmark={false} aria-hidden />
          </Link>
        </div>
        <nav
          aria-label={t('aria.main')}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* The list flexes and scrolls (scrollbar hidden: the rail is too
              narrow for one) so a short viewport never clips tiles; its flex-1
              also pins Settings to the bottom. */}
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
            <RailList items={primary} />
          </div>
          <div className="border-border shrink-0 border-t py-2">
            <RailList items={pinned} />
          </div>
        </nav>
      </Stack>
    </aside>
  );
}
