import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { WfEventSubscription } from '@/lib/collections/entities/wf-event-subscriptions';
import type { WfSchedule } from '@/lib/collections/entities/wf-schedules';
import type { WfWebhook } from '@/lib/collections/entities/wf-webhooks';

import { createWfEventSubscriptionsCollection } from '@/lib/collections/entities/wf-event-subscriptions';
import { createWfSchedulesCollection } from '@/lib/collections/entities/wf-schedules';
import { createWfWebhooksCollection } from '@/lib/collections/entities/wf-webhooks';
import { useCollection } from '@/lib/collections/use-collection';

export function useScheduleCollection(workflowRootId: string) {
  return useCollection(
    'wf-schedules',
    createWfSchedulesCollection,
    workflowRootId,
  );
}

export function useWebhookCollection(workflowRootId: string) {
  return useCollection(
    'wf-webhooks',
    createWfWebhooksCollection,
    workflowRootId,
  );
}

export function useEventSubscriptionCollection(workflowRootId: string) {
  return useCollection(
    'wf-event-subscriptions',
    createWfEventSubscriptionsCollection,
    workflowRootId,
  );
}

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
