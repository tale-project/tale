import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type WfSchedule = ConvexItemOf<
  typeof api.workflows.triggers.slug_queries.getSchedulesBySlug
>;

export type WfWebhook = ConvexItemOf<
  typeof api.workflows.triggers.slug_queries.getWebhooksBySlug
>;

export type WfEventSubscription = ConvexItemOf<
  typeof api.workflows.triggers.slug_queries.getEventSubscriptionsBySlug
>;

export function useSchedules(organizationId: string, workflowSlug: string) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.slug_queries.getSchedulesBySlug,
    { organizationId, workflowSlug },
  );

  return {
    schedules: data ?? [],
    isLoading,
  };
}

export function useWebhooks(organizationId: string, workflowSlug: string) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.slug_queries.getWebhooksBySlug,
    { organizationId, workflowSlug },
  );

  return {
    webhooks: data ?? [],
    isLoading,
  };
}

export function useEventSubscriptions(
  organizationId: string,
  workflowSlug: string,
) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.slug_queries.getEventSubscriptionsBySlug,
    { organizationId, workflowSlug },
  );

  return {
    subscriptions: data ?? [],
    isLoading,
  };
}
