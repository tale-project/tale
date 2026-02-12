import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useTestAgent() {
  return useConvexAction(api.custom_agents.test_chat_actions.testCustomAgent);
}

export function useCreateCustomAgent() {
  return useConvexAction(api.custom_agents.actions.createCustomAgent);
}

export function useDuplicateCustomAgent() {
  return useConvexAction(api.custom_agents.actions.duplicateCustomAgent);
}

export function useActivateCustomAgentVersion() {
  return useConvexAction(api.custom_agents.actions.activateCustomAgentVersion);
}

export function useCreateDraftFromVersion() {
  return useConvexAction(api.custom_agents.actions.createDraftFromVersion);
}

export function usePublishCustomAgent() {
  return useConvexAction(api.custom_agents.actions.publishCustomAgent);
}

export function useUnpublishCustomAgent() {
  return useConvexAction(api.custom_agents.actions.unpublishCustomAgent);
}

export function useCreateCustomAgentWebhook() {
  return useConvexAction(api.custom_agents.webhooks.actions.createWebhook);
}
