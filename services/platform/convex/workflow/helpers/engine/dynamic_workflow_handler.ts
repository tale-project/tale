/**
 * Dynamic workflow handler - business logic for executing workflows
 */

import type { WorkflowCtx } from '@convex-dev/workflow';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export type DynamicWorkflowArgs = {
  organizationId: string;
  executionId: Id<'wfExecutions'>;
  workflowDefinition: any;
  steps: Array<any>;
  input?: any;
  triggeredBy: string;
  triggerData?: any;
  resumeFromStepSlug?: string;
  resumeVariables?: any;
  threadId?: string;
};
import type { RetryBehavior } from '@convex-dev/workpool';

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
  debugLog('dynamicWorkflow Starting workflow execution', {
    executionId: args.executionId,
    workflowName: args.workflowDefinition.name,
    stepsCount: args.steps.length,
  });

  const { workflowDefinition, steps: stepDefinitions } = args;

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
    await step.runMutation(internal.workflow.engine.markExecutionCompleted, {
      executionId,
    });
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
    (stepDefinitions.find((s) => s.stepType === 'trigger')?.stepSlug ||
      stepDefinitions[0]?.stepSlug);

  while (currentStepSlug) {
    const stepDef = stepMap.get(currentStepSlug);
    if (!stepDef) {
      throw new Error(`Step not found: ${currentStepSlug}`);
    }

    // Determine retry policy: step-level override > workflow-level default
    const workflowRetryPolicy = (args.workflowDefinition?.config?.retryPolicy ??
      null) as { maxRetries: number; backoffMs: number } | null;
    const stepRetryPolicy = (stepDef.config?.retryPolicy ?? null) as {
      maxRetries: number;
      backoffMs: number;
    } | null;
    const effectiveRetryPolicy =
      stepRetryPolicy ?? workflowRetryPolicy ?? undefined;
    const retryBehavior = buildRetryBehaviorFromPolicy(effectiveRetryPolicy);

    const stepResult = await step.runAction(
      internal.workflow.engine.executeStep,
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
    const map = (stepDef.nextSteps || {}) as Record<string, string>;
    nextStepSlug = map[stepResult.port] ?? null;

    // Handle special 'noop' keyword - means do nothing and end workflow
    if (nextStepSlug === 'noop') {
      debugLog('dynamicWorkflow Noop step reached, finishing workflow', {
        fromStepSlug: stepDef.stepSlug,
        port: stepResult.port,
      });
      break;
    }

    const hasAnyMapping = Object.keys(map).length > 0;

    if (hasAnyMapping && nextStepSlug === null) {
      throw new Error(
        `No next step for port '${stepResult.port}' on step '${stepDef.stepSlug}'. Available ports: ${Object.keys(
          map,
        ).join(', ')}`,
      );
    }

    // Check if the next step exists in the workflow
    if (nextStepSlug !== null && !stepMap.has(nextStepSlug)) {
      const errorMsg = `Next step '${nextStepSlug}' not found in workflow steps (from '${stepDef.stepSlug}'). Available steps: ${Array.from(stepMap.keys()).join(', ')}`;

      // Mark execution as failed before throwing
      await step.runMutation(internal.wf_executions.failExecution, {
        executionId,
        error: errorMsg,
      });

      throw new Error(errorMsg);
    }

    currentStepSlug = nextStepSlug;
  }

  await step.runMutation(internal.workflow.engine.markExecutionCompleted, {
    executionId,
  });
}
