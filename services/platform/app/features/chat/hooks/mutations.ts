import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUnifiedChatWithAgent() {
  return useConvexMutation(api.custom_agents.unified_chat.chatWithAgent);
}

export function useSubmitHumanInputResponse() {
  return useConvexMutation(
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );
}

export function useUpdateApprovalStatus() {
  return useConvexMutation(api.approvals.mutations.updateApprovalStatus);
}

export function useExecuteApprovedIntegrationOperation() {
  return useConvexAction(
    api.approvals.actions.executeApprovedIntegrationOperation,
  );
}

export function useExecuteApprovedWorkflowCreation() {
  return useConvexAction(api.approvals.actions.executeApprovedWorkflowCreation);
}

export function useExecuteApprovedWorkflowRun() {
  return useConvexAction(api.approvals.actions.executeApprovedWorkflowRun);
}

export function useExecuteApprovedWorkflowUpdate() {
  return useConvexAction(api.approvals.actions.executeApprovedWorkflowUpdate);
}

export function useCreateThread() {
  return useConvexMutation(api.threads.mutations.createChatThread);
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useDeleteThread() {
  return useConvexMutation(api.threads.mutations.deleteChatThread);
}

export function useUpdateThread() {
  return useConvexMutation(api.threads.mutations.updateChatThread);
}

export function useCancelGeneration() {
  return useConvexMutation(api.threads.mutations.cancelGeneration);
}
