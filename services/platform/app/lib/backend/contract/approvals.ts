/**
 * `approvals` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../approvals.ts` are what
 * actually serve them.
 */

export interface ApprovalsContract {
  'approvals/mutations:updateApprovalStatus': {
    kind: 'mutation';
    args: {
      comments?: string;
      triggerAgentResponse?: boolean;
      status: 'pending' | 'rejected' | 'executing' | 'completed';
      approvalId: string;
    };
    returns: null;
  };
  'approvals/queries:getApproval': {
    kind: 'query';
    args: { organizationId: string; approvalId: string };
    returns: null | {
      metadata?: Record<string, unknown>;
      threadId?: string;
      messageId?: string;
      reviewedAt?: number;
      wfExecutionId?: string;
      stepSlug?: string;
      approvedBy?: string;
      dueDate?: number;
      executedAt?: number;
      executionError?: string;
      status: 'pending' | 'rejected' | 'executing' | 'completed';
      organizationId: string;
      _creationTime: number;
      resourceType:
        | 'conversations'
        | 'erasure'
        | 'connector_operation'
        | 'workflow_creation'
        | 'workflow_run'
        | 'workflow_update'
        | 'human_input_request'
        | 'document_write'
        | 'knowledge_write'
        | 'location_request'
        | 'mcp_tool_call'
        | 'task_review'
        | 'document_record_review'
        | 'external_agent_plan'
        | 'external_agent_human_control'
        | 'operator_input';
      resourceId: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      _id: string;
    };
  };
}
