import { updateDocumentQuery } from '@/app/hooks/optimistic-updates';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUnifiedChatWithAgent() {
  // Track B: the entry is now a fast V8 mutation (chatWithAgentTurn) that marks
  // generating + schedules a single durable node action for resolution +
  // generation — keeping the orchestration off the Node event loop so
  // generation isn't starved by a concurrent node action. The hook surface
  // (mutateAsync) is unchanged for callers.
  return useConvexMutation(api.agents.chat_turn.chatWithAgentTurn);
}

export function useArenaChat() {
  return useConvexAction(api.agents.arena_chat.arenaChat);
}

export function useSubmitHumanInputResponse() {
  return useConvexAction(
    api.agent_tools.human_input.actions.submitHumanInputResponse,
  );
}

export function useEditHumanInputResponse() {
  return useConvexAction(
    api.agent_tools.human_input.actions.editHumanInputResponse,
  );
}

export function useSubmitLocationResponse() {
  return useConvexAction(
    api.agent_tools.location.actions.submitLocationResponse,
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

export function useExecuteApprovedDocumentWrite() {
  return useConvexAction(api.approvals.actions.executeApprovedDocumentWrite);
}

export function useCreateThread() {
  return useConvexMutation(api.threads.mutations.createChatThread);
}

export function useCreateArenaThreadB() {
  return useConvexMutation(api.threads.mutations.createArenaThreadB);
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useDeleteThread() {
  return useConvexMutation(api.threads.mutations.deleteChatThread);
}

export function useArchiveThread() {
  return useConvexMutation(api.threads.mutations.archiveChatThread);
}

export function useUnarchiveThread() {
  return useConvexMutation(api.threads.mutations.unarchiveChatThread);
}

/** Soft-delete (move to Trash) every one of the current user's chats. */
export function useDeleteAllThreads() {
  return useConvexMutation(api.threads.mutations.deleteAllChatThreads);
}

/** Archive every one of the current user's active chats. */
export function useArchiveAllThreads() {
  return useConvexMutation(api.threads.mutations.archiveAllChatThreads);
}

export function useUpdateThread() {
  return useConvexMutation(api.threads.mutations.updateChatThread);
}

export function useSetThreadPinned() {
  return useConvexMutation(api.threads.mutations.setThreadPinned);
}

/**
 * Persist the canvas (workspace) pane state for a thread. Wraps the server
 * mutation in an optimistic patch against the shared `getThreadMeta` query
 * so toggling the pane (or switching files) updates the UI instantly —
 * Convex rolls the patch back if the server mutation fails.
 *
 * Field semantics:
 *   - `canvasOpen` undefined  → keep current value
 *   - `canvasActiveFilePath`:
 *       undefined → keep current value
 *       null      → clear the override (next render uses the first listed file)
 *       string    → set the active path
 */
export function useSetThreadCanvasState() {
  return useConvexMutation(api.threads.mutations.setThreadCanvasState, {
    // Pane toggles are best-effort UI state — a transient failure already
    // rolls back via the optimistic patch; surfacing a toast on every
    // re-mount-during-disconnect would be noise.
    errorToast: false,
    optimisticUpdate: (store, args) =>
      updateDocumentQuery(
        store,
        api.threads.queries.getThreadMeta,
        { threadId: args.threadId },
        (current) => {
          // `getThreadMeta` returns `null` until the row loads — skip the
          // optimistic patch rather than dereferencing null.
          if (!current) return current;
          return {
            ...current,
            canvasState: {
              isOpen: args.canvasOpen ?? current.canvasState.isOpen,
              activeFilePath:
                args.canvasActiveFilePath === undefined
                  ? current.canvasState.activeFilePath
                  : args.canvasActiveFilePath,
            },
          };
        },
      ),
  });
}

export function useMarkThreadRead() {
  return useConvexMutation(api.threads.mutations.markThreadRead);
}

export function useCancelGeneration() {
  return useConvexMutation(api.threads.mutations.cancelGeneration);
}

export function useShareThread() {
  return useConvexMutation(api.threads.mutations.shareThread);
}

export function useUnshareThread() {
  return useConvexMutation(api.threads.mutations.unshareThread);
}

export function useForkThread() {
  return useConvexMutation(api.threads.mutations.forkThread);
}

export function useForkOwnThread() {
  return useConvexMutation(api.threads.mutations.forkOwnThread);
}

export function useForkAndChat() {
  return useConvexAction(api.threads.mutations.forkAndChat);
}

export function useEditAndBranch() {
  return useConvexAction(api.threads.mutations.editAndBranch);
}
