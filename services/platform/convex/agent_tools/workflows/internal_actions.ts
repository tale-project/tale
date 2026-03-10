import { v, type Infer } from 'convex/values';

import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
  WorkflowUpdateMetadata,
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
- Workflow: ${metadata.workflowName ?? 'Unknown Workflow'}
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
        } catch (error) {
          console.error('Failed to save workflow run system message:', error);
        }
      }

      return {
        success: true,
        executionId,
        message: `Workflow "${metadata.workflowName ?? 'Unknown Workflow'}" started successfully.`,
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

export const executeApprovedWorkflowUpdate = internalAction({
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
        `Cannot execute workflow update: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'workflow_update') {
      throw new Error(
        `Invalid approval type: expected "workflow_update", got "${approval.resourceType}"`,
      );
    }

    if (approval.executedAt) {
      throw new Error(
        'This workflow update approval has already been executed',
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowUpdateMetadata for workflow_update approvals
    const metadata = approval.metadata as WorkflowUpdateMetadata;

    if (!metadata?.workflowId || !metadata?.updateType) {
      throw new Error(
        'Invalid approval metadata: missing workflow ID or update type',
      );
    }

    const workflow: {
      _id: unknown;
      versionNumber: number;
      name: string;
    } | null = await ctx.runQuery(
      internal.wf_definitions.internal_queries.resolveWorkflow,
      {
        wfDefinitionId: toId<'wfDefinitions'>(metadata.workflowId),
      },
    );

    if (!workflow) {
      throw new Error('Workflow not found — it may have been deleted');
    }

    if (workflow.versionNumber !== metadata.workflowVersionNumber) {
      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowUpdateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionError:
            'Workflow was modified after this update was proposed. Please re-request the update.',
        },
      );
      throw new Error(
        'Workflow was modified after this update was proposed. Please re-request the update.',
      );
    }

    try {
      if (metadata.updateType === 'full_save') {
        if (!metadata.workflowConfig || !metadata.stepsConfig) {
          throw new Error(
            'Invalid approval metadata: missing workflow configuration for full save',
          );
        }

        await ctx.runMutation(
          internal.wf_definitions.internal_mutations.saveWorkflowWithSteps,
          {
            organizationId: approval.organizationId,
            workflowId: toId<'wfDefinitions'>(metadata.workflowId),
            workflowConfig: {
              description: metadata.workflowConfig.description,
              version: metadata.workflowConfig.version,
              workflowType: metadata.workflowConfig.workflowType,
              config: metadata.workflowConfig.config,
            },
            stepsConfig: metadata.stepsConfig,
          },
        );
      } else if (metadata.updateType === 'step_patch') {
        if (!metadata.stepRecordId || !metadata.stepUpdates) {
          throw new Error(
            'Invalid approval metadata: missing step record ID or updates for step patch',
          );
        }

        const result = await ctx.runMutation(
          internal.wf_step_defs.internal_mutations.patchStep,
          {
            stepRecordId: toId<'wfStepDefs'>(metadata.stepRecordId),
            updates: metadata.stepUpdates,
          },
        );

        if (!result) {
          throw new Error(
            `Step "${metadata.stepName ?? metadata.stepRecordId}" not found — it may have been deleted`,
          );
        }
      } else {
        throw new Error(`Unknown update type: ${String(metadata.updateType)}`);
      }

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowUpdateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionError: null,
        },
      );

      if (approval.threadId) {
        try {
          const siteUrl = process.env.SITE_URL || '';
          const workflowUrl = `${siteUrl}/automations/${metadata.workflowId}`;
          const updateDetail =
            metadata.updateType === 'full_save'
              ? `All steps replaced (${metadata.stepsConfig?.length ?? 0} steps)`
              : `Step "${metadata.stepName ?? 'unknown'}" updated`;

          const messageContent = `[WORKFLOW_UPDATED]
The user has approved the workflow update request.

Update Details:
- Workflow ID: ${metadata.workflowId}
- Workflow: ${metadata.workflowName}
- Change: ${updateDetail}
- Summary: ${metadata.updateSummary}
- URL: ${workflowUrl}

Instructions:
- Use workflow ID "${metadata.workflowId}" for any subsequent operations on this workflow
- Inform the user that the workflow has been updated successfully`;

          await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations.saveSystemMessage,
            {
              threadId: approval.threadId,
              content: messageContent,
            },
          );
        } catch (error) {
          console.error(
            'Failed to save workflow update system message:',
            error,
          );
        }
      }

      return {
        success: true,
        workflowId: metadata.workflowId,
        message: `Workflow "${metadata.workflowName}" updated successfully. ${metadata.updateSummary}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowUpdateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionError: errorMessage,
        },
      );

      throw error;
    }
  },
});
