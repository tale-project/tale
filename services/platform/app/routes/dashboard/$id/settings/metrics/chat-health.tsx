import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ChatHealthMetricsPage } from '@/app/features/analytics/chat-health/chat-health-metrics-page';
import {
  chatHealthMetricsSearchSchema,
  periodToDays,
  type ChatHealthPeriod,
} from '@/app/features/analytics/chat-health/chat-health-period';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/chat-health',
)({
  validateSearch: chatHealthMetricsSearchSchema,
  // Preload the exact aggregates the component requests on first paint so a
  // deep-link (?period=30) warms the right cache entries instead of the
  // default.
  loaderDeps: ({ search }) => ({ period: search.period ?? '7' }),
  // Bounded aggregates; never fail the transition on a transient/auth error —
  // the page's error/empty branches still render correctly.
  loader: ({ context, params, deps }) => {
    const args = {
      organizationId: params.id,
      periodDays: periodToDays(deps.period),
    };
    return Promise.all([
      ensureConvexQuery(context, 'chat/messages:getOrgChatHealth', args),
      ensureConvexQuery(
        context,
        'chat_filter_events/queries:getGuardrailStats',
        args,
      ),
    ]).catch((error: unknown) => {
      console.warn('Failed to preload chat health metrics', error);
    });
  },
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
