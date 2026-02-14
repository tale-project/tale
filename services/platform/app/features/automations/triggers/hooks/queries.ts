import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type WfSchedule = ConvexItemOf<
  typeof api.workflows.triggers.queries.getSchedules
>;

export type WfWebhook = ConvexItemOf<
  typeof api.workflows.triggers.queries.getWebhooks
>;

export type WfEventSubscription = ConvexItemOf<
  typeof api.workflows.triggers.queries.getEventSubscriptions
>;

export function useSchedules(workflowRootId: string) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.queries.getSchedules,
    { workflowRootId },
  );

  return {
    schedules: data ?? [],
    isLoading,
  };
}

export function useWebhooks(workflowRootId: string) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.queries.getWebhooks,
    { workflowRootId },
  );

  return {
    webhooks: data ?? [],
    isLoading,
  };
}

export function useEventSubscriptions(workflowRootId: string) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.triggers.queries.getEventSubscriptions,
    { workflowRootId },
  );

  return {
    subscriptions: data ?? [],
    isLoading,
  };
}
