import { createFileRoute } from '@tanstack/react-router';

import { SessionsLayout } from '@/app/features/sessions/components/sessions-layout';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/sessions')({
  head: () => pageHead(i18n.t('navigation:sections.sessions')),
  component: SessionsLayout,
});
