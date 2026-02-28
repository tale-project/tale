import 'convex/server';

declare module 'convex/server' {
  interface GenericActionCtx<DataModel extends GenericDataModel> {
    organizationId?: string;
    workflowId?: string;
    variables?: Record<string, unknown>;
    /**
     * User's team IDs for RAG search.
     * Resolved in the mutation (where auth identity is available) and passed
     * through the action to avoid insecure session table lookups.
     */
    userTeamIds?: string[];
    /**
     * Parent thread ID for sub-agent tools.
     * Used to link approval cards to the parent conversation thread
     * when a sub-agent creates approvals.
     */
    parentThreadId?: string;
  }
}
