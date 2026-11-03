import { createFileRoute } from '@tanstack/react-router';

import { AiAccessPage } from '@/app/features/settings/components/ai-access-page';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings/ai-access')({
  head: () => pageHead(i18n.t('settings:pages.aiAccess.title')),
  component: AiAccessPage,
});
