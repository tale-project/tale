import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCreateSchedule() {
  return useMutation(api.workflows.triggers.schedules.createSchedule);
}

export function useUpdateSchedule() {
  return useMutation(api.workflows.triggers.schedules.updateSchedule);
}

export function useToggleSchedule() {
  return useMutation(api.workflows.triggers.schedules.toggleSchedule);
}

export function useDeleteSchedule() {
  return useMutation(api.workflows.triggers.schedules.deleteSchedule);
}

export function useCreateWebhook() {
  return useMutation(api.workflows.triggers.webhooks.createWebhook);
}

export function useToggleWebhook() {
  return useMutation(api.workflows.triggers.webhooks.toggleWebhook);
}

export function useDeleteWebhook() {
  return useMutation(api.workflows.triggers.webhooks.deleteWebhook);
}
