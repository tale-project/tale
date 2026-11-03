import { createFileRoute } from '@tanstack/react-router';

import { GeneralPage } from '@/app/features/settings/components/general-page';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings/general')({
  // The page's own name, as the platform's flat settings pages are titled; the
  // page itself is "General", which says nothing in a tab.
  head: () => pageHead(i18n.t('settings:pages.general.documentTitle')),
  component: GeneralPage,
});
