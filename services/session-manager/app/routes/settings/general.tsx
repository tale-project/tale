import { createFileRoute } from '@tanstack/react-router';

import { GeneralPage } from '@/app/features/settings/components/general-page';
import { settingsQuery } from '@/app/features/settings/hooks/use-settings';
import { pageHead } from '@/app/lib/page-head';
import { waitForRead } from '@/app/lib/route-read';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings/general')({
  // The settings are in before the page's first frame, so its form opens with
  // what is saved instead of masked fields. One row, waited for as the root
  // route's read is; a read that fails is for the page to tell.
  loader: ({ context }) =>
    waitForRead(
      context.queryClient.ensureQueryData(settingsQuery()),
      (error: unknown) => {
        console.warn('Failed to load the settings', error);
      },
    ),
  // The page's own name, as the platform's flat settings pages are titled; the
  // page itself is "General", which says nothing in a tab.
  head: () => pageHead(i18n.t('settings:pages.general.documentTitle')),
  // A page TanStack Router draws while its loader still waits suspends only
  // itself: see `routes/sessions/$sessionId.tsx`.
  wrapInSuspense: true,
  pendingMinMs: 0,
  component: GeneralPage,
});
