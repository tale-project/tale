import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { WfEventSubscription } from '@/lib/collections/entities/wf-event-subscriptions';
import type { WfSchedule } from '@/lib/collections/entities/wf-schedules';
import type { WfWebhook } from '@/lib/collections/entities/wf-webhooks';

export function useSchedules(collection: Collection<WfSchedule, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ schedule: collection }).select(({ schedule }) => schedule),
  );

  return {
    schedules: data,
    isLoading,
  };
}

export function useWebhooks(collection: Collection<WfWebhook, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ webhook: collection }).select(({ webhook }) => webhook),
  );

  return {
    webhooks: data,
    isLoading,
  };
}

export function useEventSubscriptions(
  collection: Collection<WfEventSubscription, string>,
) {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ subscription: collection })
      .select(({ subscription }) => subscription),
  );

  return {
    subscriptions: data,
    isLoading,
  };
}
