import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import {
  FeedbackMetricsPage,
  type FeedbackKind,
  type FeedbackPeriod,
} from '@/app/features/analytics/feedback/feedback-metrics-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';

const searchSchema = z.object({
  period: z.enum(['1', '7', '30', '90', 'all']).optional(),
  kind: z.enum(['all', 'message', 'arena']).optional(),
  comments: z.enum(['1']).optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

type SearchValues = z.infer<typeof searchSchema>;

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/feedback',
)({
  validateSearch: searchSchema,
  // Warm the aggregated feedback stats for the default view (7d / no filters)
  // so a warm navigation paints the real cards+arena+tables instead of the
  // skeleton. Bounded aggregate; never fail the transition on a transient/auth
  // error (the page's error/empty branches still render correctly).
  loader: ({ context, params }) =>
    ensureConvexQuery(context, api.feedback.queries.getFeedbackStats, {
      organizationId: params.id,
      periodDays: 7,
      agentSlug: undefined,
      model: undefined,
      provider: undefined,
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
    (next: Partial<SearchValues>) => {
      void navigate({
        to: '/dashboard/$id/settings/governance/feedback',
        params: { id: organizationId },
        search: (prev) => ({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <div className="pb-8">
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
    </div>
  );
}
