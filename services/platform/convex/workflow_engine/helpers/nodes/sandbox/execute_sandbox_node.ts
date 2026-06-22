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
            inputs,
            ...(config.output !== undefined && { output: config.output }),
            ...(config.timeoutMs !== undefined && {
              timeoutMs: config.timeoutMs,
            }),
            ...(hasStepEnv && { env: stepEnv }),
          },
        );

  // A DURABLE agent run hands off with status 'running' when its per-action
  // window elapses mid-run (the sandbox exec keeps running). Surface it on a
  // dedicated 'running' port so the handler re-enters the SAME step to attach
  // the next segment, transparently spanning the 10-min action ceiling.
  // Everything terminal stays on 'success' (ok/error live in output.data, so a
  // following condition branches as before). Script runs never return 'running'.
  const port = data.status === 'running' ? 'running' : 'success';
  return { port, output: { type: 'sandbox', data } };
}
