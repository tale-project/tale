import { v, type Infer } from 'convex/values';

import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
} from '../../approvals/types';

import { jsonValueValidator } from '../../../lib/shared/schemas/utils/json-value';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { toId } from '../../lib/type_cast_helpers';

type JsonValue = Infer<typeof jsonValueValidator>;

export const executeApprovedWorkflowCreation = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      threadId?: string;
      executedAt?: number;
      metadata?: unknown;
    } | null = await ctx.runQuery(
      internal.approvals.internal_queries.getApprovalById,
      {
        approvalId: args.approvalId,
      },
    );

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'approved') {
      throw new Error(
        `Cannot execute workflow creation: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'workflow_creation') {
      throw new Error(
        `Invalid approval type: expected "workflow_creation", got "${approval.resourceType}"`,
      );
    }

    // Idempotency guard: prevent double-execution from rapid clicks or retries
    if (approval.executedAt) {
      throw new Error(
        'This workflow creation approval has already been executed',
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowCreationMetadata for workflow_creation approvals
    const metadata = approval.metadata as WorkflowCreationMetadata;

    if (!metadata?.workflowConfig || !metadata?.stepsConfig) {
      throw new Error(
        'Invalid approval metadata: missing workflow configuration',
      );
    }

    try {
      const result = await ctx.runMutation(
        internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps,
        {
          organizationId: approval.organizationId,
          workflowConfig: metadata.workflowConfig,
          stepsConfig: metadata.stepsConfig,
        },
      );

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowId: result.workflowId,
          executionError: null,
        },
      );

      if (approval.threadId) {
        const siteUrl = process.env.SITE_URL || '';
        const workflowUrl = `${siteUrl}/automations/${result.workflowId}`;
        const messageContent = `[WORKFLOW_CREATED]
The user has approved the workflow creation request.

Workflow Details:
- ID: ${result.workflowId}
- Name: ${metadata.workflowName}
- Steps: ${metadata.stepsConfig.length}
- Status: draft
- URL: ${workflowUrl}

Instructions:
- Use workflow ID "${result.workflowId}" for any subsequent read/update operations on this workflow
- The workflow is in draft status and can be edited
- Inform the user that the workflow has been created successfully`;

        await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations.saveSystemMessage,
          {
            threadId: approval.threadId,
            content: messageContent,
          },
        );
      }

      return {
        success: true,
        workflowId: result.workflowId,
        stepCount: result.stepIds.length,
        message: `Workflow "${metadata.workflowName}" created successfully with ${result.stepIds.length} steps.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowId: null,
          executionError: errorMessage,
        },
      );

      throw error;
    }
  },
});

export const executeApprovedWorkflowRun = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      threadId?: string;
      executedAt?: number;
      metadata?: unknown;
    } | null = await ctx.runQuery(
      internal.approvals.internal_queries.getApprovalById,
      {
        approvalId: args.approvalId,
      },
    );

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'approved') {
      throw new Error(
        `Cannot execute workflow run: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'workflow_run') {
      throw new Error(
        `Invalid approval type: expected "workflow_run", got "${approval.resourceType}"`,
      );
    }

    // Idempotency guard: prevent double-execution from rapid clicks or retries
    if (approval.executedAt) {
      throw new Error('This workflow run approval has already been executed');
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowRunMetadata for workflow_run approvals
    const metadata = approval.metadata as WorkflowRunMetadata;

    if (!metadata?.workflowId) {
      throw new Error('Invalid approval metadata: missing workflow ID');
    }

    try {
      const executionId = await ctx.runMutation(
        internal.workflow_engine.internal_mutations.startWorkflow,
        {
          organizationId: approval.organizationId,
          wfDefinitionId: toId<'wfDefinitions'>(metadata.workflowId),
          input: metadata.parameters ?? {},
          triggeredBy: 'agent_tool:run_workflow',
          triggerData: {
            approvalId: args.approvalId,
            approvedBy: args.approvedBy,
          },
        },
      );

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowRunApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionId,
          executionError: null,
        },
      );

      // Post system message (separate try/catch — failure here should not
      // mark the execution as failed since the workflow already started)
      if (approval.threadId) {
        try {
          const messageContent = `[WORKFLOW_STARTED]
The user has approved the workflow run request.

Execution Details:
- Execution ID: ${executionId}
- Workflow: ${metadata.workflowName}
- Status: running

Instructions:
- The workflow is now executing asynchronously
- Inform the user that the workflow has been started successfully`;

          await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations.saveSystemMessage,
            {
              threadId: approval.threadId,
              content: messageContent,
            },
          );
        } catch {
          // System message failure is non-critical; execution already started
        }
      }

      return {
        success: true,
        executionId,
        message: `Workflow "${metadata.workflowName}" started successfully.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowRunApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionId: null,
          executionError: errorMessage,
        },
      );

      throw error;
    }
  },
});
