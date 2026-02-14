import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateSchedule(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.createSchedule,
    api.workflows.triggers.queries.getSchedules,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ cronExpression, timezone, organizationId }, { insert }) =>
        insert({
          organizationId,
          workflowRootId: workflowRootId ?? '',
          cronExpression,
          timezone,
          isActive: true,
          createdAt: Date.now(),
        }),
    },
  );
}

export function useUpdateSchedule(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.updateSchedule,
    api.workflows.triggers.queries.getSchedules,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ scheduleId, ...changes }, { update }) =>
        update(scheduleId, changes),
    },
  );
}

export function useToggleSchedule(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.toggleSchedule,
    api.workflows.triggers.queries.getSchedules,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ scheduleId }, { toggle }) => toggle(scheduleId, 'isActive'),
    },
  );
}

export function useDeleteSchedule(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.deleteSchedule,
    api.workflows.triggers.queries.getSchedules,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ scheduleId }, { remove }) => remove(scheduleId),
    },
  );
}

export function useCreateWebhook(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.createWebhook,
    api.workflows.triggers.queries.getWebhooks,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ organizationId }, { insert }) =>
        insert({
          organizationId,
          workflowRootId: workflowRootId ?? '',
          token: '',
          isActive: true,
          createdAt: Date.now(),
        }),
    },
  );
}

export function useToggleWebhook(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.toggleWebhook,
    api.workflows.triggers.queries.getWebhooks,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ webhookId }, { toggle }) => toggle(webhookId, 'isActive'),
    },
  );
}

export function useDeleteWebhook(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.deleteWebhook,
    api.workflows.triggers.queries.getWebhooks,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ webhookId }, { remove }) => remove(webhookId),
    },
  );
}

export function useCreateEventSubscription(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.createEventSubscription,
    api.workflows.triggers.queries.getEventSubscriptions,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ eventType, eventFilter, organizationId }, { insert }) =>
        insert({
          organizationId,
          workflowRootId: workflowRootId ?? '',
          eventType,
          eventFilter,
          isActive: true,
          createdAt: Date.now(),
        }),
    },
  );
}

export function useUpdateEventSubscription(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.updateEventSubscription,
    api.workflows.triggers.queries.getEventSubscriptions,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ subscriptionId, ...changes }, { update }) =>
        update(subscriptionId, changes),
    },
  );
}

export function useToggleEventSubscription(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.toggleEventSubscription,
    api.workflows.triggers.queries.getEventSubscriptions,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ subscriptionId }, { toggle }) =>
        toggle(subscriptionId, 'isActive'),
    },
  );
}

export function useDeleteEventSubscription(workflowRootId?: string) {
  return useConvexOptimisticMutation(
    api.workflows.triggers.mutations.deleteEventSubscription,
    api.workflows.triggers.queries.getEventSubscriptions,
    {
      queryArgs: workflowRootId ? { workflowRootId } : undefined,
      onMutate: ({ subscriptionId }, { remove }) => remove(subscriptionId),
    },
  );
}
