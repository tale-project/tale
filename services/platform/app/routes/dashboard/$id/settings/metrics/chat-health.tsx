import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ChatHealthMetricsPage } from '@/app/features/analytics/chat-health/chat-health-metrics-page';
import {
  periodToDays,
  type ChatHealthPeriod,
} from '@/app/features/analytics/chat-health/chat-health-period';
import { chatHealthMetricsSearchSchema } from '@/app/features/analytics/chat-health/chat-health-search';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/chat-health',
)({
  validateSearch: chatHealthMetricsSearchSchema,
  // Preload the exact rollup the component requests on first paint so a
  // deep-link (?period=30) warms the right cache entry instead of the default.
  loaderDeps: ({ search }) => ({ period: search.period ?? '7' }),
  // Bounded aggregate; never fail the transition on a transient/auth error —
  // the page's error/empty branches still render correctly.
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(
      context,
      api.message_metadata.queries.getChatHealthRollup,
      {
        organizationId: params.id,
        periodDays: periodToDays(deps.period),
      },
    ).catch((error: unknown) => {
      console.warn('Failed to preload chat health rollup', error);
    }),
  component: ChatHealthRoute,
});

function ChatHealthRoute() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const period: ChatHealthPeriod = search.period ?? '7';

  const onChangePeriod = useCallback(
    (next: ChatHealthPeriod) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/chat-health',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          period: next === '7' ? undefined : next,
        }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <SettingsPage>
      <ChatHealthMetricsPage
        organizationId={organizationId}
        period={period}
        onChangePeriod={onChangePeriod}
      />
    </SettingsPage>
  );
}
