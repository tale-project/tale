import { createFileRoute } from '@tanstack/react-router';

import { AiAccessPage } from '@/app/features/settings/components/ai-access-page';
import { settingsQuery } from '@/app/features/settings/hooks/use-settings';
import { pageHead } from '@/app/lib/page-head';
import { waitForRead } from '@/app/lib/route-read';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/settings/ai-access')({
  // Whether the assistants may connect is in before the page's first frame:
  // see `routes/settings/general.tsx`.
  loader: ({ context }) =>
    waitForRead(
      context.queryClient.ensureQueryData(settingsQuery()),
      (error: unknown) => {
        console.warn('Failed to load the settings', error);
      },
    ),
  head: () => pageHead(i18n.t('settings:pages.aiAccess.title')),
  // A page TanStack Router draws while its loader still waits suspends only
  // itself: see `routes/sessions/$sessionId.tsx`.
  wrapInSuspense: true,
  pendingMinMs: 0,
  component: AiAccessPage,
});
