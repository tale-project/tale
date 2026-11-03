import { createFileRoute } from '@tanstack/react-router';

import { AppearancePage } from '@/app/features/settings/components/appearance-page';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings/appearance')({
  head: () => pageHead(i18n.t('settings:pages.appearance.title')),
  component: AppearancePage,
});
