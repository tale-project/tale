/**
 * Sandbox node helper (workflow_engine side). Routes a `sandbox` step to the
 * right node-runtime backend (agent vs script) and wraps the unified result in
 * a StepExecutionResult. Always returns the `success` port — failures live in
 * `output.data.{ok,status,error}` so callers branch via a following condition.
 */
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import { toId } from '../../../../lib/type_cast_helpers';
import {
  resolveWorkflowSandboxSession,
  type SandboxSessionScope,
} from '../../../../sandbox/session_naming';
import type { StepExecutionResult } from '../../../types';
import type { SandboxNodeConfig } from '../../../types/nodes';
import { mergeSandboxEnv } from './merge_sandbox_env';
import { resolveStepEnv } from './resolve_step_env';

export async function executeSandboxNode(
  ctx: ActionCtx,
  config: SandboxNodeConfig,
  variables: Record<string, unknown>,
  executionId: string,
  stepSlug: string,
): Promise<StepExecutionResult> {
  const organizationId =
    typeof variables.organizationId === 'string'
      ? variables.organizationId
      : '';
  const run = config.run;
  const inputs = config.inputs ?? [];
  const isAgent = 'agent' in run;
  const runMode = isAgent ? ('agent' as const) : ('script' as const);
  const sessionScope: SandboxSessionScope =
    isAgent && run.sessionScope === 'workflow' ? 'workflow' : 'step';
  const { sessionId, ownerId, checkpointKey } = resolveWorkflowSandboxSession({
    executionId,
    stepSlug,
    sessionScope,
  });

  // Park-on-capacity admission gate. A workflow sandbox step that hits its org's
  // concurrency cap WAITS (FIFO) instead of failing: poll the queue, and if not
  // yet at the front of an open slot, return the internal `awaiting_capacity`
  // port so the durable handler sleeps + re-enters this step. The poll upserts
  // this step's FIFO ticket and re-stamps its liveness heartbeat — running it
  // BEFORE the (expensive) env-resolution RPC means a still-full re-poll is cheap.
  //
  // A RESUME (a prior segment handed off mid-run) already HOLDS its slot and must
  // NOT poll: doing so would count its own slot, see slotsOpen=0, and park a
  // running step → it never resumes → its slot never frees (self-deadlock). So
  // gate the poll on fresh entry only — for an agent step that means no live
  // checkpoint; a script step never resumes.
  const ownerType = 'workflow_run';
  const ownerIdForAdmission = ownerId;
  const canPark = organizationId !== '' && executionId !== '';
  // Sticky "Queued" marker on the execution row so the run view shows a steady
  // badge across the rapid poll segments (the per-segment in-progress blip would
  // otherwise flicker Running↔Queued). Cleared the instant we proceed to real
  // work — BEFORE the long agent run — so a running step never reads "Queued".
  const setCapacityWait = (waiting: boolean) =>
    ctx.runMutation(
      internal.workflow_executions.internal_mutations.setStepCapacityWait,
      { executionId: toId<'wfExecutions'>(executionId), stepSlug, waiting },
    );
  let resuming = false;
  let sharedSessionLive = false;
  if (canPark && isAgent) {
    const checkpoint = await ctx.runQuery(
      internal.sandbox.session_queries.loadAgentCheckpoint,
      { sessionId: checkpointKey },
    );
    resuming = checkpoint !== null;
    if (sessionScope === 'workflow' && !resuming) {
      const live = await ctx.runQuery(
        internal.sandbox.session_queries.getSessionBySessionId,
        { sessionId },
      );
      // A `stopped` (hibernated) row freed its per-org slot, so it must pass
      // the admission poll below like a fresh session — the resume mutation
      // then claims the parked ticket when it re-takes the slot. Only a row
      // that still HOLDS a slot (creating|active|degraded) skips admission.
      sharedSessionLive = live !== null && live.status !== 'stopped';
    }
  }
  if (canPark && !resuming && !sharedSessionLive) {
    const poll = await ctx.runMutation(
      internal.sandbox.admission.pollAdmission,
      {
        // Both agent and script steps now run in a workflow-run session, so both
        // draw from the per-org workflow SESSION budget (one unified capacity
        // model — the one-shot 'oneshot' kind is retired).
        organizationId,
        kind: 'session',
        ownerType,
        ownerId: ownerIdForAdmission,
        source: 'workflow',
        wfExecutionId: executionId,
        stepSlug,
      },
    );
    if (poll.verdict === 'wait') {
      await setCapacityWait(true);
      return {
        port: 'awaiting_capacity',
        output: {
          type: 'sandbox',
          data: {
            mode: runMode,
            ok: false,
            status: 'awaiting_capacity',
            outputFileIds: [],
          },
        },
      };
    }
  }
  // Proceeding to real work (admitted, or a resume re-entry): clear any sticky
  // "Queued" marker BEFORE the long run so the step reads "Running", not a stale
  // "Queued". No-op on the first segment (nothing was set).
  if (canPark) await setCapacityWait(false);

  // Resolve the env this sandbox sees from three layers and merge them (step
  // beats workflow; operator UI beats the pack file — see `mergeSandboxEnv`):
  //  1. workflow-level + 3. step-level side-table env/secrets (the UI-managed,
  //     deployment-local store) — decrypted here, once, per fresh step run;
  //  2. the step's file `config.env` (literal + `{{...}}`-templated workflow
  //     secrets/runtime values), resolved against the live variables.
  // The merged map is injected by BOTH run modes: agent mode patches it into the
  // session (BELOW per-agent env + broker creds, which still win); script mode
  // forwards it through `executeCode` → the spawner.
  const workflowSlug =
    typeof variables.wfDefinitionId === 'string'
      ? variables.wfDefinitionId
      : typeof variables.workflowSlug === 'string'
        ? variables.workflowSlug
        : '';
  const { workflowEnv, stepEnv: stepStoreEnv } =
    workflowSlug && organizationId
      ? await ctx.runAction(
          internal.workflows.workflow_env_actions.resolveSandboxEnvForStep,
          { organizationId, workflowSlug, stepSlug },
        )
      : { workflowEnv: {}, stepEnv: {} };
  const fileEnv = resolveStepEnv(config.env, variables);
  const stepEnv = mergeSandboxEnv(workflowEnv, fileEnv, stepStoreEnv);
  const hasStepEnv = Object.keys(stepEnv).length > 0;

  // A sandbox AGENT step that belongs to a task-bound workflow execution feeds
  // the durable run through the taskAgentRuns metrics gate (budget/concurrency/
  // usage). Only an execution ABOUT a task carries the binding; script steps and
  // non-task workflows pass nothing and skip metrics. The execution row is the
  // source of the subject (the step env path doesn't carry it).
  let taskBinding:
    | {
        taskId: Id<'tasks'>;
        wfExecutionId: Id<'wfExecutions'>;
        workflowSlug?: string;
      }
    | undefined;
  if ('agent' in run && executionId) {
    const exec = await ctx.runQuery(
      internal.workflow_executions.internal_queries.getRawExecution,
      {
        executionId: toId<'wfExecutions'>(executionId),
        callerOrgId: organizationId,
      },
    );
    if (exec?.subjectType === 'task' && typeof exec.subjectId === 'string') {
      taskBinding = {
        taskId: toId<'tasks'>(exec.subjectId),
        wfExecutionId: toId<'wfExecutions'>(executionId),
        ...(workflowSlug && { workflowSlug }),
      };
    }
  }

  const data =
    'agent' in run
      ? await ctx.runAction(
          internal.node_only.sandbox.workflow_sandbox_exec.runSandboxAgent,
          {
            organizationId,
            executionId,
            stepSlug,
            agentSlug: run.agent,
            ...(taskBinding && {
              taskId: taskBinding.taskId,
              wfExecutionId: taskBinding.wfExecutionId,
              ...(taskBinding.workflowSlug !== undefined && {
                workflowSlug: taskBinding.workflowSlug,
              }),
            }),
            ...(run.instructions !== undefined && {
              instructions: run.instructions,
            }),
            budget: run.budget,
            ...(run.model !== undefined && { model: run.model }),
            inputs,
            ...(config.output !== undefined && { output: config.output }),
            ...(hasStepEnv && { env: stepEnv }),
            ...(run.sessionScope !== undefined && {
              sessionScope: run.sessionScope,
            }),
          },
        )
      : await ctx.runAction(
          internal.node_only.sandbox.workflow_sandbox_exec.runSandboxScript,
          {
            organizationId,
            executionId,
            stepSlug,
            script: run.script,
            language: run.language,
            ...(run.params !== undefined && { params: run.params }),
            ...(run.useSkills !== undefined && {
              useSkills: run.useSkills,
            }),
            inputs,
            ...(config.output !== undefined && { output: config.output }),
            ...(config.timeoutMs !== undefined && {
              timeoutMs: config.timeoutMs,
            }),
            ...(hasStepEnv && { env: stepEnv }),
          },
        );

  // Post-run ticket + marker bookkeeping. A run that actually started (terminal,
  // or handed off 'running') holds its slot via the session/exec row → drop the
  // FIFO ticket (the marker was already cleared before the run). If the action
  // itself came back `awaiting_capacity` (a post-poll WAIT_FIFO race or a global
  // 429), keep the ticket and RE-SET the sticky marker so the badge stays
  // "Queued" through the re-entry.
  if (canPark) {
    if (data.status === 'awaiting_capacity') {
      await setCapacityWait(true);
    } else {
      await ctx.runMutation(internal.sandbox.admission.deleteAdmissionTicket, {
        ownerType,
        ownerId,
      });
    }
  }

  // A DURABLE agent run hands off with status 'running' when its per-action
  // window elapses mid-run (the sandbox exec keeps running). Surface it on a
  // dedicated 'running' port so the handler re-enters the SAME step to attach
  // the next segment, transparently spanning the 10-min action ceiling.
  // `awaiting_capacity` is the park-on-capacity twin: the step never started
  // (no slot, no budget burned) — the handler sleeps then re-enters. Everything
  // terminal stays on 'success' (ok/error live in output.data, so a following
  // condition branches as before). Script runs never return 'running'.
  const port =
    data.status === 'running'
      ? 'running'
      : data.status === 'awaiting_capacity'
        ? 'awaiting_capacity'
        : 'success';
  return { port, output: { type: 'sandbox', data } };
}
