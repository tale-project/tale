import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  FeedbackMetricsPage,
  type FeedbackKind,
} from '@/app/features/analytics/feedback/feedback-metrics-page';
import {
  feedbackMetricsSearchSchema,
  type FeedbackMetricsSearch,
} from '@/app/features/analytics/feedback/feedback-metrics-search';
import {
  periodToDays,
  type FeedbackPeriod,
} from '@/app/features/analytics/feedback/feedback-period';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/feedback',
)({
  validateSearch: feedbackMetricsSearchSchema,
  // Preload the EXACT stats args the component will request on first paint so a
  // deep-link (e.g. ?period=30&agent=foo) warms the right cache entry instead
  // of the hardcoded default (which would skeleton-flash then refetch). Mirror
  // the component: getFeedbackStats takes period/agent/model/provider (kind and
  // withCommentOnly only feed the recent-feedback list, not the aggregate).
  loaderDeps: ({ search }) => ({
    period: search.period ?? '7',
    agent: search.agent,
    model: search.model,
    provider: search.provider,
  }),
  // Bounded aggregate; never fail the transition on a transient/auth error
  // (the page's error/empty branches still render correctly).
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(context, 'feedback/queries:getFeedbackStats', {
      organizationId: params.id,
      periodDays: periodToDays(deps.period),
      agentSlug: deps.agent,
      model: deps.model,
      provider: deps.provider,
    }).catch((error: unknown) => {
      console.warn('Failed to preload feedback stats', error);
    }),
  component: FeedbackRoute,
});

function FeedbackRoute() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const period: FeedbackPeriod = search.period ?? '7';
  const kind: FeedbackKind = search.kind ?? 'all';
  const withCommentOnly = search.comments === '1';
  const agentSlug = search.agent;
  const model = search.model;
  const provider = search.provider;

  const updateSearch = useCallback(
    (next: Partial<FeedbackMetricsSearch>) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/feedback',
        params: { id: organizationId },
        search: (prev) => ({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <SettingsPage>
      <FeedbackMetricsPage
        organizationId={organizationId}
        period={period}
        kind={kind}
        withCommentOnly={withCommentOnly}
        agentSlug={agentSlug}
        model={model}
        provider={provider}
        onChangePeriod={(p) =>
          updateSearch({ period: p === '7' ? undefined : p })
        }
        onChangeKind={(k) =>
          updateSearch({ kind: k === 'all' ? undefined : k })
        }
        onToggleCommentOnly={(on) =>
          updateSearch({ comments: on ? '1' : undefined })
        }
        onSelectAgent={(slug) => updateSearch({ agent: slug ?? undefined })}
        onSelectModel={(m, p) =>
          updateSearch({ model: m ?? undefined, provider: p ?? undefined })
        }
        onClearFilters={() =>
          updateSearch({
            agent: undefined,
            model: undefined,
            provider: undefined,
          })
        }
      />
    </SettingsPage>
  );
}
