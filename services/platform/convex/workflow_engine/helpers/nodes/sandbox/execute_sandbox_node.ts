/**
 * Sandbox node helper (workflow_engine side). Routes a `sandbox` step to the
 * right node-runtime backend (agent vs script) and wraps the unified result in
 * a StepExecutionResult. Always returns the `success` port — failures live in
 * `output.data.{ok,status,error}` so callers branch via a following condition.
 */
import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type { StepExecutionResult } from '../../../types';
import type { SandboxNodeConfig } from '../../../types/nodes';
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

  // Step-scoped env (literal + `{{...}}`-templated workflow secrets/runtime
  // values) is resolved here, once, against the live variables. Both run modes
  // inject it into the step's sandbox: the agent mode merges it into the
  // session via `sessionEnvPatch`; the deterministic script mode forwards it
  // through `executeCode` → the spawner, which sanitizes + sets it as the
  // script process env.
  const stepEnv = resolveStepEnv(config.env, variables);
  const hasStepEnv = Object.keys(stepEnv).length > 0;

  const data =
    'agent' in run
      ? await ctx.runAction(
          internal.node_only.sandbox.workflow_sandbox_exec.runSandboxAgent,
          {
            organizationId,
            executionId,
            stepSlug,
            agentSlug: run.agent,
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

  return { port: 'success', output: { type: 'sandbox', data } };
}
