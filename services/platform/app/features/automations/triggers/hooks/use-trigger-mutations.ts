import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useCreateSchedule() {
  return useMutation(api.workflows.triggers.mutations.createSchedule);
}

export function useUpdateSchedule() {
  return useMutation(api.workflows.triggers.mutations.updateSchedule);
}

export function useToggleSchedule() {
  return useMutation(api.workflows.triggers.mutations.toggleSchedule);
}

export function useDeleteSchedule() {
  return useMutation(api.workflows.triggers.mutations.deleteSchedule);
}

export function useCreateWebhook() {
  return useMutation(api.workflows.triggers.mutations.createWebhook);
}

export function useToggleWebhook() {
  return useMutation(api.workflows.triggers.mutations.toggleWebhook);
}

export function useDeleteWebhook() {
  return useMutation(api.workflows.triggers.mutations.deleteWebhook);
}

export function useCreateEventSubscription() {
  return useMutation(api.workflows.triggers.mutations.createEventSubscription);
}

export function useUpdateEventSubscription() {
  return useMutation(api.workflows.triggers.mutations.updateEventSubscription);
}

export function useToggleEventSubscription() {
  return useMutation(api.workflows.triggers.mutations.toggleEventSubscription);
}

export function useDeleteEventSubscription() {
  return useMutation(api.workflows.triggers.mutations.deleteEventSubscription);
}
