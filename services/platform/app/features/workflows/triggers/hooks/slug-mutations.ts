import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateSchedule() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.createScheduleBySlug,
  );
}

export function useUpdateSchedule() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.updateScheduleBySlug,
  );
}

export function useToggleSchedule() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.toggleScheduleBySlug,
  );
}

export function useDeleteSchedule() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.deleteScheduleBySlug,
  );
}

export function useCreateWebhook() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.createWebhookBySlug,
  );
}

export function useToggleWebhook() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.toggleWebhookBySlug,
  );
}

export function useDeleteWebhook() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.deleteWebhookBySlug,
  );
}

export function useCreateEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.createEventSubscriptionBySlug,
  );
}

export function useUpdateEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.updateEventSubscriptionBySlug,
  );
}

export function useToggleEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.toggleEventSubscriptionBySlug,
  );
}

export function useDeleteEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.slug_mutations.deleteEventSubscriptionBySlug,
  );
}
