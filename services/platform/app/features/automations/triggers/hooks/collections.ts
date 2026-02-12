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
