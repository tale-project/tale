/**
 * Dynamic workflow handler - business logic for executing workflows
 */

import type { WorkflowCtx } from '@convex-dev/workflow';
import type { RetryBehavior } from '@convex-dev/workpool';

import { Infer, v } from 'convex/values';

import type { Doc, Id } from '../../../_generated/dataModel';

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { jsonValueValidator } from '../../../lib/validators/json';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export type DynamicWorkflowArgs = {
  organizationId: string;
  executionId: Id<'wfExecutions'>;
  workflowDefinition: ConvexJsonValue;
  steps: ConvexJsonValue[];
  input?: ConvexJsonValue;
  triggeredBy: string;
  triggerData?: ConvexJsonValue;
  resumeFromStepSlug?: string;
  resumeVariables?: ConvexJsonValue;
  threadId?: string;
};

function buildRetryBehaviorFromPolicy(policy?: {
  maxRetries: number;
  backoffMs: number;
}): RetryBehavior | undefined {
  if (!policy) return undefined;
  const { maxRetries, backoffMs } = policy;
  if (maxRetries <= 0) return undefined;
  return {
    maxAttempts: maxRetries + 1,
    initialBackoffMs: backoffMs,
    base: 2,
  };
}

export async function handleDynamicWorkflow(
  step: WorkflowCtx,
  args: DynamicWorkflowArgs,
): Promise<void> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexJsonValue from Convex scheduler; workflowDefinition is always serialized Doc<'wfDefinitions'>
  const workflowDefinition = args.workflowDefinition as Doc<'wfDefinitions'>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexJsonValue from Convex scheduler; steps is always serialized Array<Doc<'wfStepDefs'>>
  const stepDefinitions = args.steps as Array<Doc<'wfStepDefs'>>;

  debugLog('dynamicWorkflow Starting workflow execution', {
    executionId: args.executionId,
    workflowName: workflowDefinition.name,
    stepsCount: stepDefinitions.length,
  });

  // Allow both 'active' and 'draft' workflows to execute
  // This enables testing and development without requiring activation
  if (
    workflowDefinition.status !== 'active' &&
    workflowDefinition.status !== 'draft'
  ) {
    console.error('[dynamicWorkflow] Workflow cannot be executed', {
      status: workflowDefinition.status,
    });
    throw new Error(
      `Workflow cannot be executed with status: ${workflowDefinition.status}`,
    );
  }

  const executionId = args.executionId;

  if (stepDefinitions.length === 0) {
    await step.runAction(
      internal.workflow_engine.internal_actions.serializeExecutionOutput,
      {
        executionId,
      },
    );
    return;
  }

  // executeStep will handle initial variable setup and secrets
  // stepConfig and workflowConfig are now loaded from database inside executeStep

  const stepMap = new Map<string, (typeof stepDefinitions)[0]>();
  for (const stepDef of stepDefinitions) {
    stepMap.set(stepDef.stepSlug, stepDef);
  }

  let currentStepSlug =
    args.resumeFromStepSlug ??
    (stepDefinitions.find(
      (s) => s.stepType === 'start' || s.stepType === 'trigger',
    )?.stepSlug ||
      stepDefinitions[0]?.stepSlug);

  while (currentStepSlug) {
    const stepDef = stepMap.get(currentStepSlug);
    if (!stepDef) {
      throw new Error(`Step not found: ${currentStepSlug}`);
    }

    // Determine retry policy: step-level override > workflow-level default
    // Access retryPolicy safely - not all step config types have it
    const workflowRetryPolicy = workflowDefinition?.config?.retryPolicy ?? null;
    const stepConfig = isRecord(stepDef.config) ? stepDef.config : undefined;
    const stepRetryPolicy =
      stepConfig &&
      'retryPolicy' in stepConfig &&
      isRecord(stepConfig.retryPolicy)
        ? {
            maxRetries:
              typeof stepConfig.retryPolicy.maxRetries === 'number'
                ? stepConfig.retryPolicy.maxRetries
                : 0,
            backoffMs:
              typeof stepConfig.retryPolicy.backoffMs === 'number'
                ? stepConfig.retryPolicy.backoffMs
                : 0,
          }
        : null;
    const effectiveRetryPolicy =
      stepRetryPolicy ?? workflowRetryPolicy ?? undefined;
    const retryBehavior = buildRetryBehaviorFromPolicy(effectiveRetryPolicy);

    const stepResult = await step.runAction(
      internal.workflow_engine.internal_actions.executeStep,
      {
        organizationId: stepDef.organizationId,
        executionId: executionId,
        stepSlug: stepDef.stepSlug,
        stepType: stepDef.stepType,
        stepName: stepDef.name,
        threadId: args.threadId, // Pass shared threadId for agent orchestration workflows
        initialInput: args.input,
        resumeVariables: args.resumeVariables,
      },
      {
        name: `${stepDef.name} (${stepDef.stepType})`,
        retry: retryBehavior,
      },
    );

    // Note: If step execution fails, it will throw an exception
    // No need to check for success field anymore

    let nextStepSlug: string | null = null;

    // Check if there's an explicit nextSteps mapping for this port
    // nextSteps is typed as Record<string, string> in schema
    const nextStepsMap = stepDef.nextSteps ?? {};
    nextStepSlug = nextStepsMap[stepResult.port] ?? null;

    // Handle special 'noop' keyword - means do nothing and end workflow
    if (nextStepSlug === 'noop') {
      debugLog('dynamicWorkflow Noop step reached, finishing workflow', {
        fromStepSlug: stepDef.stepSlug,
        port: stepResult.port,
      });
      break;
    }

    const hasAnyMapping = Object.keys(nextStepsMap).length > 0;

    if (hasAnyMapping && nextStepSlug === null) {
      throw new Error(
        `No next step for port '${stepResult.port}' on step '${stepDef.stepSlug}'. Available ports: ${Object.keys(
          nextStepsMap,
        ).join(', ')}`,
      );
    }

    // Check if the next step exists in the workflow
    if (nextStepSlug !== null && !stepMap.has(nextStepSlug)) {
      const errorMsg = `Next step '${nextStepSlug}' not found in workflow steps (from '${stepDef.stepSlug}'). Available steps: ${Array.from(stepMap.keys()).join(', ')}`;

      // Mark execution as failed before throwing
      await step.runMutation(
        internal.wf_executions.internal_mutations.failExecution,
        {
          executionId,
          error: errorMsg,
        },
      );

      throw new Error(errorMsg);
    }

    // If the step created a human input approval, pause the workflow until the user responds
    if (stepResult.approvalTaskId) {
      debugLog('dynamicWorkflow Pausing for human input approval', {
        stepSlug: stepDef.stepSlug,
        approvalTaskId: stepResult.approvalTaskId,
      });

      // Set waitingFor on execution for UI visibility
      await step.runMutation(
        internal.wf_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          waitingFor: stepResult.approvalTaskId,
          currentStepSlug: stepDef.stepSlug,
          currentStepName: stepDef.name,
        },
      );

      // Block workflow until user responds via sendEvent
      await step.awaitEvent({
        name: `approval_response:${stepResult.approvalTaskId}`,
        validator: v.object({
          response: v.union(v.string(), v.array(v.string())),
          respondedBy: v.string(),
          question: v.string(),
          timestamp: v.number(),
          stepSlug: v.string(),
        }),
      });

      // Clear waitingFor after resume (empty string signals "clear" since
      // Convex strips undefined values from serialized args)
      await step.runMutation(
        internal.wf_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          waitingFor: '',
        },
      );

      debugLog('dynamicWorkflow Resumed after human input, re-executing step', {
        stepSlug: stepDef.stepSlug,
        approvalTaskId: stepResult.approvalTaskId,
      });

      // Re-execute the same step — the LLM now has the user's response
      // available via <human_input_context> prompt injection
      continue;
    }

    currentStepSlug = nextStepSlug;
  }

  await step.runAction(
    internal.workflow_engine.internal_actions.serializeExecutionOutput,
    {
      executionId,
    },
  );
}
