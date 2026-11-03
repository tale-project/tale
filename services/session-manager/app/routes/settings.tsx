import { createFileRoute } from '@tanstack/react-router';

import { SettingsLayout } from '@/app/features/settings/components/settings-layout';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings')({
  head: () => pageHead(i18n.t('navigation:sections.settings')),
  component: SettingsLayout,
});
