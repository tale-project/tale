import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateSchedule() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.createSchedule,
  );
  return mutateAsync;
}

export function useUpdateSchedule() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.updateSchedule,
  );
  return mutateAsync;
}

export function useToggleSchedule() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.toggleSchedule,
  );
  return mutateAsync;
}

export function useDeleteSchedule() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.deleteSchedule,
  );
  return mutateAsync;
}

export function useCreateWebhook() {
  const { mutateAsync, isPending } = useConvexMutation(
    api.workflows.triggers.mutations.createWebhook,
  );
  return { mutateAsync, isPending };
}

export function useToggleWebhook() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.toggleWebhook,
  );
  return mutateAsync;
}

export function useDeleteWebhook() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.deleteWebhook,
  );
  return mutateAsync;
}

export function useCreateEventSubscription() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.createEventSubscription,
  );
  return mutateAsync;
}

export function useUpdateEventSubscription() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.updateEventSubscription,
  );
  return mutateAsync;
}

export function useToggleEventSubscription() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.toggleEventSubscription,
  );
  return mutateAsync;
}

export function useDeleteEventSubscription() {
  const { mutateAsync } = useConvexMutation(
    api.workflows.triggers.mutations.deleteEventSubscription,
  );
  return mutateAsync;
}
