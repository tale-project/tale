/**
 * The `spawn_agent` tool — agent-on-demand jobs (design: agent-on-demand.md).
 *
 * The primary chat agent composes an ephemeral worker for exactly one task:
 * capabilities are resolved as a SUBSET of the parent's own grants plus the
 * always-on workspace READ baseline (`resolve_job_spec.ts`), the methodology
 * skill is eagerly rendered into the worker prompt, and the run is job-backed
 * (`agentJobs` row = source of truth, rendered as a live job card in the
 * chat).
 *
 * M1 executes the fast path: the job runs inside the parent's turn via the
 * injected `runGeneration` (in-process `runGenerationCore` — injected to
 * avoid a module cycle with `internal_actions.ts`). Async promotion at the
 * action-window boundary is M2; parking on user input is M3.
 *
 * Budget/usage: the generation is attributed to the PARENT agent slug so the
 * parent's monthly budget guard aggregates job spend; per-job usage lands on
 * the job row.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { DEFAULT_DOMAIN } from '../../../lib/shared/constants/domains';
import { parseModelRef } from '../../../lib/shared/utils/model-ref';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import type { SkillSnapshot } from '../../lib/agent_chat/skills_runtime';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { buildModelCandidates } from '../../lib/agent_response/model_routing/route_model';
import { selectModelTier } from '../../lib/agent_response/model_routing/select_model';
import { renderPrompt } from '../../lib/prompts/registry';
import { buildSandboxState } from '../files/helpers/sandbox_state';
import { checkTimeBudget } from '../sub_agents/helpers/check_budget';
import {
  errorResponse,
  successResponse,
  handleToolError,
  type ToolResponse,
} from '../sub_agents/helpers/tool_response';
import { validateToolContext } from '../sub_agents/helpers/validate_context';
import { TOOL_NAMES, type ToolName } from '../tool_names';
import { getToolRegistryMap } from '../tool_registry';
import type { ToolAvailability } from '../types';
import {
  describeNarrowing,
  resolveJobSpec,
  WORKER_BASELINE_TOOLS,
  WORKER_WORKSPACE_READ_TOOLS,
} from './resolve_job_spec';

const spawnAgentArgs = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .describe(
      'Short human-readable display name for this worker, shown to the user as the job title. Write it in the conversation language, like a role on a team (e.g. "BYD market researcher").',
    ),
  description: z
    .string()
    .min(1)
    .max(200)
    .describe('One sentence for the job card: what this worker will deliver.'),
  methodology: z
    .string()
    .optional()
    .describe(
      'Optional skill slug whose SKILL.md becomes the worker\'s operating method (see the "grantable methodologies" list below). Use for open-ended multi-step work; omit for simple lookups.',
    ),
  instructions: z
    .string()
    .min(1)
    .max(8000)
    .describe(
      'Task-specific instructions you author for the worker: deliverable, constraints, quality bar. Do NOT restate platform rules; the worker has its own operating contract.',
    ),
  tools: z
    .array(z.string())
    .max(16)
    .describe(
      'EXPLICIT tool grant for this job, chosen from YOUR OWN tools (see the "grantable tools" list below). Fewer tools = a more focused worker. Requests outside your grants are silently dropped and reported back. Workspace READ tools (file_read, file_list) are always included automatically — never list them.',
    ),
  skills: z
    .array(z.string())
    .max(8)
    .optional()
    .describe(
      'Capability skills the worker may look up on demand (lazy). Not for methodology — use the methodology field.',
    ),
  integrations: z
    .array(z.string())
    .max(8)
    .optional()
    .describe('Integration bindings from your own set (e.g. "tavily").'),
  modelTier: z
    .enum(['fast', 'capable'])
    .optional()
    .describe(
      '"fast" = cheaper/quicker model for mechanical work (extraction, formatting); "capable" (default) = your own model class for reasoning-heavy work.',
    ),
  input: z
    .string()
    .min(1)
    .describe(
      "The task input handed to the worker (the user's request plus any context it cannot discover itself).",
    ),
});

/** Result shape of the injected generation runner (`runGenerationCore`). */
interface JobGenerationResult {
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  model?: string;
  provider?: string;
  durationMs?: number;
}

/**
 * The parent-config fields the spawn boundary reads. Structurally typed
 * (string[] tools) so both the TS `SerializableAgentConfig` and the
 * validator-derived arg shape in `internal_actions.ts` satisfy it.
 */
export interface SpawnParentConfig {
  name?: string;
  convexToolNames?: string[];
  skillBindings?: string[];
  integrationBindings?: string[];
  fallbackModels?: string[];
  knowledgeMode?: SerializableAgentConfig['knowledgeMode'];
  webSearchMode?: SerializableAgentConfig['webSearchMode'];
  includeTeamKnowledge?: boolean;
  includeOrgKnowledge?: boolean;
  agentTeamId?: string;
  agentTeamIds?: string[];
  knowledgeFileIds?: string[];
  timeoutMs?: number;
  budget?: SerializableAgentConfig['budget'];
}

export interface SpawnAgentDeps {
  parentConfig: SpawnParentConfig;
  parentAgentSlug: string;
  parentModel: string;
  parentProvider?: string;
  organizationId: string;
  orgLocale: string;
  skillSnapshot: SkillSnapshot;
  /**
   * In-process generation runner (`runGenerationCore`), injected to avoid the
   * `internal_actions ↔ spawn_agent` module cycle. In-process (not
   * `ctx.runAction`) so a long job is not subject to the runAction RPC cap.
   */
  runGeneration: (
    ctx: ActionCtx,
    args: Record<string, unknown>,
  ) => Promise<JobGenerationResult>;
}

/** Tier hint → difficulty class consumed by the shared tier selector. */
const TIER_TO_DIFFICULTY = { fast: 'easy', capable: 'hard' } as const;

/**
 * Tools that can CHANGE the shared thread workspace. When a job is granted
 * any of these, the spawn result carries the post-job `sandboxState` so the
 * parent sees the files the worker produced instead of recreating them.
 * The read-side tools (`WORKER_WORKSPACE_READ_TOOLS`) are baseline on every
 * job and cannot alter the workspace, so they don't trigger the snapshot.
 */
const WORKSPACE_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'file_write',
  'file_edit',
  'file_delete',
  'run_code',
]);

async function resolveJobModel(
  ctx: ActionCtx,
  deps: SpawnAgentDeps,
  tier: 'fast' | 'capable' | undefined,
): Promise<{ model: string; provider?: string }> {
  const parentPick = { model: deps.parentModel, provider: deps.parentProvider };
  if (!tier || tier === 'capable') return parentPick;
  const pool = [
    deps.parentModel,
    ...(deps.parentConfig.fallbackModels ?? []),
  ].filter((ref, i, all) => all.indexOf(ref) === i);
  if (pool.length <= 1) return parentPick;
  try {
    const candidates = await buildModelCandidates(
      ctx,
      deps.organizationId,
      pool,
    );
    if (candidates.length === 0) return parentPick;
    const selection = selectModelTier({
      candidates,
      difficultyClass: TIER_TO_DIFFICULTY[tier],
      domain: DEFAULT_DOMAIN,
    });
    if (!selection.ref || selection.ref === deps.parentModel) return parentPick;
    const { providerName, modelId } = parseModelRef(selection.ref);
    return { model: modelId, provider: providerName ?? deps.parentProvider };
  } catch (error) {
    console.warn(
      '[spawn_agent] tier routing failed; using parent model',
      error,
    );
    return parentPick;
  }
}

const isToolName = (name: string): name is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(name);

function grantableToolLines(deps: SpawnAgentDeps): string {
  const registry = getToolRegistryMap();
  const implicit = new Set<string>(WORKER_WORKSPACE_READ_TOOLS);
  const names = (deps.parentConfig.convexToolNames ?? []).filter(
    (name) =>
      isToolName(name) &&
      !implicit.has(name) &&
      registry[name].availability !== 'primary-only',
  );
  return names.join(', ') || '(none)';
}

function grantableMethodologyLines(deps: SpawnAgentDeps): string {
  const lines = deps.skillSnapshot.entries
    .filter((entry) => !entry.disableModelInvocation)
    .map((entry) => `- ${entry.slug}: ${entry.description}`);
  return lines.join('\n') || '(none)';
}

export function createSpawnAgentTool(deps: SpawnAgentDeps) {
  const availability = new Map<string, ToolAvailability>(
    TOOL_NAMES.map((name) => [name, getToolRegistryMap()[name].availability]),
  );

  return {
    name: 'spawn_agent' as const,
    // primary-only: jobs must not spawn jobs (recursion guard, design §6.1).
    availability: 'primary-only' as const,
    tool: createTool({
      description: `Spawn a focused worker agent for ONE well-scoped task and get its result back. The worker runs non-interactively with EXACTLY the capabilities you grant it (a subset of your own, plus baseline workspace READ access), and its progress is shown to the user as a live job card.

**When to use:** a sub-task that benefits from isolation — open-ended research, bulk extraction, drafting a long document — where a focused context beats doing it inline. For quick answers, just act yourself.

**Contract:**
• You author the worker's task instructions; the platform adds its operating rules. Grant the SMALLEST tool set that can do the job.
• The worker cannot talk to the user. If its result says it needs user input, ask the user yourself (request_human_input) — ask each question at most ONCE; never re-ask something the user already answered.
• Out-of-grant requests are silently dropped — the result includes what was narrowed so you can adapt (e.g. a missing integration → tell the user to connect it, or do that part yourself).
• If the job fails or is cut off, its partial progress is visible to the user; summarize honestly and continue yourself if you can.
• The worker shares YOUR thread workspace and can ALWAYS read it: \`file_read\` and \`file_list\` are granted automatically (don't list them), and \`file_list\` resolves a workspace path to the \`fileId\` other tools take (e.g. \`image\` — grant it when the job must analyze workspace images). Tools that WRITE the workspace (file_write, file_edit, file_delete, run_code) are granted only when you list them.
• When you grant a write-side workspace tool, the result carries \`sandboxState\` — the workspace after the job. Files listed there ALREADY EXIST (the user sees them on the canvas): reference them by path, NEVER rewrite them from the worker's text reply.

**Grantable tools:** ${grantableToolLines(deps)}
**Grantable methodologies:**
${grantableMethodologyLines(deps)}`,
      inputSchema: spawnAgentArgs,
      execute: async (ctx: ToolCtx, args, options): Promise<ToolResponse> => {
        const validation = validateToolContext(ctx, 'spawn_agent');
        if (!validation.valid) return validation.error;
        const { organizationId, threadId, userId } = validation.context;

        const budget = checkTimeBudget(ctx);
        if (!budget.ok) return budget.error;

        const resolved = resolveJobSpec({
          requested: {
            tools: args.tools,
            skills: args.skills,
            integrations: args.integrations,
            methodology: args.methodology,
          },
          parent: {
            toolNames: deps.parentConfig.convexToolNames ?? [],
            skillBindings: deps.parentConfig.skillBindings ?? [],
            integrationBindings: deps.parentConfig.integrationBindings ?? [],
          },
          availability,
          skillsBySlug: deps.skillSnapshot.bySlug,
        });

        const { model, provider } = await resolveJobModel(
          ctx,
          deps,
          args.modelTier,
        );

        const started = await ctx.runMutation(
          internal.agent_jobs.internal_mutations.startJob,
          {
            organizationId,
            threadId,
            userId,
            parentAgentSlug: deps.parentAgentSlug,
            name: args.name,
            description: args.description,
            // The streamed tool part carries this SAME id, so the client can
            // anchor the live job card to its spawn row before the result lands.
            toolCallId: options.toolCallId,
            spec: {
              instructions: args.instructions,
              input: args.input,
              methodologySlug: resolved.methodology?.slug,
              methodologyVersionHash: resolved.methodology?.versionHash,
              renderedMethodology: resolved.methodology?.body,
              requestedTools: args.tools,
              effectiveTools: resolved.effectiveTools,
              skills: resolved.skills,
              integrations: resolved.integrations,
              modelTier: args.modelTier,
              model,
              provider,
              narrowed: resolved.narrowed,
            },
          },
        );
        if (!started.started) {
          return errorResponse(
            `All ${started.cap} job slots are busy (${started.running} running). Do the task yourself or try spawning again later.`,
          );
        }

        // 4-layer worker prompt: [1] preamble, [2] methodology, [3] parent
        // instructions; [4] the input goes in as the prompt message.
        const workerInstructions = [
          renderPrompt(
            'jobs.workerPreamble',
            { name: args.name },
            { locale: deps.orgLocale },
          ),
          resolved.methodology
            ? `====================\nOPERATING METHOD\n====================\n\n${resolved.methodology.body}`
            : undefined,
          `====================\nTASK INSTRUCTIONS\n====================\n\n${args.instructions}`,
        ]
          .filter((part) => part !== undefined)
          .join('\n\n');

        // Registry-name grants only — the worker-baseline plumbing
        // (`update_progress`) is spliced in by runGenerationCore's jobRun path.
        const registryToolNames = resolved.effectiveTools.filter(isToolName);

        const jobConfig: SerializableAgentConfig = {
          name: deps.parentAgentSlug,
          instructions: workerInstructions,
          convexToolNames: registryToolNames,
          integrationBindings: resolved.integrations,
          skillBindings: resolved.skills.filter(
            (slug) => slug !== resolved.methodology?.slug,
          ),
          knowledgeMode: deps.parentConfig.knowledgeMode,
          webSearchMode: deps.parentConfig.webSearchMode,
          includeTeamKnowledge: deps.parentConfig.includeTeamKnowledge,
          includeOrgKnowledge: deps.parentConfig.includeOrgKnowledge,
          agentTeamId: deps.parentConfig.agentTeamId,
          agentTeamIds: deps.parentConfig.agentTeamIds,
          knowledgeFileIds: deps.parentConfig.knowledgeFileIds,
          // Lean worker context: no user memories/custom instructions.
          personalizationMode: 'off',
          delegationDisabled: true,
          maxSteps: 40,
          timeoutMs: deps.parentConfig.timeoutMs,
          budget: deps.parentConfig.budget,
        };

        let outcome: ToolResponse;
        let finalStatus: 'completed' | 'failed' | 'timed_out' = 'failed';
        let finalUsage: JobGenerationResult['usage'];
        let resultText: string | undefined;
        try {
          const result = await deps.runGeneration(ctx, {
            agentType: 'custom',
            agentConfig: jobConfig,
            model,
            provider,
            debugTag: `[spawn_agent:${args.name}]`,
            threadId: started.jobThreadId,
            organizationId,
            userId,
            // Budget aggregation: the PARENT slug, so the monthly guard sees
            // job spend; per-job usage lands on the job row below.
            agentSlug: deps.parentAgentSlug,
            promptMessage: args.input,
            parentThreadId: threadId,
            deadlineMs: budget.deadlineMs,
            maxSteps: jobConfig.maxSteps,
            jobRun: { jobThreadId: started.jobThreadId },
          });
          finalStatus = 'completed';
          finalUsage = result.usage;
          resultText = result.text;

          const narrowedNote = describeNarrowing(resolved.narrowed);
          outcome = {
            ...successResponse(
              result.text ?? '',
              {
                inputTokens: result.usage?.inputTokens,
                outputTokens: result.usage?.outputTokens,
                totalTokens: result.usage?.totalTokens,
                durationSeconds:
                  result.durationMs !== undefined
                    ? result.durationMs / 1000
                    : undefined,
              },
              result.model ?? model,
              result.provider ?? provider,
              undefined,
              args.input,
              { subThreadId: started.jobThreadId },
            ),
            jobId: String(started.jobId),
            ...(narrowedNote ? { narrowed: narrowedNote } : {}),
          };
        } catch (error) {
          finalStatus =
            budget.deadlineMs !== undefined && Date.now() >= budget.deadlineMs
              ? 'timed_out'
              : 'failed';
          outcome = {
            ...handleToolError('spawn_agent', error),
            jobId: String(started.jobId),
          };
        } finally {
          try {
            await ctx.runMutation(
              internal.agent_jobs.internal_mutations.finalizeJob,
              {
                jobId: started.jobId,
                status: finalStatus,
                failureReason:
                  finalStatus === 'completed'
                    ? undefined
                    : finalStatus === 'timed_out'
                      ? 'deadline_exceeded'
                      : 'generation_error',
                resultText,
                inputTokens: finalUsage?.inputTokens,
                outputTokens: finalUsage?.outputTokens,
              },
            );
          } catch (finalizeError) {
            console.error(
              '[spawn_agent] finalizeJob failed (orphan sweep will heal):',
              finalizeError,
            );
          }
        }
        // Workspace ground truth for the parent: when the worker could CHANGE
        // the shared workspace, report its state after the job (success OR
        // failure — a failed job may still have written partial files).
        // spawn_agent is primary-only, so ctx.threadId IS the workspace owner.
        if (
          resolved.effectiveTools.some((t) => WORKSPACE_MUTATING_TOOLS.has(t))
        ) {
          try {
            outcome = {
              ...outcome,
              sandboxState: await buildSandboxState(ctx, {
                organizationId,
                workspaceThreadId: threadId,
              }),
            };
          } catch (stateError) {
            console.warn(
              '[spawn_agent] sandboxState snapshot failed (result returned without it):',
              stateError,
            );
          }
        }
        return outcome;
      },
    }),
  };
}

export { WORKER_BASELINE_TOOLS };
