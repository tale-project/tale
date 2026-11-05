import { createFileRoute } from '@tanstack/react-router';

import { SessionsLayout } from '@/app/features/sessions/components/sessions-layout';
import {
  SESSIONS_PAGE_SIZE,
  sessionListQuery,
} from '@/app/features/sessions/hooks/use-session-list';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/sessions')({
  // The list beside every page of the section is asked for with the section,
  // under the key the list reads, and not waited for: see
  // `routes/proxies.tsx`.
  loader: ({ context }) => {
    void context.queryClient
      .ensureQueryData(sessionListQuery(SESSIONS_PAGE_SIZE))
      .catch((error: unknown) => {
        console.warn('Failed to load the sessions', error);
      });
  },
  head: () => pageHead(i18n.t('navigation:sections.sessions')),
  component: SessionsLayout,
});
