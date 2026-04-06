import { v, type Infer } from 'convex/values';

import type {
  StepType,
  WorkflowJsonConfig,
  WorkflowStep,
} from '../../../lib/shared/schemas/workflows';
import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
  WorkflowUpdateMetadata,
} from '../../approvals/types';

import { jsonValueValidator } from '../../../lib/shared/schemas/utils/json-value';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { sanitizeWorkflowName } from './create_bound_workflow_tool';

const DEFAULT_ORG_SLUG = 'default';

const VALID_STEP_TYPES = new Set<StepType>([
  'start',
  'trigger',
  'llm',
  'condition',
  'action',
  'loop',
  'output',
]);

function isValidStepType(value: string): value is StepType {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime guard narrowing string to StepType union
  return VALID_STEP_TYPES.has(value as StepType);
}

function applyStepPatch(
  step: WorkflowStep,
  updates: {
    name?: string;
    stepType?: string;
    config?: Record<string, unknown>;
    nextSteps?: Record<string, string>;
  },
): WorkflowStep {
  return {
    ...step,
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.stepType !== undefined && isValidStepType(updates.stepType)
      ? { stepType: updates.stepType }
      : {}),
    ...(updates.config !== undefined ? { config: updates.config } : {}),
    ...(updates.nextSteps !== undefined
      ? { nextSteps: updates.nextSteps }
      : {}),
  };
}

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

    if (approval.status !== 'executing') {
      throw new Error(
        `Cannot execute workflow creation: approval status is "${approval.status}", expected "executing"`,
      );
    }

    if (approval.resourceType !== 'workflow_creation') {
      throw new Error(
        `Invalid approval type: expected "workflow_creation", got "${approval.resourceType}"`,
      );
    }

    // Atomic claim: prevent double-execution from rapid clicks or retries
    const claimed = await ctx.runMutation(
      internal.agent_tools.workflows.internal_mutations
        .claimWorkflowApprovalForExecution,
      { approvalId: args.approvalId },
    );
    if (!claimed) {
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
      const workflowSlug =
        metadata.workflowSlug || sanitizeWorkflowName(metadata.workflowName);

      const config: WorkflowJsonConfig = {
        name: metadata.workflowConfig.name,
        description: metadata.workflowConfig.description,
        version: metadata.workflowConfig.version,
        installed: true,
        enabled: false,
        config: metadata.workflowConfig.config,
        steps: metadata.stepsConfig.map((step, index) => ({
          stepSlug: step.stepSlug,
          name: step.name,
          stepType: step.stepType,
          config: step.config,
          nextSteps: step.nextSteps,
          order: index,
        })),
      };

      await ctx.runAction(
        internal.workflows.file_actions.saveWorkflowForExecution,
        {
          orgSlug: DEFAULT_ORG_SLUG,
          workflowSlug,
          config,
        },
      );

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowSlug: workflowSlug,
          executionError: null,
        },
      );

      if (approval.threadId) {
        const siteUrl = process.env.SITE_URL || '';
        const basePath = process.env.BASE_PATH || '';
        const workflowUrl = `${siteUrl}${basePath}/automations/${workflowSlug}`;
        const messageContent = `[WORKFLOW_CREATED]
The user has approved the workflow creation request.

Workflow Details:
- Slug: ${workflowSlug}
- Name: ${metadata.workflowName}
- Steps: ${metadata.stepsConfig.length}
- Status: draft
- URL: ${workflowUrl}

Instructions:
- Use workflow slug "${workflowSlug}" for any subsequent read/update operations on this workflow
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
        workflowSlug,
        stepCount: metadata.stepsConfig.length,
        message: `Workflow "${metadata.workflowName}" created successfully with ${metadata.stepsConfig.length} steps.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.workflows.internal_mutations
          .updateWorkflowApprovalWithResult,
        {
          approvalId: args.approvalId,
          createdWorkflowSlug: null,
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

    if (approval.status !== 'executing') {
      throw new Error(
        `Cannot execute workflow run: approval status is "${approval.status}", expected "executing"`,
      );
    }

    if (approval.resourceType !== 'workflow_run') {
      throw new Error(
        `Invalid approval type: expected "workflow_run", got "${approval.resourceType}"`,
      );
    }

    // Atomic claim: prevent double-execution from rapid clicks or retries
    const claimed = await ctx.runMutation(
      internal.agent_tools.workflows.internal_mutations
        .claimWorkflowApprovalForExecution,
      { approvalId: args.approvalId },
    );
    if (!claimed) {
      throw new Error('This workflow run approval has already been executed');
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowRunMetadata for workflow_run approvals
    const metadata = approval.metadata as WorkflowRunMetadata;

    if (!metadata?.workflowSlug) {
      throw new Error('Invalid approval metadata: missing workflow slug');
    }

    try {
      const executionId = await ctx.runAction(
        internal.workflow_engine.helpers.engine.start_workflow_from_file
          .startWorkflowFromFile,
        {
          organizationId: approval.organizationId,
          orgSlug: DEFAULT_ORG_SLUG,
          workflowSlug: metadata.workflowSlug,
          input: metadata.parameters ?? {},
          triggeredBy: 'agent_tool:run_workflow',
          triggerData: {
            approvalId: args.approvalId,
            approvedBy: args.approvedBy,
          },
          userId: args.approvedBy,
        },
      );

      if (!executionId) {
        throw new Error(
          `Failed to start workflow "${metadata.workflowName ?? metadata.workflowSlug}". It may be disabled or the file could not be read.`,
        );
      }

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

    if (approval.status !== 'executing') {
      throw new Error(
        `Cannot execute workflow update: approval status is "${approval.status}", expected "executing"`,
      );
    }

    if (approval.resourceType !== 'workflow_update') {
      throw new Error(
        `Invalid approval type: expected "workflow_update", got "${approval.resourceType}"`,
      );
    }

    // Atomic claim: prevent double-execution from rapid clicks or retries
    const claimed = await ctx.runMutation(
      internal.agent_tools.workflows.internal_mutations
        .claimWorkflowApprovalForExecution,
      { approvalId: args.approvalId },
    );
    if (!claimed) {
      throw new Error(
        'This workflow update approval has already been executed',
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowUpdateMetadata for workflow_update approvals
    const metadata = approval.metadata as WorkflowUpdateMetadata;

    const workflowSlug = metadata.workflowSlug;

    if (!workflowSlug || !metadata.updateType) {
      throw new Error(
        'Invalid approval metadata: missing workflow slug or update type',
      );
    }

    // Read the current workflow file
    const readResult: { ok: boolean; config?: WorkflowJsonConfig } =
      await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        {
          orgSlug: DEFAULT_ORG_SLUG,
          workflowSlug,
        },
      );

    if (!readResult.ok || !readResult.config) {
      throw new Error('Workflow not found — the file may have been deleted');
    }

    const currentConfig = readResult.config;

    try {
      let updatedConfig: WorkflowJsonConfig;

      if (metadata.updateType === 'full_save') {
        if (!metadata.workflowConfig || !metadata.stepsConfig) {
          throw new Error(
            'Invalid approval metadata: missing workflow configuration for full save',
          );
        }

        updatedConfig = {
          ...currentConfig,
          name: metadata.workflowConfig.name ?? currentConfig.name,
          description:
            metadata.workflowConfig.description ?? currentConfig.description,
          version: metadata.workflowConfig.version ?? currentConfig.version,
          config: metadata.workflowConfig.config ?? currentConfig.config,
          steps: metadata.stepsConfig.map((step, index) => ({
            stepSlug: step.stepSlug,
            name: step.name,
            stepType: step.stepType,
            config: step.config,
            nextSteps: step.nextSteps,
            order: index,
          })),
        };
      } else if (metadata.updateType === 'step_patch') {
        if (!metadata.stepSlug || !metadata.stepUpdates) {
          throw new Error(
            'Invalid approval metadata: missing step slug or updates for step patch',
          );
        }

        const stepSlug = metadata.stepSlug;
        const stepIndex = currentConfig.steps.findIndex(
          (s) => s.stepSlug === stepSlug,
        );

        if (stepIndex === -1) {
          throw new Error(
            `Step "${metadata.stepName ?? stepSlug}" not found — it may have been deleted`,
          );
        }

        const updatedSteps = [...currentConfig.steps];
        updatedSteps[stepIndex] = applyStepPatch(
          updatedSteps[stepIndex],
          metadata.stepUpdates,
        );

        updatedConfig = { ...currentConfig, steps: updatedSteps };
      } else if (metadata.updateType === 'multi_step_patch') {
        if (!metadata.steps || metadata.steps.length === 0) {
          throw new Error(
            'Invalid approval metadata: missing steps array for multi-step patch',
          );
        }

        const updatedSteps = [...currentConfig.steps];
        const missingSteps: string[] = [];

        for (const patch of metadata.steps) {
          const stepSlug = patch.stepSlug;
          const stepIndex = updatedSteps.findIndex(
            (s) => s.stepSlug === stepSlug,
          );

          if (stepIndex === -1) {
            missingSteps.push(`"${patch.stepName}"`);
            continue;
          }

          updatedSteps[stepIndex] = applyStepPatch(
            updatedSteps[stepIndex],
            patch.stepUpdates,
          );
        }

        if (missingSteps.length > 0) {
          throw new Error(
            `Steps ${missingSteps.join(', ')} not found — they may have been deleted`,
          );
        }

        updatedConfig = { ...currentConfig, steps: updatedSteps };
      } else {
        throw new Error(`Unknown update type: ${String(metadata.updateType)}`);
      }

      await ctx.runAction(
        internal.workflows.file_actions.saveWorkflowForExecution,
        {
          orgSlug: DEFAULT_ORG_SLUG,
          workflowSlug,
          config: updatedConfig,
        },
      );

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
          const basePath = process.env.BASE_PATH || '';
          const workflowUrl = `${siteUrl}${basePath}/automations/${workflowSlug}`;
          const updateDetail =
            metadata.updateType === 'full_save'
              ? `All steps replaced (${metadata.stepsConfig?.length ?? 0} steps)`
              : metadata.updateType === 'multi_step_patch'
                ? `${metadata.steps?.length ?? 0} steps updated: ${metadata.steps?.map((s) => `"${s.stepName}"`).join(', ')}`
                : `Step "${metadata.stepName ?? 'unknown'}" updated`;

          const messageContent = `[WORKFLOW_UPDATED]
The user has approved the workflow update request.

Update Details:
- Workflow Slug: ${workflowSlug}
- Workflow: ${metadata.workflowName}
- Change: ${updateDetail}
- Summary: ${metadata.updateSummary}
- URL: ${workflowUrl}

Instructions:
- Use workflow slug "${workflowSlug}" for any subsequent operations on this workflow
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
        workflowSlug,
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
