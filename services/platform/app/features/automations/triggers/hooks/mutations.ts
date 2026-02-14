import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateSchedule() {
  return useConvexMutation(api.workflows.triggers.mutations.createSchedule);
}

export function useUpdateSchedule() {
  return useConvexMutation(api.workflows.triggers.mutations.updateSchedule);
}

export function useToggleSchedule() {
  return useConvexMutation(api.workflows.triggers.mutations.toggleSchedule);
}

export function useDeleteSchedule() {
  return useConvexMutation(api.workflows.triggers.mutations.deleteSchedule);
}

export function useCreateWebhook() {
  return useConvexMutation(api.workflows.triggers.mutations.createWebhook);
}

export function useToggleWebhook() {
  return useConvexMutation(api.workflows.triggers.mutations.toggleWebhook);
}

export function useDeleteWebhook() {
  return useConvexMutation(api.workflows.triggers.mutations.deleteWebhook);
}

export function useCreateEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.mutations.createEventSubscription,
  );
}

export function useUpdateEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.mutations.updateEventSubscription,
  );
}

export function useToggleEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.mutations.toggleEventSubscription,
  );
}

export function useDeleteEventSubscription() {
  return useConvexMutation(
    api.workflows.triggers.mutations.deleteEventSubscription,
  );
}
