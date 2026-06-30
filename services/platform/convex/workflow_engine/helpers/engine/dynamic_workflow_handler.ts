/**
 * Dynamic workflow handler - business logic for executing workflows
 */

import type { WorkflowCtx } from '@convex-dev/workflow';
import type { RetryBehavior } from '@convex-dev/workpool';
import type { Infer } from 'convex/values';
import { v } from 'convex/values';

import { isRecord } from '../../../../lib/utils/type-utils';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { jsonValueValidator } from '../../../lib/validators/json';
import { sandboxCapacityWakeEventName } from '../../../sandbox/sessions_schema';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

import { createDebugLog } from '../../../lib/debug_log';
import type { StepDefinition, WorkflowDefinition } from '../data_source/types';
import {
  buildDebugWaitingFor,
  debugEventName,
  debugResumeEventValidator,
} from './debug_gate';

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
  /**
   * Step-by-step debug mode: the engine pauses before every node until the
   * user sends a `debug:<pauseIndex>` event ('step' pauses again before the
   * next node, 'continue' runs to the end). Journaled with the workflow args,
   * so replays of in-flight executions are deterministic — runs started
   * without the flag never hit the gate.
   */
  debugMode?: boolean;
};

// Default retry for DURABLE sandbox steps (see the call site): a long run is a
// sequence of segments across action boundaries, and a single transient hard-kill
// on any one would otherwise be fatal. The retry resumes from the checkpoint, so
// these attempts re-attach rather than restart the agent's work.
const DEFAULT_SANDBOX_RETRY_POLICY = { maxRetries: 4, backoffMs: 3000 };

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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexJsonValue from Convex scheduler; workflowDefinition is always a serialized WorkflowDefinition
  const workflowDefinition = args.workflowDefinition as WorkflowDefinition;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexJsonValue from Convex scheduler; steps is always a serialized Array<StepDefinition>
  const stepDefinitions = args.steps as Array<StepDefinition>;

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

  // Stack of currently-active loop step slugs. Pushed when a loop step emits
  // `port: 'loop'` for the first iteration, popped when the same loop emits
  // `port: 'done'`. Used to honor `continueOnError` on the body's exception
  // path: when a body step throws, walk the stack from the innermost loop
  // outward and recover at the first loop that opted in.
  const activeLoopStack: string[] = [];

  // Debug gate state: `pauseIndex` increments deterministically per pause so
  // each awaitEvent gets a unique, journal-stable event name.
  let runToEnd = !args.debugMode;
  let pauseIndex = 0;

  while (currentStepSlug) {
    const stepDef = stepMap.get(currentStepSlug);
    if (!stepDef) {
      throw new Error(`Step not found: ${currentStepSlug}`);
    }

    if (!runToEnd) {
      pauseIndex += 1;
      debugLog('dynamicWorkflow Debug pause before step', {
        executionId,
        stepSlug: stepDef.stepSlug,
        pauseIndex,
      });

      // Surface the pause on the execution row (status stays 'running', same
      // convention as human-input approvals — watchdog/filter safe).
      await step.runMutation(
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          currentStepSlug: stepDef.stepSlug,
          currentStepName: stepDef.name,
          waitingFor: buildDebugWaitingFor(pauseIndex, stepDef.stepSlug),
        },
      );

      const resume = await step.awaitEvent({
        name: debugEventName(pauseIndex),
        validator: debugResumeEventValidator,
      });

      if (resume.action === 'continue') {
        runToEnd = true;
      }

      // Clear waitingFor (empty string signals "clear" since Convex strips
      // undefined values from serialized args).
      await step.runMutation(
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          waitingFor: '',
        },
      );
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
    // A DURABLE `sandbox` step crosses many <10-min action boundaries (one per
    // segment); a single transient platform hard-kill on ANY segment would
    // otherwise fail the whole long run. Default it to retry — the retry re-runs
    // executeStep, which loads the segment checkpoint and RESUMES (re-attaches to
    // the still-running exec, or cleanly restarts if the container is gone). A
    // clean {ok:false} is NOT a throw, so genuine agent failures still flow to
    // the following condition rather than being retried. Explicit step- or
    // workflow-level policy still wins.
    const effectiveRetryPolicy =
      stepRetryPolicy ??
      workflowRetryPolicy ??
      (stepDef.stepType === 'sandbox'
        ? DEFAULT_SANDBOX_RETRY_POLICY
        : undefined);
    const retryBehavior = buildRetryBehaviorFromPolicy(effectiveRetryPolicy);

    let stepResult;
    try {
      stepResult = await step.runAction(
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
    } catch (err) {
      // Honor `continueOnError` on a surrounding loop. We never recover
      // exceptions thrown by a loop step itself — that would risk an infinite
      // re-entry. Walk the stack inside-out so the innermost opt-in loop wins.
      let recovered = false;
      if (stepDef.stepType !== 'loop') {
        for (let i = activeLoopStack.length - 1; i >= 0; i--) {
          const ownerSlug = activeLoopStack[i];
          const ownerStep = stepMap.get(ownerSlug);
          const rawConfig: unknown = ownerStep?.config;
          const ownerCfg = isRecord(rawConfig) ? rawConfig : undefined;
          if (
            ownerStep?.stepType === 'loop' &&
            ownerCfg?.continueOnError === true
          ) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[loop:${ownerSlug}] step '${stepDef.stepSlug}' failed, continuing iteration: ${errMsg}`,
            );
            // Persist a minimal failure marker so (a) operators see which
            // step in which iteration broke (audit trail), and (b)
            // subsequent steps that read `steps.<slug>.output` see a
            // failure record instead of stale data from a prior iteration.
            await step.runAction(
              internal.workflow_engine.internal_actions.recordBodyStepFailure,
              {
                executionId: executionId,
                stepSlug: stepDef.stepSlug,
                stepName: stepDef.name,
                error: errMsg,
              },
            );
            // Trim nested loops nested above the recovery point — their
            // remaining body is being skipped together with the failing step.
            activeLoopStack.length = i + 1;
            currentStepSlug = ownerSlug;
            recovered = true;
            break;
          }
        }
      }
      if (!recovered) throw err;
      continue;
    }

    // Track loop-step entry/exit so the catch above knows the active loop.
    if (stepDef.stepType === 'loop') {
      const top = activeLoopStack[activeLoopStack.length - 1];
      if (stepResult.port === 'loop' && top !== stepDef.stepSlug) {
        activeLoopStack.push(stepDef.stepSlug);
      } else if (stepResult.port === 'done' && top === stepDef.stepSlug) {
        activeLoopStack.pop();
      }
    }

    // A DURABLE sandbox-step agent run that handed off mid-run (its per-action
    // window elapsed; the sandbox exec keeps running). Re-enter the SAME step —
    // a fresh durable `step.runAction` segment that re-attaches and resumes —
    // WITHOUT advancing `currentStepSlug`, transparently spanning the 10-min
    // action ceiling. This is an INTERNAL control port (the author never maps
    // it), so it MUST be handled before the nextSteps resolution below (which
    // would otherwise throw "No next step for port 'running'"). The per-segment
    // cursor lives in the sandbox checkpoint; the step's own `maxWallClockMs` +
    // a continuation backstop in `runSandboxAgent` bound the loop and eventually
    // return a terminal status on the 'success' port.
    if (stepResult.port === 'running') {
      debugLog('dynamicWorkflow Re-entering durable sandbox step (handoff)', {
        executionId,
        stepSlug: stepDef.stepSlug,
      });
      await step.runMutation(
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          currentStepSlug: stepDef.stepSlug,
          currentStepName: stepDef.name,
        },
      );
      continue;
    }

    // PARK-on-capacity: the sandbox step hit its org's concurrency cap (or a
    // global host 429) and chose to WAIT instead of fail. Unlike 'running' it
    // built NO session and burned NO run budget — there's nothing to re-attach.
    // Surface "Queued" on the execution row, then BLOCK on an event instead of
    // re-running executeStep on a backoff timer (the old poll loop re-ran the
    // whole action every wake, ~84% no-progress re-checks saturating the
    // committer). The deterministic wake name is `sendEvent`d on every edge that
    // can make a slot serviceable — slot RELEASE, a fresh waiter's ARRIVAL
    // (`pollAdmission`), and the ticket REAPER's backstop pass; awaitEvent is
    // race-safe (a wake sent before the await is buffered and resolves
    // immediately). Because this awaitEvent has NO timeout, those edges are the
    // whole liveness story — a missed release wake is recovered by the next
    // arrival or the reaper nudge, not by a heavyweight reconcile cron. On wake we
    // re-enter the SAME step (no `currentStepSlug` advance): the atomic reserve
    // claims the freed slot or re-parks if it lost the race. Like 'running', this
    // is an INTERNAL control port the author never maps, so handle it before
    // nextSteps resolution.
    if (stepResult.port === 'awaiting_capacity') {
      debugLog('dynamicWorkflow Parking sandbox step (awaiting capacity)', {
        executionId,
        stepSlug: stepDef.stepSlug,
      });
      await step.runMutation(
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
        {
          executionId,
          status: 'running',
          currentStepSlug: stepDef.stepSlug,
          currentStepName: stepDef.name,
        },
      );
      await step.awaitEvent({
        name: sandboxCapacityWakeEventName(executionId, stepDef.stepSlug),
      });
      continue;
    }

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
        internal.workflow_executions.internal_mutations.failExecution,
        {
          executionId,
          error: errorMsg,
          errorCode: 'step_failure',
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
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
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
        internal.workflow_executions.internal_mutations.updateExecutionStatus,
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
