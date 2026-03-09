import 'convex/server';

declare module 'convex/server' {
  interface GenericActionCtx<DataModel extends GenericDataModel> {
    organizationId?: string;
    workflowId?: string;
    variables?: Record<string, unknown>;
    /**
     * Parent thread ID for sub-agent tools.
     * Used to link approval cards to the parent conversation thread
     * when a sub-agent creates approvals.
     */
    parentThreadId?: string;
  }
}
