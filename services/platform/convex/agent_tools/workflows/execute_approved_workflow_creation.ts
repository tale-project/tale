/**
 * Internal Action: Execute Approved Workflow Creation
 *
 * Creates a workflow after user approval.
 * Also injects a user message into the thread to inform the AI about the created workflow.
 */

import { internalAction, internalMutation } from '../../_generated/server';
import { v } from 'convex/values';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal, components } from '../../_generated/api';
import type { WorkflowCreationMetadata } from '../../models/approvals/types';
import { saveMessage } from '@convex-dev/agent';

/**
 * Execute an approved workflow creation
 */
export const executeApprovedWorkflowCreation = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<unknown> => {
    // Get the approval record
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      threadId?: string;
      metadata?: unknown;
    } | null = await ctx.runQuery(internal.queries.approvals.getApprovalInternal, {
      approvalId: args.approvalId,
    });

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

    const metadata = approval.metadata as WorkflowCreationMetadata;

    if (!metadata?.workflowConfig || !metadata?.stepsConfig) {
      throw new Error(
        'Invalid approval metadata: missing workflow configuration',
      );
    }

    // Execute the workflow creation with error handling
    try {
      const result = await ctx.runMutation(
        internal.wf_definitions.mutations.createWorkflow.createWorkflowWithSteps,
        {
          organizationId: approval.organizationId,
          workflowConfig: metadata.workflowConfig,
          stepsConfig: metadata.stepsConfig,
        },
      );

      // Update approval with execution result
      await ctx.runMutation(
        internal.agent_tools.workflows.execute_approved_workflow_creation
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowId: result.workflowId,
          executionError: null,
        },
      );

      // Inject a system message to inform the AI about the created workflow
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
          internal.agent_tools.workflows.execute_approved_workflow_creation
            .saveSystemMessage,
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
      // Store the error in the approval record
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.workflows.execute_approved_workflow_creation
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowId: null,
          executionError: errorMessage,
        },
      );

      // Re-throw the error so the caller knows execution failed
      throw error;
    }
  },
});

/**
 * Update approval with workflow creation result (internal mutation)
 */
export const updateWorkflowApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    createdWorkflowId: v.union(v.id('wfDefinitions'), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) return;

    const metadata = (approval.metadata || {}) as WorkflowCreationMetadata;

    // executedAt stored at both record level (for indexing/queries) and in metadata
    // (for self-contained approval context). Using single timestamp for consistency.
    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      executedAt: now,
      executionError: args.executionError || undefined,
      metadata: {
        ...metadata,
        executedAt: now,
        createdWorkflowId: args.createdWorkflowId || undefined,
        executionError: args.executionError || undefined,
      },
    });
  },
});

/**
 * Save a system message to the thread (internal mutation)
 * Uses 'system' role so AI can see it but it won't appear in user UI
 * (frontend filters to only show 'user' and 'assistant' messages)
 */
export const saveSystemMessage = internalMutation({
  args: {
    threadId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // Save as system message - visible to AI but hidden from user UI
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'system', content: args.content },
    });
  },
});
