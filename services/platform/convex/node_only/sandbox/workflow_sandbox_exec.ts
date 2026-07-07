'use node';

/**
 * Sandbox-step execution backends (node runtime).
 *
 * Two modes behind one contract. GENUINE agent/script OUTCOMES (the run produced
 * a legible verdict) are encoded in the returned `{ ok, status, error }` so the
 * workflow branches via a following condition step (same convention as the
 * `agent` action) — these never throw. The agent mode DOES throw for an
 * INFRASTRUCTURE/EXECUTION error (auth/gateway/connection/crash — the agent
 * never produced an outcome; see `isRetryableExecutionError`), so the Convex
 * workflow step retries and, if it keeps failing, fails the workflow at that
 * step rather than laundering the failure into a synthesized "success" that
 * marches downstream. (This extends the existing `SessionNotFoundError`
 * resume-retry seam.)
 *
 *  - runSandboxScript: deterministic frozen-script run. Reuses the existing
 *    `executeCode` spawner path (no hot-path refactor); the workflow
 *    `executionId` is passed as the thread key.
 *  - runSandboxAgent: ephemeral Claude-Code run — create → inject creds/VK →
 *    run → harvest (incl. the mandatory `output/summary.md` handoff) → teardown,
 *    mirroring the `run_external_agent` orchestration with
 *    `ownerType: 'workflow_run'`.
 *
 * Both modes are implemented: `runSandboxScript` (pack:// resolution + input
 * staging + `executeCode` reuse) and `runSandboxAgent` (the full ephemeral
 * session orchestration mirroring `run_external_agent`: create → provision →
 * inject creds/VK → run autonomous → harvest `output/summary.md` → teardown).
 * Behavioral correctness of the agent path is gated on live e2e verification
 * (real sandbox + the LLM gateway); the type/dispatch surface is exercised by units.
 */
import { readFile } from 'node:fs/promises';

import { type Infer, v } from 'convex/values';

import {
  usesGateway,
  getSkillsStageDir,
} from '../../../lib/agent-adapters/credential-policy';
import {
  resolveProductAgentKind,
  type ProductAgentSlug,
} from '../../../lib/agent-adapters/events';
import {
  formatModelRef,
  parseModelRef,
} from '../../../lib/shared/utils/model-ref';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { type ActionCtx, internalAction } from '../../_generated/server';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
import { resolveExternalAgentExecModel } from '../../agents/external_agent/exec_model';
import { resolveAppAssetPathChecked } from '../../apps/file_utils';
import { estimateCostCents } from '../../governance/cost_estimation';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  buildSkillsGuidance,
  SKILLS_GUIDANCE_HEADING,
} from '../../lib/skills/guidance';
import { toId } from '../../lib/type_cast_helpers';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import { resolveLanguageModel } from '../../providers/resolve_model';
import { isWaitFifoError } from '../../sandbox/admission';
import {
  resolveWorkflowSandboxSession,
  sessionIdForWorkflowRun,
  workflowRunOwnerId,
  type SandboxSessionScope,
} from '../../sandbox/session_naming';
import type { UiTimelinePart } from './agent_message_parts';
import {
  isRetryableExecutionError,
  isRotatableApiError,
} from './agent_run_outcome';
import { stageBoundOrgSkills } from './bound_org_skills';
import {
  type SessionStageFile,
  SessionDuplicateError,
  SessionNotFoundError,
  SpawnerBusyError,
  sessionCreate,
  sessionDeleteFiles,
  sessionDestroy,
  sessionEnvPatch,
  sessionIsAlive,
  sessionListFiles,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';
import {
  reconcileBuiltinSkills,
  stageIntegrationSkills,
} from './integration_skills';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRoutingFromRef,
  revokeVirtualKey,
} from './llm_gateway_admin';
import {
  RESUME_CONTINUATION_PROMPT,
  shouldAttemptResumeRotation,
} from './resume_rotation';
import { runAgentInSessionImpl } from './run_agent';
import { runAndHarvestInSession } from './session_exec';
import {
  shouldForceSummaryReentry,
  SUMMARY_REENTRY_MAX_TURNS,
  SUMMARY_REENTRY_PROMPT,
  SUMMARY_REENTRY_WINDOW_MS,
} from './summary_reentry';
import {
  pickToken,
  type TokenSelection,
  TokenSourceError,
} from './token_pool_select';
import { stageWorkflowSkills, workspaceIsTaleRepo } from './workflow_skills';

// Mirrors run_external_agent: the gateway + integration-dispatch base URLs the
// in-sandbox agent reaches over the sandbox network, and the Tier-2 grants that
// can be brokered into the container env (gated per-run by the agent's bindings).
const EXTERNAL_AGENT_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
const INTEGRATIONS_BASE_URL = (
  process.env.EXTERNAL_AGENT_INTEGRATIONS_URL || 'http://convex:3211'
).replace(/\/$/, '');
const BROKERABLE_GRANTS = ['github'];

// Global handoff contract (plan §3c): every ephemeral agent run is prompt-forced
// to finish by writing output/summary.md — the only artifact that survives the
// teardown, so it is the legible agent→agent / agent→human handoff.
const SUMMARY_MANDATE = [
  'MANDATORY HANDOFF: before you finish, write a file at the ABSOLUTE path',
  '/user/output/summary.md — NOT a relative output/summary.md, because you may',
  "have cd'd elsewhere (e.g. into a cloned repo) and only /user/output is",
  'harvested. The summary explains (1) what you did, (2) every file you produced',
  '— path + purpose, (3) the result/state, and (4) what is next. If you produced',
  'NO files, the summary MUST say so explicitly and why. This file is the ONLY',
  'thing that survives after this run; it is your handoff to the next agent or a',
  'human.',
].join('\n');

// Grace added to the step's wall-clock budget for the session's hard TTL +
// idle timeout, so the SPAWNER reaps the container shortly after the budget
// elapses even if the platform-side `finally` teardown is skipped (a hard
// action kill). The container-side backstop; the opportunistic reap below
// closes the platform row + VK.
const EPHEMERAL_TTL_GRACE_MS = 5 * 60 * 1000;

// Per-action attach window: how long ONE Convex action drains the (continuously
// running) exec before handing off to the next durable-step segment. Default
// 360s (6min) — comfortably under the smallest realistic action wall-clock cap
// (10min on default Convex cloud; 30min on this deployment) WITH margin for the
// hard-deadline watchdog grace below, so a wedged drain still returns + writes a
// checkpoint before the platform hard-kills the action (which would bypass
// teardown + leak the session). Operator-overridable via the env knob.
const ACTION_WINDOW_MS = Number(
  process.env.EXTERNAL_AGENT_ACTION_WINDOW_MS ?? String(360 * 1000),
);

// Runaway backstop on the number of handoffs a single step may do. The real
// bound is the step's `maxWallClockMs` (cumulative across segments); this just
// caps a pathological zero-progress loop. At ~480s/segment this is ~26h —
// far beyond any legitimate run, so it never bites a healthy long task.
const MAX_AGENT_CONTINUATIONS = 200;

// Token-source rotation: max credential attempts per fresh run (the initial
// pick + up to 2 failovers) before failing the step. Honors the user's
// "retry at most 3 times, then throw" contract.
const MAX_TOKEN_ATTEMPTS = 3;
// Don't START another rotation attempt unless this much of the action window
// remains — a single attempt (esp. an auth retry-storm) must fit before the
// seam, so the cap can't be defeated by burning the window on the last try.
const TOKEN_ROTATION_MIN_WINDOW_MS = 90 * 1000;
// When the CACHED broker pool is exhausted (every token tried, still 401/429),
// re-fetch the pool from the broker — the credential may have been refreshed or
// rotated upstream — and retry WARM (same sandbox, session preserved via the
// resume runner; no teardown). Bounded so a permanently-dead broker can't spin.
// After these in-sandbox retries, the loop throws → the engine's COLD retry
// (destroy sandbox, fresh start from scratch) takes over, and if that keeps
// failing the execution fails loudly.
const MAX_TOKEN_REFETCH = 3;
const TOKEN_REFETCH_BACKOFF_MS = 3000;

/**
 * Thrown by `runSandboxAgent` for an infrastructure/execution failure (the agent
 * never produced a legible outcome — see `isRetryableExecutionError`). The outer
 * `catch` re-throws it (like `SessionNotFoundError` on resume) so it escapes to
 * the Convex workflow step's retry rather than being converted to `{ok:false}`.
 */
class SandboxAgentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxAgentExecutionError';
  }
}

/**
 * Opportunistic backstop (plan §3d): reap this org's leaked `workflow_run`
 * sessions whose bounded TTL elapsed — the rare hard-kill that skipped the
 * happy-path `finally`. Triggered by the next `sandbox`-step run (no cron —
 * mirrors `reconcileOrgSessions`' page-mount precedent). Best-effort and
 * bounded; a transient failure just leaves the row for the next run to retry.
 */
async function reapStaleWorkflowRunSessions(
  ctx: ActionCtx,
  organizationId: string,
): Promise<void> {
  const stale = await ctx.runQuery(
    internal.sandbox.session_queries.listStaleWorkflowRunSessions,
    { organizationId, limit: 10 },
  );
  for (const { sessionId } of stale) {
    try {
      await sessionDestroy(sessionId);
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] destroy failed:', e);
    }
    try {
      const { llmGatewayKeyIds } = await ctx.runMutation(
        internal.sandbox.session_mutations.revokeTokensForSession,
        { sessionId },
      );
      for (const keyId of llmGatewayKeyIds) {
        await revokeVirtualKey(keyId).catch((e) =>
          console.warn('[reapStaleWorkflowRunSessions] VK revoke failed:', e),
        );
      }
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] token revoke failed:', e);
    }
    try {
      await ctx.runMutation(
        internal.sandbox.session_mutations.markSessionRowDestroyed,
        { organizationId, sessionId },
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.deleteOpsForSession,
        { sessionId },
      );
      // A leaked session may have been mid-handoff — drop its durable checkpoint
      // too so no orphan cursor outlives the reaped session.
      await ctx.runMutation(
        internal.sandbox.session_mutations
          .deleteAgentCheckpointsForSpawnerSession,
        { spawnerSessionId: sessionId },
      );
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] row cleanup failed:', e);
    }
  }
}

/**
 * The agent's token-source bindings (Environment-tab rows). On a FRESH segment
 * these fall out of the agent-env injection for free; on RESUME that setup block
 * is skipped, so this re-fetches them so the rotation pool can be rebuilt for the
 * resumed conversation (Part C). Thin wrapper over `resolveAgentEnv` so "this
 * agent's token bindings" is one named concept.
 */
async function loadAgentTokenBindings(
  ctx: ActionCtx,
  organizationId: string,
  agentSlug: string,
): Promise<{ key: string; tokenSourceSlug: string }[]> {
  const agentEnv = await ctx.runAction(
    internal.agents.agent_env_actions.resolveAgentEnv,
    { organizationId, agentSlug },
  );
  return agentEnv.tokenBindings;
}

/**
 * Harvest a finished agent run's output: store every file under the collect dir
 * to `_storage` and read the mandated `output/summary.md` handoff. Synthesizes a
 * minimal summary if the agent omitted the file, so "mandatory" never discards
 * an otherwise-good run on a technicality. Best-effort; a harvest failure leaves
 * the outputs empty rather than throwing.
 */
async function harvestSandboxOutput(
  ctx: ActionCtx,
  sessionId: string,
  collectDir: string,
  fallbackFinalText: string | undefined,
): Promise<{
  outputFileIds: string[];
  outputFiles: { name: string; storageId: string }[];
  summary: string;
  /** True only when a real `summary.md` was found (not the synthesized fallback). */
  summaryWritten: boolean;
  gradeJson?: string;
}> {
  const outputFileIds: string[] = [];
  const outputFiles: { name: string; storageId: string }[] = [];
  let summary: string | undefined;
  let gradeJson: string | undefined;
  try {
    const entries = await sessionListFiles(sessionId, collectDir);
    for (const entry of entries ?? []) {
      if (entry.type !== 'file') continue;
      const file = await sessionReadFile(
        sessionId,
        `${collectDir}/${entry.name}`,
      );
      if (!file) continue;
      const storageId = await ctx.storage.store(
        new Blob([file.bytes], { type: file.contentType }),
      );
      outputFileIds.push(storageId);
      outputFiles.push({ name: entry.name, storageId });
      if (entry.name === 'summary.md') {
        summary = new TextDecoder().decode(file.bytes);
      }
      if (entry.name === 'grade.json') {
        gradeJson = new TextDecoder().decode(file.bytes);
      }
    }
  } catch (harvestErr) {
    console.warn('[runSandboxAgent] output harvest failed:', harvestErr);
  }
  const summaryWritten = summary !== undefined;
  if (summary === undefined) {
    summary = fallbackFinalText
      ? `(synthesized — agent did not write output/summary.md)\n\n${fallbackFinalText}`
      : '(synthesized) The agent produced no output/summary.md and no final text.';
  }
  return { outputFileIds, outputFiles, summary, summaryWritten, gradeJson };
}

/**
 * Terminal teardown — destroy the ephemeral session, revoke its VK(s), flip the
 * row, and drop the durable checkpoint + op rows. Keyed by `sessionId` (NOT a
 * captured `rowId`/`mintedKeyId`) so it works whichever segment reached terminal
 * — a multi-segment run's last segment never saw the create/mint. Each leg is
 * independent best-effort so one failure can't mask the rest.
 */
async function teardownAgentSession(
  ctx: ActionCtx,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  try {
    await sessionDestroy(sessionId);
  } catch (e) {
    console.warn('[runSandboxAgent] session destroy failed:', e);
  }
  try {
    const { llmGatewayKeyIds } = await ctx.runMutation(
      internal.sandbox.session_mutations.revokeTokensForSession,
      { sessionId },
    );
    for (const keyId of llmGatewayKeyIds) {
      await revokeVirtualKey(keyId).catch((e) =>
        console.warn('[runSandboxAgent] VK revoke failed:', e),
      );
    }
  } catch (e) {
    console.warn('[runSandboxAgent] token revoke failed:', e);
  }
  try {
    await ctx.runMutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId, sessionId },
    );
  } catch (e) {
    console.warn('[runSandboxAgent] row status update failed:', e);
  }
  try {
    await ctx.runMutation(
      internal.sandbox.session_mutations
        .deleteAgentCheckpointsForSpawnerSession,
      { spawnerSessionId: sessionId },
    );
  } catch (e) {
    console.warn('[runSandboxAgent] checkpoint cleanup failed:', e);
  }
  try {
    await ctx.runMutation(
      internal.sandbox.session_mutations.deleteOpsForSession,
      { sessionId },
    );
  } catch (e) {
    console.warn('[runSandboxAgent] op cleanup failed:', e);
  }
}

/**
 * User-Stop cascade for a workflow execution's sandbox. `cancelExecution`
 * cancels the durable workflow but never touches the sandbox layer, so a
 * stopped run's ephemeral `workflow_run` session(s) would otherwise keep a
 * container running (burning agent budget) AND keep holding a per-org
 * concurrency slot until the TTL reaper — wedging the org's capacity queue. This
 * tears every live session for the execution down NOW: `sessionDestroy` kills
 * the container (and with it the in-sandbox agent), the row flips to `destroyed`
 * (which schedules a capacity wake so a parked waiter resumes immediately), the
 * VK is revoked, and the checkpoint/op rows are dropped. Best-effort per session;
 * scheduled (not awaited) by the cancel mutation so a teardown failure can never
 * fail the user's Stop. Idempotent: no live sessions → no-op.
 */
export const cancelSandboxForExecution = internalAction({
  args: { organizationId: v.string(), executionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sessions = await ctx.runQuery(
      internal.sandbox.session_queries.listWorkflowRunSessionsForExecution,
      { organizationId: args.organizationId, executionId: args.executionId },
    );
    for (const { sessionId } of sessions) {
      await teardownAgentSession(ctx, args.organizationId, sessionId);
    }
    return null;
  },
});

const inputArgValidator = v.array(
  v.object({
    as: v.string(),
    from: v.union(
      v.object({ fileId: v.string() }),
      v.object({ folderId: v.string() }),
      v.object({ folderPath: v.string() }),
      v.object({ content: v.string() }),
    ),
  }),
);

/**
 * Resolve a folder input (by id or human-readable documents path) to stage
 * entries — one per document DIRECTLY in the folder (no recursion), placed
 * under `<prefix><as>/<doc name>`. Returns null when the folder does not
 * resolve in this org (the caller fails the step with a legible error: a
 * typo'd path staging an empty dir would otherwise surface as a confusing
 * downstream script failure).
 */
export async function folderStageFiles(
  ctx: Pick<ActionCtx, 'runQuery' | 'storage'>,
  organizationId: string,
  from: { folderId: string } | { folderPath: string },
  as: string,
  pathPrefix: string,
): Promise<SessionStageFile[] | null> {
  const files = await ctx.runQuery(
    internal.documents.internal_queries.listFilesByFolderInternal,
    {
      organizationId,
      ...('folderId' in from
        ? { folderId: toId<'folders'>(from.folderId) }
        : { folderPath: from.folderPath }),
    },
  );
  if (files === null) return null;
  const dir = as.replace(/\/+$/, '');
  const staged: SessionStageFile[] = [];
  for (const file of files) {
    const raw = await ctx.storage.getUrl(toId<'_storage'>(file.fileId));
    if (!raw) continue; // blob purged under a live row — skip, don't fail
    staged.push({
      path: `${pathPrefix}${dir}/${file.name}`,
      url: toSandboxStorageUrl(raw),
    });
  }
  return staged;
}

const outputArgValidator = v.optional(
  v.object({
    collectDir: v.optional(v.string()),
    resultFile: v.optional(v.string()),
  }),
);

/** Unified sandbox-step result. Big data stays as file ids; result is small. */
export const sandboxRunResultValidator = v.object({
  mode: v.union(v.literal('agent'), v.literal('script')),
  ok: v.boolean(),
  status: v.string(),
  result: v.optional(v.any()),
  /** Parsed `output/summary.md` (agent runs) — the legible handoff. */
  summary: v.optional(v.string()),
  /** Whether the agent actually wrote `output/summary.md` (vs a synthesized
   * fallback). A workflow condition can gate on `output.data.summaryWritten`. */
  summaryWritten: v.optional(v.boolean()),
  /** Parsed `output/grade.json` when the agent wrote a structured grade handoff. */
  gradeJson: v.optional(v.string()),
  outputFileIds: v.array(v.string()),
  /** Harvested output files (name ↔ storage id), so the run view can offer
   * openable links (e.g. "Open summary.md") without re-listing the sandbox. */
  outputFiles: v.optional(
    v.array(v.object({ name: v.string(), storageId: v.string() })),
  ),
  outputFolderId: v.optional(v.string()),
  transcriptFileId: v.optional(v.string()),
  exitCode: v.optional(v.number()),
  stdoutPreview: v.optional(v.string()),
  stderrPreview: v.optional(v.string()),
  /** Whole-run wall-clock, platform-measured — script mode: the session-exec
   * run duration (installs + steps + harvest, `SessionExecResultShape`);
   * agent mode: the run's wall-clock from its checkpoint `startedAt`, across
   * segments. NOT the canonical per-exec execution time (runnerd's
   * `exit.durationMs`). */
  durationMs: v.optional(v.number()),
  error: v.optional(v.string()),
  /** Structured refusal reason when the task-metrics admission gate rejected
   * the run (budget/concurrency/circuit) — normalized to the task-workflow
   * vocabulary so a generic loop's `check_refused` can route it to a quiet
   * rollback instead of a noisy failure comment. */
  refusedReason: v.optional(v.string()),
  /** Park-on-capacity: set with `status:'awaiting_capacity'` to suggest how long
   * the durable handler should sleep before re-entering (the spawner's
   * `retry-after` on a global 429; absent → the per-org poll backoff). */
  retryAfterMs: v.optional(v.number()),
});

// Explicit handler return type — breaks the circular `internal` type inference
// that would otherwise degrade the generated api types to `any` (this module is
// part of `internal` AND calls `internal.*.executeCode`).
type SandboxRunResult = Infer<typeof sandboxRunResultValidator>;

export const runSandboxScript = internalAction({
  args: {
    organizationId: v.string(),
    executionId: v.string(),
    stepSlug: v.string(),
    script: v.string(),
    language: v.union(
      v.literal('python'),
      v.literal('node'),
      v.literal('bash'),
    ),
    params: v.optional(v.record(v.string(), v.any())),
    inputs: inputArgValidator,
    output: outputArgValidator,
    timeoutMs: v.optional(v.number()),
    // Step-scoped env (resolved/templated by the engine). Forwarded to the
    // spawner, which sanitizes + injects it into the script's process env.
    env: v.optional(v.record(v.string(), v.string())),
  },
  returns: sandboxRunResultValidator,
  handler: async (ctx, args): Promise<SandboxRunResult> => {
    const fail = (error: string): SandboxRunResult => ({
      mode: 'script',
      ok: false,
      status: 'failed',
      outputFileIds: [],
      error,
    });

    const storeAsUrl = async (content: string): Promise<string> => {
      // An explicit content-type is REQUIRED: a typeless Blob makes
      // ctx.storage.store send an empty Content-Type header, which the storage
      // backend rejects ("BadHeader: invalid HTTP header"). text/plain is the
      // safe default — the sandbox stages these as plain workspace files.
      const storageId = await ctx.storage.store(
        new Blob([content], { type: 'text/plain' }),
      );
      const raw = await ctx.storage.getUrl(storageId);
      if (!raw) throw new Error('failed to mint storage url');
      return toSandboxStorageUrl(raw);
    };

    const sessionId = sessionIdForWorkflowRun(args.executionId, args.stepSlug);
    let rowId: Id<'sandboxSessions'> | null = null;
    try {
      // Resolve the frozen pack:// script to its bundled content.
      const PREFIX = 'pack://';
      if (!args.script.startsWith(PREFIX)) {
        return fail(`script must be a pack:// reference, got "${args.script}"`);
      }
      const rest = args.script.slice(PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return fail(`invalid pack:// reference "${args.script}"`);
      // `pack://<app>/<path>` resolves against the APP bundle (apps/<app>/...).
      const appSlug = rest.slice(0, slash);
      const relPath = rest.slice(slash + 1);
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const scriptPath = await resolveAppAssetPathChecked(
        orgSlug,
        appSlug,
        relPath,
      );
      const scriptContent = await readFile(scriptPath, 'utf8');
      const scriptName = relPath.split('/').pop() ?? 'script';

      // Stage the script + inline-content inputs + params.json under /user/code
      // (the script's cwd); fileId inputs under /user/uploads; a folder input
      // stages every document directly in that folder under /user/uploads/<as>/.
      const stageInputs: SessionStageFile[] = [
        { path: `code/${scriptName}`, url: await storeAsUrl(scriptContent) },
      ];
      for (const input of args.inputs) {
        if ('content' in input.from) {
          stageInputs.push({
            path: `code/${input.as}`,
            url: await storeAsUrl(input.from.content),
          });
        } else if ('fileId' in input.from) {
          const raw = await ctx.storage.getUrl(
            toId<'_storage'>(input.from.fileId),
          );
          if (!raw) return fail(`input file not found: ${input.from.fileId}`);
          stageInputs.push({
            path: `uploads/${input.as}`,
            url: toSandboxStorageUrl(raw),
          });
        } else {
          const staged = await folderStageFiles(
            ctx,
            args.organizationId,
            input.from,
            input.as,
            'uploads/',
          );
          if (staged === null) {
            return fail(
              `input folder not found: ${JSON.stringify(input.from)}`,
            );
          }
          stageInputs.push(...staged);
        }
      }
      if (args.params) {
        stageInputs.push({
          path: 'code/params.json',
          url: await storeAsUrl(JSON.stringify(args.params)),
        });
      }

      // Reserve + create the ephemeral workflow-run session — the SAME session
      // machinery chat run_code and workflow AGENT steps run on, keyed per
      // (execution, step) and torn down at step end (the `finally`). Park-on-
      // capacity: the reserve claims the FIFO ticket the admission poll parked; a
      // peer that won the slot first throws WAIT_FIFO → `awaiting_capacity` below.
      rowId = await ctx.runMutation(
        internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
        {
          organizationId: args.organizationId,
          sessionId,
          profile: 'default',
          ownerType: 'workflow_run',
          ownerId: workflowRunOwnerId(args.executionId, args.stepSlug),
          createdBy: 'workflow',
          ticket: {
            source: 'workflow',
            wfExecutionId: args.executionId,
            stepSlug: args.stepSlug,
          },
        },
      );
      try {
        try {
          await sessionCreate({
            sessionId,
            organizationId: args.organizationId,
            profile: 'default',
          });
        } catch (createErr) {
          // A deterministic-id collision can only be an orphan (the reserve
          // serializes platform-side creation) — reap and retry once.
          if (!(createErr instanceof SessionDuplicateError)) throw createErr;
          await sessionDestroy(sessionId);
          await sessionCreate({
            sessionId,
            organizationId: args.organizationId,
            profile: 'default',
          });
        }
      } catch (createErr) {
        // Mark the reserved row terminal so it stops holding a slot; the
        // sessionId-keyed teardown in `finally` is then a no-op on it.
        await ctx.runMutation(
          internal.sandbox.session_mutations.setSessionStatus,
          { rowId, status: 'failed' },
        );
        throw createErr;
      }
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'active', lastActivityAt: Date.now() },
      );

      // Inject the step-scoped env (resolved/templated secrets) into the session
      // so the script's process sees it — the spawner sanitizes + refuses
      // reserved names (returned as `denied`).
      if (args.env !== undefined && Object.keys(args.env).length > 0) {
        const denied = await sessionEnvPatch(sessionId, { set: args.env });
        if (denied.length > 0) {
          console.warn(
            `[runSandboxScript] ${denied.length} step env var(s) refused (reserved names): ${denied.join(', ')}`,
          );
        }
      }

      await sessionStageFiles(sessionId, stageInputs);

      const res = await runAndHarvestInSession(ctx, {
        organizationId: args.organizationId,
        workspaceThreadId: args.executionId,
        sessionId,
        stepPaths: [`/user/code/${scriptName}`],
        ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
      });

      // Read the small structured verdict (result.json) back into `result`.
      let result: unknown;
      const resultFileName = args.output?.resultFile ?? 'result.json';
      const resultFile = res.files.find((f) => f.path.endsWith(resultFileName));
      if (resultFile) {
        const blob = await ctx.storage.get(
          toId<'_storage'>(resultFile.storageId),
        );
        if (blob) {
          try {
            result = JSON.parse(await blob.text());
          } catch (e) {
            console.warn('[sandbox] result.json parse failed', e);
          }
        }
      }

      return {
        mode: 'script' as const,
        ok: res.status === 'completed',
        status: res.status,
        ...(result !== undefined && { result }),
        outputFileIds: res.files.map((f) => f.storageId),
        // Name↔id pairs, like agent runs — lets a follow-up step pick a
        // harvested artifact by name (e.g. file `return.xml` as a document).
        outputFiles: res.files.map((f) => ({
          name: f.path.split('/').pop() ?? f.path,
          storageId: f.storageId,
        })),
        ...(res.exitCode !== null && { exitCode: res.exitCode }),
        stdoutPreview: res.stdoutPreview,
        stderrPreview: res.stderrPreview,
        durationMs: res.durationMs,
        ...(res.status === 'failed' &&
          res.stderrPreview.length > 0 && {
            error: res.stderrPreview.slice(0, 1024),
          }),
      };
    } catch (e) {
      // Park-on-capacity: a per-org FIFO wait (WAIT_FIFO) or a global host-cap
      // 429 (SpawnerBusyError) is NOT a failure — surface `awaiting_capacity` so
      // the durable handler sleeps + re-enters this step instead of failing it.
      if (isWaitFifoError(e)) {
        return {
          mode: 'script' as const,
          ok: false,
          status: 'awaiting_capacity',
          outputFileIds: [],
        };
      }
      if (e instanceof SpawnerBusyError) {
        return {
          mode: 'script' as const,
          ok: false,
          status: 'awaiting_capacity',
          outputFileIds: [],
          ...(e.retryAfterMs !== undefined && { retryAfterMs: e.retryAfterMs }),
        };
      }
      return fail(e instanceof Error ? e.message : String(e));
    } finally {
      // Ephemeral: tear the session down at step end (like agent steps). Skipped
      // when we never reserved (a park/early-return) so a parked ticket keeps its
      // place; best-effort, and markSessionRowDestroyed no-ops a non-live row.
      if (rowId !== null) {
        try {
          await sessionDestroy(sessionId);
        } catch (err) {
          console.warn('[runSandboxScript] session destroy failed:', err);
        }
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.markSessionRowDestroyed,
            { organizationId: args.organizationId, sessionId },
          );
        } catch (err) {
          console.warn('[runSandboxScript] row destroy failed:', err);
        }
      }
    }
  },
});

export const runSandboxAgent = internalAction({
  args: {
    organizationId: v.string(),
    executionId: v.string(),
    stepSlug: v.string(),
    agentSlug: v.string(),
    // Task-metrics binding (present only when the workflow execution is about a
    // task — see execute_sandbox_node). Drives the taskAgentRuns admission gate
    // (budget/concurrency/circuit-breaker) + usage accrual. Absent ⇒ no metrics.
    taskId: v.optional(v.id('tasks')),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    workflowSlug: v.optional(v.string()),
    instructions: v.optional(v.string()),
    budget: v.object({
      maxCents: v.number(),
      maxWallClockMs: v.number(),
      maxTurns: v.optional(v.number()),
    }),
    model: v.optional(v.string()),
    inputs: inputArgValidator,
    output: outputArgValidator,
    // Step-scoped env (already resolved/templated by the engine). Injected into
    // the session below, BEFORE broker credentials so a security-critical
    // broker var (e.g. GITHUB_TOKEN) always wins on a name collision.
    env: v.optional(v.record(v.string(), v.string())),
    /** When `workflow`, preserve the sandbox across steps in one execution. */
    sessionScope: v.optional(v.union(v.literal('step'), v.literal('workflow'))),
  },
  returns: sandboxRunResultValidator,
  handler: async (ctx, args): Promise<SandboxRunResult> => {
    const fail = (error: string): SandboxRunResult => ({
      mode: 'agent',
      ok: false,
      status: 'failed',
      outputFileIds: [],
      error,
    });

    // Resolve the org agent config (adapter kind, model, auth posture,
    // integration grants) — the slug names an org-chart agent, not the CLI
    // adapter that runAgentInSessionImpl wants.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const [delegate] = await loadDelegateAgents(
      ctx,
      [args.agentSlug],
      args.organizationId,
      orgSlug,
    );
    if (!delegate) {
      return fail(`agent "${args.agentSlug}" not found or misconfigured`);
    }
    const agentConfig = delegate.agentConfig;
    const agentKind = agentConfig.agentKind ?? 'claude-code';
    const productKind: ProductAgentSlug = resolveProductAgentKind(agentKind);
    const byo = agentConfig.authMode === 'byo';
    const gatewayRun = usesGateway(productKind, agentConfig.authMode);
    // Native web tools: the raw per-agent opt-in (managed agents deny WebSearch/
    // WebFetch by default; this lifts it). Passed to the adapter as-is; the skill
    // guidance uses `byo || === true` (the agent's ACTUAL native-tool state).
    const nativeWebTools = agentConfig.nativeWebTools;
    const modelRef = args.model ?? delegate.model;
    const integrationBindings = agentConfig.integrationBindings ?? [];
    const brokerGrants = BROKERABLE_GRANTS.filter((g) =>
      integrationBindings.includes(g),
    );

    // Vision polyfill (managed only): authoring an invoice transform means
    // SEEING the invoice, but a text-only model can't. When the agent's own
    // model lacks the `vision` tag, inject the vision MCP bridge
    // (tale-vision-mcp) backed by the org's configured vision model — the bridge
    // relays to the SAME gateway with the session key (no provider key enters
    // the container), and the VK below is scoped to also allow that model. BYO
    // brings its own credential + model, so it is never polyfilled here.
    let visionTool = false;
    let visionModel: string | undefined; // gateway model id the MCP server calls
    let visionModelRef: string | undefined; // tale ref added to the VK allowlist
    if (!byo && modelRef && modelRef !== 'default') {
      try {
        const parsed = parseModelRef(modelRef);
        const catalog = await ctx.runAction(
          internal.providers.file_actions.getModelRoutingCatalog,
          { organizationId: args.organizationId },
        );
        const agentEntry = catalog.find(
          (c) =>
            c.id === parsed.modelId &&
            (parsed.providerName === undefined ||
              c.providerName === parsed.providerName),
        );
        if (!(agentEntry?.tags.includes('vision') ?? false)) {
          const vision = await resolveLanguageModel(ctx, {
            tag: 'vision',
            organizationId: args.organizationId,
          });
          visionModelRef = formatModelRef({
            providerName: vision.modelData.providerName,
            modelId: vision.modelData.modelId,
          });
          visionModel =
            resolveGatewayRoutingFromRef(visionModelRef).gatewayModel;
          visionTool = true;
        }
      } catch (err) {
        // No vision model configured (resolveLanguageModel throws) or the
        // catalog is unavailable — skip the polyfill (the agent just can't read
        // images this run, as today). Never fail the run over a missing
        // convenience tool.
        console.warn(
          '[runSandboxAgent] vision polyfill resolution skipped:',
          err,
        );
      }
    }
    // The session VK allows the agent's model plus (when polyfilling) the vision
    // model the bridge calls — otherwise the gateway 403s the vision request.
    const allowedModels = visionModelRef
      ? [modelRef, visionModelRef]
      : [modelRef];

    const sessionScope: SandboxSessionScope = args.sessionScope ?? 'step';
    const { sessionId, ownerId, checkpointKey } = resolveWorkflowSandboxSession(
      {
        executionId: args.executionId,
        stepSlug: args.stepSlug,
        sessionScope,
      },
    );
    const preserveSessionAfterStep = sessionScope === 'workflow';
    const execId = `${args.executionId}-${args.stepSlug}`;
    const collectDir = args.output?.collectDir ?? 'output';
    // Token-source bindings from the agent's Environment-tab rows (captured in
    // the agent-env injection below, consumed by the rotation block at run).
    let agentTokenBindings: { key: string; tokenSourceSlug: string }[] = [];
    // Skills the agent can actually load (captured in the skill-staging block
    // below) + whether the workspace is Tale's own monorepo — both feed the
    // skills-guidance section of the system-prompt append.
    let availableWorkflowSkills: ReadonlySet<string> = new Set<string>();
    let workspaceIsTale = false;

    // RESUME? A prior segment of THIS step handed off (status 'running') and the
    // durable workflow handler re-entered the step. The exec is STILL RUNNING in
    // the sandbox — re-attach from the cursor and skip the entire setup (no new
    // exec is built on resume). Absent ⇒ this is the first segment (fresh run).
    const checkpoint = await ctx.runQuery(
      internal.sandbox.session_queries.loadAgentCheckpoint,
      { sessionId: checkpointKey },
    );
    const resuming = checkpoint !== null;
    let reusingSharedSession = false;
    if (!resuming && preserveSessionAfterStep) {
      const liveSession = await ctx.runQuery(
        internal.sandbox.session_queries.getSessionBySessionId,
        { sessionId },
      );
      reusingSharedSession = liveSession !== null;
    }

    // The exec that is ACTUALLY running right now. It starts as the canonical
    // `execId`, but a credential failover re-runs under `${execId}-t<n>` — so a
    // rotated attempt that itself hands off must checkpoint (and on resume,
    // re-attach to) the rotated id, NOT the canonical one. On resume we adopt
    // whatever id the prior segment recorded as live (mirrors the chat path,
    // which reassigns its `execId` on each rotation).
    let liveExecId = checkpoint?.execId ?? execId;

    // Cumulative budget across ALL segments: `startedAt` is the FIRST segment's
    // start, so `maxWallClockMs` is a hard TOTAL cap independent of any single
    // action window; `continuationCount` carries the runaway backstop.
    const startedAt = checkpoint?.startedAt ?? Date.now();
    const continuationCount = checkpoint?.continuationCount ?? 0;
    const hardDeadlineMs = startedAt + args.budget.maxWallClockMs;
    // Bound the container's life to the step budget + grace so the spawner
    // reaps it even if the platform-side teardown is skipped (hard kill).
    const ttlMs = args.budget.maxWallClockMs + EPHEMERAL_TTL_GRACE_MS;

    // Task-metrics gate (task-bound runs only). A durable agent run is admitted
    // ONCE on the fresh segment (taskAgentRuns row + budget/concurrency/circuit
    // guards), and the runId is carried in the checkpoint so resume segments
    // re-use it — re-admitting would double-count the concurrency slot. Usage is
    // recorded + the run finalized at the terminal segment. The abandonment leak
    // (a hard-killed run that never finalizes) self-heals via recoverStuckTaskRuns.
    const taskId = args.taskId;
    let taskRunId: Id<'taskAgentRuns'> | null = checkpoint?.taskRunId ?? null;
    const recordRunUsage = async (
      usage: { inputTokens: number; outputTokens: number } | undefined,
    ): Promise<void> => {
      if (taskRunId === null || usage === undefined) return;
      // BYO/OAuth bypasses the gateway → no per-token operator cost; record real
      // tokens but costCents 0 (the maxCents budget simply doesn't bind for byo).
      const costCents = byo
        ? 0
        : estimateCostCents(modelRef, usage.inputTokens, usage.outputTokens);
      try {
        await ctx.runMutation(
          internal.task_metrics.internal_mutations.recordTaskRunUsage,
          {
            runId: taskRunId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costCents,
          },
        );
      } catch (err) {
        console.warn('[runSandboxAgent] recordTaskRunUsage failed:', err);
      }
    };
    const finalizeRunMetric = async (
      status: 'completed' | 'failed' | 'timed_out',
      outcome: 'output_posted' | 'error',
      error?: string,
    ): Promise<void> => {
      if (taskRunId === null) return;
      try {
        await ctx.runMutation(
          internal.task_metrics.internal_mutations.finalizeTaskAgentRun,
          {
            runId: taskRunId,
            status,
            outcome,
            ...(error !== undefined && { error: error.slice(0, 500) }),
          },
        );
      } catch (err) {
        console.warn(
          '[runSandboxAgent] finalizeTaskAgentRun failed (stuck-sweep backstop):',
          err,
        );
      }
    };

    // A re-entry that already exceeded the total budget / backstop → force a
    // terminal teardown (harvest whatever exists, return a timeout). A
    // workflow-scoped session must SURVIVE this step's timeout — later steps
    // (and the human-pause resume) still need the shared workspace — so only
    // this step's checkpoint is dropped; the session itself is torn down at
    // workflow completion.
    if (
      resuming &&
      (Date.now() >= hardDeadlineMs ||
        continuationCount >= MAX_AGENT_CONTINUATIONS)
    ) {
      const { outputFileIds, summary } = await harvestSandboxOutput(
        ctx,
        sessionId,
        collectDir,
        undefined,
      );
      if (preserveSessionAfterStep) {
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.deleteAgentCheckpoint,
            { sessionId: checkpointKey },
          );
        } catch (cleanupErr) {
          console.warn(
            '[runSandboxAgent] budget-exhausted checkpoint cleanup failed:',
            cleanupErr,
          );
        }
      } else {
        await teardownAgentSession(ctx, args.organizationId, sessionId);
      }
      await finalizeRunMetric(
        'timed_out',
        'error',
        `agent run exceeded its wall-clock budget (${args.budget.maxWallClockMs}ms)`,
      );
      return {
        mode: 'agent',
        ok: false,
        status: 'timeout',
        summary,
        outputFileIds,
        durationMs: Date.now() - startedAt,
        error: `agent run exceeded its wall-clock budget (${args.budget.maxWallClockMs}ms)`,
      };
    }

    // Set true on a handoff (segment ended, run continues) so the `finally`
    // SKIPS teardown — the session + VK + exec must survive to the next segment.
    let keepAlive = false;
    // The session VK (managed runs only). On a fresh segment the mint sets it; on
    // resume the exec already holds its key (re-attach builds no exec), so the
    // re-attach needs no gateway args.
    let gatewayToken: string | null = null;

    try {
      if (!resuming) {
        // ===== FRESH segment: full session setup (steps 0–6) =================
        // 0a. Task-metrics admission FIRST — before any session/VK/compute is
        // built, so a budget/concurrency/circuit refusal allocates nothing. The
        // returned runId is carried across segments via the checkpoint.
        if (taskId !== undefined) {
          const admission = await ctx.runMutation(
            internal.task_metrics.internal_mutations.startTaskAgentRun,
            {
              organizationId: args.organizationId,
              taskId,
              agentSlug: args.agentSlug,
              trigger: 'manual',
              ...(args.wfExecutionId !== undefined && {
                wfExecutionId: args.wfExecutionId,
              }),
              ...(args.workflowSlug !== undefined && {
                workflowSlug: args.workflowSlug,
              }),
              guardContext: 'task_run',
              ...(agentConfig.budget !== undefined && {
                budget: agentConfig.budget,
              }),
              ...(agentConfig.maxConcurrentTasks !== undefined && {
                maxConcurrentTasks: agentConfig.maxConcurrentTasks,
              }),
            },
          );
          if (!admission.started || !admission.runId) {
            const reason = admission.reason ?? 'unknown';
            const isConcurrency =
              reason === 'agent_concurrency' || reason === 'org_concurrency';
            // Concurrency refusals PARK — waiting clears them when a peer run
            // finishes, so emit `awaiting_capacity` and let the durable handler
            // re-enter this step. Budget/circuit refusals are hard policy stops
            // (waiting can't clear them) → fail as before. `refusedReason` keeps
            // the task-workflow vocabulary so a generic loop's `check_refused`
            // still routes either to a quiet rollback, not a noisy comment.
            const refusedReason =
              reason === 'budget_paused' || reason === 'task_circuit_breaker'
                ? reason
                : isConcurrency
                  ? 'queued'
                  : undefined;
            return {
              mode: 'agent',
              ok: false,
              status: isConcurrency ? 'awaiting_capacity' : 'failed',
              outputFileIds: [],
              error: `agent run refused: ${reason}`,
              ...(refusedReason !== undefined && { refusedReason }),
            };
          }
          taskRunId = admission.runId;
        }

        // 0. Opportunistic backstop: reap this org's leaked workflow_run
        // sessions (TTL elapsed, finally skipped) before adding our own.
        try {
          await reapStaleWorkflowRunSessions(ctx, args.organizationId);
        } catch (reapErr) {
          console.warn('[runSandboxAgent] stale-session reap failed:', reapErr);
        }

        // 1. Create the ephemeral agent session (deterministic id → a step retry
        // reaps the orphan rather than duplicating), OR reuse a workflow-scoped
        // session already live from a prior step in this execution.
        if (!reusingSharedSession) {
          const rowId: Id<'sandboxSessions'> = await ctx.runMutation(
            internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
            {
              organizationId: args.organizationId,
              sessionId,
              profile: 'agent',
              ownerType: 'workflow_run',
              ownerId,
              createdBy: 'system',
              agentKind,
              // Park-on-capacity: the per-org session cap is a FIFO queue. This
              // claims the ticket the `executeSandboxNode` poll parked; if a peer
              // won the slot first, the mutation throws WAIT_FIFO (caught below →
              // awaiting_capacity, re-entered by the durable handler).
              ticket: {
                source: 'workflow',
                wfExecutionId: args.executionId,
                stepSlug: args.stepSlug,
              },
            },
          );
          try {
            try {
              await sessionCreate({
                sessionId,
                organizationId: args.organizationId,
                profile: 'agent',
                ttlMs,
                idleTimeoutMs: ttlMs,
              });
            } catch (createErr) {
              // A deterministic-id collision can only be an orphan (platform-side
              // creation is serialized by the reserve) — reap and retry once.
              if (!(createErr instanceof SessionDuplicateError))
                throw createErr;
              await sessionDestroy(sessionId);
              await sessionCreate({
                sessionId,
                organizationId: args.organizationId,
                profile: 'agent',
                ttlMs,
                idleTimeoutMs: ttlMs,
              });
            }
          } catch (createErr) {
            // Mark the row failed (terminal). The sessionId-keyed teardown in the
            // outer `finally` is a no-op on it (markSessionRowDestroyed skips
            // non-live rows), so the 'failed' signal is preserved.
            await ctx.runMutation(
              internal.sandbox.session_mutations.setSessionStatus,
              { rowId, status: 'failed' },
            );
            throw createErr;
          }
          await ctx.runMutation(
            internal.sandbox.session_mutations.setSessionStatus,
            { rowId, status: 'active', lastActivityAt: Date.now() },
          );
        } else {
          // Re-take the slot FIRST (before building any compute): a stopped
          // (hibernated) row freed its per-org slot, so the mutation re-admits
          // through the FIFO ticket queue (throws WAIT_FIFO → the catch below
          // parks this step as awaiting_capacity); an active row is just an
          // idempotent refresh.
          await ctx.runMutation(
            internal.sandbox.session_mutations.resumeWorkflowSessionSlot,
            {
              organizationId: args.organizationId,
              sessionId,
              ticket: {
                source: 'workflow',
                wfExecutionId: args.executionId,
                stepSlug: args.stepSlug,
              },
            },
          );
          // The row is live but the CONTAINER may be gone: the spawner's
          // idle/TTL sweep STOPS a quiet session (workspace preserved, registry
          // entry dropped) — guaranteed during a human-review pause longer than
          // the idle window. Only sessionCreate resurrects a stopped session
          // (re-attaching the preserved workspace), so probe and re-create —
          // same pattern as ensureThreadSession.
          if (!(await sessionIsAlive(sessionId))) {
            try {
              await sessionCreate({
                sessionId,
                organizationId: args.organizationId,
                profile: 'agent',
                ttlMs,
                idleTimeoutMs: ttlMs,
              });
            } catch (createErr) {
              // A duplicate means the aliveness probe raced a live container —
              // the session exists after all. Anything else: hand the slot
              // back (flip the row to stopped) before surfacing, so a parked
              // peer isn't starved by a slot-holding row with no container.
              if (!(createErr instanceof SessionDuplicateError)) {
                try {
                  await ctx.runMutation(
                    internal.sandbox.session_mutations.markSessionRowStopped,
                    { organizationId: args.organizationId, sessionId },
                  );
                } catch (stopErr) {
                  console.warn(
                    '[runSandboxAgent] slot give-back after failed re-create failed:',
                    stopErr,
                  );
                }
                throw createErr;
              }
            }
          }
        }

        // 1b. The shared workspace carries the PREVIOUS run's collect dir —
        // clear it before this step executes so the harvest below only ever
        // sees files THIS run wrote. A stale summary.md would set
        // summaryWritten and mask a laundered API error as a genuine handoff;
        // a stale grade.json would feed the judge the previous round's grade.
        if (preserveSessionAfterStep) {
          try {
            const staleEntries = await sessionListFiles(sessionId, collectDir);
            const stalePaths = (staleEntries ?? [])
              .filter((entry) => entry.type === 'file')
              .map((entry) => `${collectDir}/${entry.name}`);
            if (stalePaths.length > 0) {
              await sessionDeleteFiles(sessionId, stalePaths);
            }
          } catch (precleanErr) {
            console.warn(
              '[runSandboxAgent] collect-dir pre-clean failed:',
              precleanErr,
            );
          }
        }

        // 2. Provider provisioning + gateway auth-hardening (managed only) so the
        // mint below binds the VK to the org's upstream key. Provisioning is
        // best-effort (the mint fails closed if no key); auth-hardening is not.
        if (!byo) {
          try {
            const gatewayProviders = await loadOrgGatewayProviders(
              ctx,
              args.organizationId,
            );
            if (gatewayProviders.length > 0) {
              await provisionProviders(args.organizationId, gatewayProviders);
            }
          } catch (provisionErr) {
            console.warn(
              '[runSandboxAgent] provisioning failed (mint fails closed):',
              provisionErr,
            );
          }
          await applyGatewayConfig();
        }

        // 3a. Inject the step's declared env (author intent) FIRST, so the
        // security-critical broker credentials injected in 3b always win on a
        // name collision. Isolated try/catch: a denied/failed step-env patch
        // must not block the credential injection below.
        if (args.env && Object.keys(args.env).length > 0) {
          try {
            const denied = await sessionEnvPatch(sessionId, { set: args.env });
            if (denied.length > 0) {
              console.warn('[runSandboxAgent] step env names denied:', denied);
            }
          } catch (envErr) {
            console.warn(
              '[runSandboxAgent] step env injection failed (continuing):',
              envErr,
            );
          }
        }

        // 3a-bis. Inject the AGENT's own env/secrets (the per-agent store, keyed
        // by the composite slug — e.g. a byo `CLAUDE_CODE_OAUTH_TOKEN`). This is
        // how a byo agent gets its LLM credential in the workflow sandbox path
        // (the chat path uses the user's box env; a workflow run has no single
        // user, so the org-scoped per-agent store is the right source). After
        // step env, before broker creds, so a broker var still wins on collision.
        try {
          const agentEnv = await ctx.runAction(
            internal.agents.agent_env_actions.resolveAgentEnv,
            { organizationId: args.organizationId, agentSlug: args.agentSlug },
          );
          agentTokenBindings = agentEnv.tokenBindings;
          if (Object.keys(agentEnv.env).length > 0) {
            const denied = await sessionEnvPatch(sessionId, {
              set: agentEnv.env,
            });
            if (denied.length > 0) {
              console.warn('[runSandboxAgent] agent env names denied:', denied);
            }
          }
        } catch (agentEnvErr) {
          console.warn(
            '[runSandboxAgent] agent env injection failed (continuing):',
            agentEnvErr,
          );
        }

        // 3b. Inject Tier-2 broker credentials (e.g. GITHUB_TOKEN) for bound
        // integrations so the agent can self-fetch code — never persisted.
        try {
          const creds = await ctx.runAction(
            internal.node_only.sandbox.session_credentials
              .resolveSessionCredentials,
            {
              organizationId: args.organizationId,
              sessionId,
              grants: brokerGrants,
              kind: 'bootstrap',
            },
          );
          if (Object.keys(creds.env).length > 0) {
            const denied = await sessionEnvPatch(sessionId, { set: creds.env });
            if (denied.length > 0) {
              console.warn('[runSandboxAgent] env names denied:', denied);
            }
          }
        } catch (credErr) {
          console.warn(
            '[runSandboxAgent] credential injection failed (continuing):',
            credErr,
          );
        }

        // 4. Stage the agent's bound integration skills (best-effort) and
        // reconcile repo precedence for the image-baked builtin skills (the
        // entrypoint symlinks those; this only drops ones the repo shadows).
        // Also stage the org's workflow skills and probe the workspace — both
        // feed the skills-guidance section of the system-prompt append.
        try {
          await stageIntegrationSkills(ctx, {
            organizationId: args.organizationId,
            sessionId,
            productKind,
            nativeWebTools: byo || nativeWebTools === true,
          });
          await reconcileBuiltinSkills(ctx, { sessionId, productKind });
          await stageBoundOrgSkills(ctx, {
            organizationId: args.organizationId,
            sessionId,
            skillBindings: agentConfig.skillBindings,
            productKind,
          });
          availableWorkflowSkills = await stageWorkflowSkills(ctx, {
            organizationId: args.organizationId,
            sessionId,
            productKind,
          });
          workspaceIsTale = await workspaceIsTaleRepo(sessionId);
        } catch (skillErr) {
          console.warn(
            '[runSandboxAgent] integration skill staging failed (continuing):',
            skillErr,
          );
        }

        // 5. Stage declared inputs into the workspace: content/fileId at
        // `<as>`; a folder input stages every document directly in that folder
        // under `<as>/<name>` (workspace-relative, like the other agent inputs).
        const stageFiles: SessionStageFile[] = [];
        for (const input of args.inputs) {
          if ('content' in input.from) {
            stageFiles.push({
              path: input.as,
              contentBase64: Buffer.from(input.from.content).toString('base64'),
            });
          } else if ('fileId' in input.from) {
            const raw = await ctx.storage.getUrl(
              toId<'_storage'>(input.from.fileId),
            );
            if (!raw) return fail(`input file not found: ${input.from.fileId}`);
            stageFiles.push({ path: input.as, url: toSandboxStorageUrl(raw) });
          } else {
            const staged = await folderStageFiles(
              ctx,
              args.organizationId,
              input.from,
              input.as,
              '',
            );
            if (staged === null) {
              return fail(
                `input folder not found: ${JSON.stringify(input.from)}`,
              );
            }
            stageFiles.push(...staged);
          }
        }
        if (stageFiles.length > 0) {
          const staged = await sessionStageFiles(sessionId, stageFiles);
          if (staged.skipped.length > 0) {
            console.warn('[runSandboxAgent] inputs skipped:', staged.skipped);
          }
        }

        // 6. Mint a per-run, budget+model-scoped virtual key (managed only). The
        // step config's budget bounds the key directly (no org-rolling-remaining
        // accounting — the workflow owns the budget for this run). The key is
        // persisted in sandboxSessionTokens; the terminal teardown revokes it via
        // revokeTokensForSession (works on whichever segment reaches terminal).
        if (!byo) {
          const vk = await mintVirtualKey({
            budgetCents: args.budget.maxCents,
            allowedModels,
            organizationId: args.organizationId,
            sessionId,
          });
          gatewayToken = vk.key;
          await ctx.runMutation(
            internal.sandbox.session_mutations.insertSessionToken,
            {
              organizationId: args.organizationId,
              sessionId,
              tokenHash: hashVirtualKey(vk.key),
              llmGatewayKeyId: vk.keyId,
              scope: {
                agentKind,
                allowedModels,
                integrationGrants: brokerGrants,
                budgetCents: args.budget.maxCents,
              },
              expiresAt: hardDeadlineMs,
            },
          );
        }
      }

      // 7. Run ONE action-safe segment. `budgetDeadlineMs` trips the handoff at
      // the action window (or the hard total budget, whichever is sooner); the
      // exec keeps running across the seam under runnerd's detach-grace, so the
      // next segment re-attaches rather than restarting.
      const budgetDeadlineMs = Math.min(
        Date.now() + ACTION_WINDOW_MS,
        hardDeadlineMs,
      );
      const segmentTimeoutMs = Math.max(0, hardDeadlineMs - Date.now());
      // Fresh-run exec args (ignored on resume — no new exec is built).
      const prompt =
        args.instructions ??
        (agentConfig.instructions || 'Complete the assigned task.');
      // Claude-Code-only skills guidance (the staged workflow skills live in
      // CC's user-level skill dir); skipped on the Tale monorepo workspace and
      // when the agent's own instructions already carry the section.
      const skillsGuidance =
        getSkillsStageDir(productKind) !== null &&
        !workspaceIsTale &&
        !agentConfig.instructions?.includes(SKILLS_GUIDANCE_HEADING)
          ? buildSkillsGuidance(availableWorkflowSkills)
          : undefined;
      const systemPromptAppend = [
        agentConfig.instructions,
        skillsGuidance,
        SUMMARY_MANDATE,
      ]
        .filter((s): s is string => Boolean(s))
        .join('\n\n');
      // MANAGED (gateway): the gateway-format ref resolves to the gateway's model
      // id. BYO / env-backed (e.g. Cursor): the vendor-native id passes through
      // raw — gateway routing would mint nonsense ids the CLI rejects.
      const useModel = resolveExternalAgentExecModel({
        byo,
        gatewayRun,
        modelRef: modelRef ?? 'default',
        toGatewayModel: (ref) => resolveGatewayRoutingFromRef(ref).gatewayModel,
      });
      // Seed the resumed segment with the op's accumulated transcript so it
      // doesn't blank at the seam: the per-segment timeline resets on resume, so
      // without this an idle/empty segment (e.g. the agent waiting on CI) would
      // overwrite the op with an empty timeline and the run view would fall to
      // raw JSON. Read adjacent to the run so no op write intervenes (the op is
      // the single store; the checkpoint table stays a bounded cursor).
      const priorTimelineParts: UiTimelinePart[] =
        checkpoint !== null
          ? // The op stores UiTimelinePart[] (written by capAccumulatedLiveParts);
            // the read validator widens `state` to string, so narrow it back at
            // this trusted-storage boundary.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            ((await ctx.runQuery(
              internal.sandbox.session_queries.loadWorkflowOpLiveTimeline,
              { sessionId },
            )) as UiTimelinePart[])
          : [];
      // On RESUME the `if (!resuming)` setup block above was skipped, so the
      // agent's token bindings were never loaded. Re-fetch them (best-effort) so
      // a rotatable error on the resumed segment can fail over (Part C); a
      // failure just leaves the pool empty → the fresh-step retry fallback.
      if (resuming && agentTokenBindings.length === 0) {
        try {
          agentTokenBindings = await loadAgentTokenBindings(
            ctx,
            args.organizationId,
            args.agentSlug,
          );
        } catch (bindErr) {
          console.warn(
            '[runSandboxAgent] resume token-binding re-fetch failed (resume-rotation disabled):',
            bindErr,
          );
        }
      }
      // --- Token-source credential rotation (BYO) ---------------------------
      // Fetch the broker pool once and fail over to a different token on a
      // rate-limit/auth error. A FRESH start injects an initial pick below; a
      // RESUME keeps the credential the prior segment was using and only swaps it
      // if the re-attached segment returns a rotatable error (Part C — the pool
      // is now built on resume too, not just on fresh starts).
      let tokenPool: {
        tokens: string[];
        targetEnvVar: string;
        selection: TokenSelection;
        /** Broker source slug — kept so the rotation loop can RE-FETCH a fresh
         * pool from the broker when the cached tokens are exhausted. */
        slug: string;
      } | null = null;
      // v1 honors the first Environment-tab token-source binding (warns if more).
      const tokenBinding = agentTokenBindings[0];
      const tokenSourceSlug = tokenBinding?.tokenSourceSlug;
      if (tokenBinding !== undefined) {
        if (agentTokenBindings.length > 1) {
          console.warn(
            `[runSandboxAgent] ${agentTokenBindings.length} token-source bindings — v1 honors only the first (${tokenBinding.key}).`,
          );
        }
        if (!byo) {
          console.warn(
            `[runSandboxAgent] agent "${args.agentSlug}" binds a token source but is not BYO — the managed gateway key wins; ignoring`,
          );
        } else {
          // FRESH: fail-fast — resolveTokenPool throws TokenSourceError on an
          // unreachable/empty/malformed broker → the outer catch RE-THROWS → the
          // engine retries the step fresh and, if the broker stays down, fails
          // the execution loudly (no creds ⇒ the run cannot even start). RESUME:
          // the conversation is already running on a valid credential, so a
          // transient broker outage must NOT kill a healthy resumed segment —
          // degrade to no-pool (continue on the current token, no rotation this
          // segment). The binding's env var name wins over the source's default.
          try {
            const pool = await ctx.runAction(
              internal.node_only.sandbox.token_source_pool.resolveTokenPool,
              {
                organizationId: args.organizationId,
                orgSlug,
                sessionId,
                slug: tokenBinding.tokenSourceSlug,
              },
            );
            tokenPool = {
              tokens: pool.tokens,
              targetEnvVar: tokenBinding.key,
              selection: pool.selection,
              slug: tokenBinding.tokenSourceSlug,
            };
          } catch (poolErr) {
            if (!resuming) throw poolErr;
            console.warn(
              '[runSandboxAgent] resume token-pool build failed (rotation disabled this segment):',
              poolErr,
            );
          }
        }
      }
      const triedTokens = new Set<string>();
      // Inject the initial pick on a FRESH start only. A resumed conversation
      // already carries the credential the prior segment set (sessionEnvPatch is
      // sticky on the container); re-picking here would swap it mid-stream before
      // any error. `triedTokens` stays empty on resume (v1 — checkpointing the
      // last-used token to skip it on the first rotation is a later increment).
      if (tokenPool !== null && !resuming) {
        // resolveTokenPool guarantees a non-empty pool, so `first` is non-null.
        const first = pickToken(
          tokenPool.tokens,
          triedTokens,
          tokenPool.selection,
        );
        if (first !== null) {
          triedTokens.add(first);
          await sessionEnvPatch(sessionId, {
            set: { [tokenPool.targetEnvVar]: first },
          });
        }
      }

      const runFreshSegment = (
        segExecId: string,
      ): ReturnType<typeof runAgentInSessionImpl> =>
        runAgentInSessionImpl(ctx, {
          organizationId: args.organizationId,
          sessionId,
          execId: segExecId,
          agentSlug: agentKind,
          prompt,
          ...(useModel !== undefined && { model: useModel }),
          authMode: byo ? 'byo' : 'managed',
          ...(nativeWebTools !== undefined && { nativeWebTools }),
          interactionMode: 'autonomous',
          captureLiveTimeline: true,
          systemPromptAppend,
          ...(args.budget.maxTurns !== undefined && {
            maxTurns: args.budget.maxTurns,
          }),
          ...(!byo &&
            gatewayToken !== null && {
              gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
              gatewayToken,
              integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
            }),
          ...(visionTool &&
            visionModel !== undefined && { visionTool: true, visionModel }),
          budgetDeadlineMs,
          timeoutMs: segmentTimeoutMs,
        });

      // RESUME-rotation runner: spawn a FRESH `claude --resume <id>` exec to
      // continue the handed-off conversation on a rotated credential (NOT a
      // re-attach to the dead exec — that is what the `resumeFrom` initial
      // attempt does). Mirrors `runFreshSegment` but seeds `agentSessionId` and
      // the no-restart continuation prompt. BYO-only in practice (the pool is
      // BYO-gated), so the managed gateway block is moot.
      const runResumingSegment = (
        segExecId: string,
        resumeSessionId: string,
      ): ReturnType<typeof runAgentInSessionImpl> =>
        runAgentInSessionImpl(ctx, {
          organizationId: args.organizationId,
          sessionId,
          execId: segExecId,
          agentSlug: agentKind,
          prompt: RESUME_CONTINUATION_PROMPT,
          agentSessionId: resumeSessionId,
          ...(useModel !== undefined && { model: useModel }),
          authMode: byo ? 'byo' : 'managed',
          ...(nativeWebTools !== undefined && { nativeWebTools }),
          interactionMode: 'autonomous',
          captureLiveTimeline: true,
          systemPromptAppend,
          ...(args.budget.maxTurns !== undefined && {
            maxTurns: args.budget.maxTurns,
          }),
          ...(!byo &&
            gatewayToken !== null && {
              gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
              gatewayToken,
              integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
            }),
          ...(visionTool &&
            visionModel !== undefined && { visionTool: true, visionModel }),
          budgetDeadlineMs,
          timeoutMs: segmentTimeoutMs,
        });

      // Resume-rotation precondition (Part C): a resume, with the Claude session
      // id known (so a `--resume` exec is possible) and a pool resolved. When
      // false, a rotatable error on resume routes to Part A's fresh-step retry.
      const resumeSessionId = checkpoint?.agentSessionId;
      const useResumeRotation = shouldAttemptResumeRotation({
        resuming,
        agentSessionId: resumeSessionId,
        tokenPoolPresent: tokenPool !== null,
      });
      // Set when the resume runner throws (an unverified `--resume`-after-error
      // contract failure) → suppress the terminal TokenSourceError and fall
      // through to Part A's retryable fresh-step retry instead.
      let resumeRotationAborted = false;

      let result =
        checkpoint !== null
          ? await runAgentInSessionImpl(ctx, {
              organizationId: args.organizationId,
              sessionId,
              execId: liveExecId,
              agentSlug: agentKind,
              // Unused on resume — we re-attach to the still-running exec.
              prompt: '',
              interactionMode: 'autonomous',
              captureLiveTimeline: true,
              budgetDeadlineMs,
              timeoutMs: segmentTimeoutMs,
              resumeFrom: {
                lastSeq: checkpoint.lastSeq,
                ...(checkpoint.agentSessionId !== undefined && {
                  agentSessionId: checkpoint.agentSessionId,
                }),
                ...(checkpoint.agentResultSeen === true && {
                  agentResultSeen: true,
                }),
                ...(checkpoint.agentIdle === true && { agentIdle: true }),
                ...(checkpoint.pendingTaskIds !== undefined && {
                  pendingTaskIds: checkpoint.pendingTaskIds,
                }),
                ...(checkpoint.apiErrorSeen === true && { apiErrorSeen: true }),
                ...(priorTimelineParts.length > 0 && {
                  liveTimelineParts: priorTimelineParts,
                }),
              },
            })
          : await runFreshSegment(execId);

      // Credential failover: on a rate-limit (429/529) or auth (401/403, raised
      // early as an auth-abort) terminal result, swap to a different token and
      // re-run — up to MAX_TOKEN_ATTEMPTS total, while enough window remains. A
      // `running` handoff is NOT a failure and never rotates.
      let tokenAttempt = 1;
      let tokenRefetch = 0;
      if (tokenPool !== null) {
        let pool = tokenPool; // re-fetch swaps in a fresh broker pool below
        while (
          result.status !== 'running' &&
          tokenAttempt < MAX_TOKEN_ATTEMPTS &&
          budgetDeadlineMs - Date.now() > TOKEN_ROTATION_MIN_WINDOW_MS &&
          isRotatableApiError({
            isError: result.isError,
            apiErrorStatus: result.apiErrorStatus,
            terminationReason: result.terminationReason,
            authAbortStatus: result.authAbortStatus,
          })
        ) {
          let nextToken = pickToken(pool.tokens, triedTokens, pool.selection);
          // CACHED pool exhausted → RE-FETCH fresh secrets from the broker and
          // retry WARM (same sandbox; the resume runner preserves the session —
          // no teardown). The broker may have refreshed/rotated the credential
          // upstream. Bounded by MAX_TOKEN_REFETCH so a permanently-dead broker
          // can't spin; a backoff gives the broker a beat. If re-fetch is
          // unreachable or still yields no usable token, give up → the throw
          // below hands off to the engine's COLD retry (fresh sandbox, from
          // scratch), which on continued failure fails the execution loudly.
          if (nextToken === null) {
            if (tokenRefetch >= MAX_TOKEN_REFETCH) break;
            tokenRefetch += 1;
            await new Promise((r) => setTimeout(r, TOKEN_REFETCH_BACKOFF_MS));
            try {
              const fresh = await ctx.runAction(
                internal.node_only.sandbox.token_source_pool.resolveTokenPool,
                {
                  organizationId: args.organizationId,
                  orgSlug,
                  sessionId,
                  slug: pool.slug,
                },
              );
              pool = {
                tokens: fresh.tokens,
                targetEnvVar: pool.targetEnvVar,
                selection: fresh.selection,
                slug: pool.slug,
              };
            } catch (refetchErr) {
              console.warn(
                `[runSandboxAgent] token-source re-fetch ${tokenRefetch}/${MAX_TOKEN_REFETCH} failed (step ${args.stepSlug}):`,
                refetchErr,
              );
              break;
            }
            triedTokens.clear(); // fresh pool ⇒ every token eligible again
            console.warn(
              `[runSandboxAgent] token-source re-fetch ${tokenRefetch}/${MAX_TOKEN_REFETCH} (step ${args.stepSlug})`,
            );
            nextToken = pickToken(pool.tokens, triedTokens, pool.selection);
            if (nextToken === null) break; // broker returned an empty pool
          }
          triedTokens.add(nextToken);
          tokenAttempt += 1;
          await sessionEnvPatch(sessionId, {
            set: { [pool.targetEnvVar]: nextToken },
          });
          console.warn(
            `[runSandboxAgent] token rotation: attempt ${tokenAttempt}/${MAX_TOKEN_ATTEMPTS} after status=${result.apiErrorStatus ?? result.authAbortStatus} (step ${args.stepSlug})`,
          );
          // Carry the rotated exec id forward so a handoff from THIS attempt
          // checkpoints/resumes the live exec, not the dead first attempt.
          liveExecId = `${execId}-t${tokenAttempt}`;
          // FRESH: re-run the task on the new token (unchanged behavior). RESUME:
          // spawn a fresh `claude --resume <id>` on the new token to CONTINUE the
          // handed-off conversation. The resume runner is the unverified path
          // (mid-conversation `--resume`-after-error vs Anthropic's
          // previous_message_id contract), so ONLY it is wrapped: on throw, abort
          // rotation and fall through to Part A's retryable fresh-step retry (work
          // discarded but correct) — never the non-retryable TokenSourceError
          // below. The fresh path stays behaviorally identical (no try/catch).
          // The chat path (run_external_agent) has its own rotation loop with
          // op-row fencing — keep them separate; do NOT merge across the boundary.
          if (useResumeRotation && resumeSessionId !== undefined) {
            try {
              result = await runResumingSegment(liveExecId, resumeSessionId);
            } catch (resumeErr) {
              console.warn(
                '[runSandboxAgent] resume token rotation threw — falling back to a fresh step retry:',
                resumeErr,
              );
              resumeRotationAborted = true;
              break;
            }
          } else {
            result = await runFreshSegment(liveExecId);
          }
        }
      }

      // In-sandbox retries exhausted (every cached token + MAX_TOKEN_REFETCH
      // fresh broker re-fetches still rate-limited/auth-failed) → THROW. The
      // throw is the deliberate seam between the two retry layers: the warm
      // in-sandbox retries above are done, so we tear down (the `finally`,
      // keepAlive false) and hand off to the ENGINE's cold retry — a fresh
      // sandbox + a fresh pool resolve, everything from scratch (maxRetries) —
      // and if THAT keeps failing the execution fails loudly. A dead credential
      // is an operational exception, never a synthesized success or a quiet
      // business `ok:false`.
      // EXCEPTION: a resume runner that threw (`resumeRotationAborted`) did NOT
      // exhaust the pool — it hit the unverified `--resume`-after-error path, so
      // skip this throw and let Part A's execution-error throw fire below (a
      // fresh step retry is the correct, safe-by-construction fallback). This is
      // what keeps resume-rotation safe even though the mid-conversation contract
      // is unverified.
      if (
        tokenPool !== null &&
        !resumeRotationAborted &&
        result.status !== 'running' &&
        isRotatableApiError({
          isError: result.isError,
          apiErrorStatus: result.apiErrorStatus,
          terminationReason: result.terminationReason,
          authAbortStatus: result.authAbortStatus,
        })
      ) {
        throw new TokenSourceError(
          `all ${tokenAttempt} token(s) from "${tokenSourceSlug ?? '?'}" failed with rate-limit/auth errors (last status=${result.apiErrorStatus ?? result.authAbortStatus})`,
        );
      }

      // HANDOFF: the action window elapsed mid-run. Persist the cursor, keep the
      // session alive, and return `running` so the workflow handler re-enters
      // this step — UNLESS the total budget / backstop is now exhausted (then
      // fall through to a terminal teardown as a timeout).
      if (result.status === 'running') {
        const nextCount = continuationCount + 1;
        const exhausted =
          Date.now() >= hardDeadlineMs || nextCount >= MAX_AGENT_CONTINUATIONS;
        if (!exhausted) {
          await ctx.runMutation(
            internal.sandbox.session_mutations.insertAgentCheckpoint,
            {
              organizationId: args.organizationId,
              sessionId: checkpointKey,
              execId: liveExecId,
              lastSeq: result.lastSeq ?? 0,
              ...(result.agentSessionId !== undefined && {
                agentSessionId: result.agentSessionId,
              }),
              ...(result.agentResultSeen === true && { agentResultSeen: true }),
              ...(result.agentIdle === true && { agentIdle: true }),
              ...(result.pendingTaskIds !== undefined &&
                result.pendingTaskIds.length > 0 && {
                  pendingTaskIds: result.pendingTaskIds,
                }),
              ...(result.apiErrorSeen === true && { apiErrorSeen: true }),
              // Carry the admitted run across the seam (checkpoint is a full
              // replace, so re-pass every handoff) → resume re-uses, never re-admits.
              ...(taskRunId !== null && { taskRunId }),
              startedAt,
              continuationCount: nextCount,
            },
          );
          // Refresh the session lifetime each seam so the platform reaper never
          // expires a mid-run session (mirrors the chat path's per-seam bump).
          await ctx
            .runMutation(
              internal.sandbox.session_mutations.resumeStoppedSession,
              { organizationId: args.organizationId, sessionId },
            )
            .catch((err) =>
              console.warn(
                '[runSandboxAgent] session lifetime refresh failed:',
                err,
              ),
            );
          keepAlive = true;
          return {
            mode: 'agent',
            ok: false,
            status: 'running',
            outputFileIds: [],
            durationMs: Date.now() - startedAt,
          };
        }
        // exhausted → treat the handoff as a terminal timeout below.
      }

      // 8. TERMINAL (completed / failed / cancelled, or an exhausted handoff).
      // Harvest output: store every file under the collect dir to _storage and
      // read the mandated output/summary.md handoff.
      const terminalStatus =
        result.status === 'running' ? 'timeout' : result.status;
      let { outputFileIds, outputFiles, summary, summaryWritten, gradeJson } =
        await harvestSandboxOutput(
          ctx,
          sessionId,
          collectDir,
          result.finalText,
        );

      // FORCE THE HANDOFF: a run that finished clean but skipped summary.md gets
      // ONE corrective re-entry into the SAME Claude session (still alive — the
      // `finally` teardown hasn't fired) before destroy, then a single re-harvest.
      // One-shot (no loop); failure just keeps the synthesized fallback.
      if (
        shouldForceSummaryReentry({
          terminalStatus,
          summaryWritten,
          agentSessionId: result.agentSessionId,
          now: Date.now(),
          hardDeadlineMs,
          byo,
          gatewayToken,
          // A laundered API error (`completed` + isError) must NOT re-enter — it
          // would just re-hit the dead token; it routes to the throw below.
          isError: result.isError,
        })
      ) {
        try {
          await runAgentInSessionImpl(ctx, {
            organizationId: args.organizationId,
            sessionId,
            execId: `${execId}-summary`,
            agentSlug: agentKind,
            prompt: SUMMARY_REENTRY_PROMPT,
            // Resume the just-finished Claude session (a fresh exec, --resume).
            ...(result.agentSessionId !== undefined && {
              agentSessionId: result.agentSessionId,
            }),
            ...(useModel !== undefined && { model: useModel }),
            authMode: byo ? 'byo' : 'managed',
            ...(nativeWebTools !== undefined && { nativeWebTools }),
            interactionMode: 'autonomous',
            captureLiveTimeline: true,
            maxTurns: SUMMARY_REENTRY_MAX_TURNS,
            ...(!byo &&
              gatewayToken !== null && {
                gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
                gatewayToken,
                integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
              }),
            ...(visionTool &&
              visionModel !== undefined && { visionTool: true, visionModel }),
            budgetDeadlineMs: Math.min(
              Date.now() + SUMMARY_REENTRY_WINDOW_MS,
              hardDeadlineMs,
            ),
            timeoutMs: Math.max(0, hardDeadlineMs - Date.now()),
          });
          ({ outputFileIds, outputFiles, summary, summaryWritten, gradeJson } =
            await harvestSandboxOutput(
              ctx,
              sessionId,
              collectDir,
              result.finalText,
            ));
        } catch (reentryErr) {
          console.warn(
            '[runSandboxAgent] summary.md corrective re-entry failed:',
            reentryErr,
          );
        }
      }

      // INFRASTRUCTURE/EXECUTION ERROR (auth/gateway/connection/crash): the agent
      // errored mechanically and left no handoff. THROW so the step's retry runs
      // FRESH (the `finally` tears down → new session + re-minted VK) and, if it
      // keeps failing, the workflow FAILS at this step — instead of returning a
      // synthesized "success" that the next step (or a rework loop) consumes.
      // Keys on the agent's OWN reported status AND `is_error` — NOT the process
      // exit code, which a 401 leaves at `completed`/0, and not the result
      // subtype, which Claude Code leaves at `success` on a laundered API error.
      // Computed AFTER the summary re-entry above so `summaryWritten` is final.
      if (
        isRetryableExecutionError({
          agentResultStatus: result.agentResultStatus,
          terminalStatus,
          summaryWritten,
          isError: result.isError,
        })
      ) {
        throw new SandboxAgentExecutionError(
          `sandbox agent "${args.agentSlug}" run errored (${result.agentResultStatus ?? terminalStatus}): ${(
            result.finalText ?? 'no output'
          ).slice(0, 500)}`,
        );
      }

      // `ok` needn't re-check `isError`: the throw gate above already fired for
      // every `isError && !summaryWritten`, so control reaches here with a live
      // `isError` ONLY when a summary WAS written — a genuine handoff that stays
      // ok. (The laundered-401 fake-success bug lived precisely in `ok` being
      // computed without that guard.)
      const ok =
        terminalStatus === 'completed' &&
        (result.exitCode === 0 || result.exitCode === null);
      // Task-metrics: record the run's cumulative usage and finalize exactly once
      // (idempotent; decrements the concurrency counter, wakes the queue).
      await recordRunUsage(result.usage);
      await finalizeRunMetric(
        ok
          ? 'completed'
          : terminalStatus === 'timeout'
            ? 'timed_out'
            : 'failed',
        ok ? 'output_posted' : 'error',
        ok
          ? undefined
          : terminalStatus === 'timeout'
            ? `agent run exceeded its wall-clock budget (${args.budget.maxWallClockMs}ms)`
            : `agent run ${terminalStatus}`,
      );
      if (preserveSessionAfterStep) {
        await ctx.runMutation(
          internal.sandbox.session_mutations.deleteAgentCheckpoint,
          { sessionId: checkpointKey },
        );
      }
      return {
        mode: 'agent',
        ok,
        status: terminalStatus,
        summary,
        summaryWritten,
        ...(gradeJson !== undefined && { gradeJson }),
        outputFileIds,
        outputFiles,
        ...(result.exitCode !== null && { exitCode: result.exitCode }),
        ...(result.finalText !== undefined && {
          stdoutPreview: result.finalText.slice(0, 2000),
        }),
        durationMs: Date.now() - startedAt,
        ...(!ok && {
          error:
            terminalStatus === 'timeout'
              ? `agent run exceeded its wall-clock budget (${args.budget.maxWallClockMs}ms)`
              : `agent run ${terminalStatus}`,
        }),
      };
    } catch (e) {
      // A RESUME whose session/container is GONE (a hard kill took it down past
      // the runnerd detach-grace): the checkpoint now points at a dead exec.
      // RE-THROW so the step's retry restarts FRESH (the `finally` below tears
      // down + deletes the checkpoint first, so the retry finds none and
      // re-creates) — re-cloning + continuing from the already-pushed branch —
      // instead of giving up with ok:false on a checkpoint it can never resume.
      if (resuming && e instanceof SessionNotFoundError) {
        // Workflow scope skips the finally-teardown, so drop the dead
        // checkpoint HERE — otherwise every retry would re-load it, re-attach
        // the dead exec, and loop until the engine's retry budget exhausts.
        if (preserveSessionAfterStep) {
          try {
            await ctx.runMutation(
              internal.sandbox.session_mutations.deleteAgentCheckpoint,
              { sessionId: checkpointKey },
            );
          } catch (checkpointErr) {
            console.warn(
              '[runSandboxAgent] dead-checkpoint cleanup failed:',
              checkpointErr,
            );
          }
        }
        throw e;
      }
      // An infrastructure/execution error: propagate to the workflow step's
      // retry (re-throw, don't launder into {ok:false} that flows downstream).
      // The re-throw paths deliberately do NOT finalize — the orphaned 'running'
      // row is reclaimed by recoverStuckTaskRuns so the fresh retry re-admits.
      if (e instanceof SandboxAgentExecutionError) {
        throw e;
      }
      // Token-source exhaustion (all cached tokens + the in-sandbox broker
      // re-fetches still 401/429): an operational exception, NOT a business
      // outcome. RE-THROW so the engine's COLD retry restarts FRESH (destroy
      // sandbox, re-resolve the pool) and, if it keeps failing, the execution
      // fails loudly — instead of laundering a dead credential into a quiet
      // `ok:false` that the desk-process would route to a rollback-as-done.
      if (e instanceof TokenSourceError) {
        throw e;
      }
      // Park-on-capacity (NOT a failure): WAIT_FIFO (lost the per-org slot race
      // in reserve) or SpawnerBusyError (global host cap at sessionCreate). Both
      // occur in the FRESH segment AFTER the task-metrics admit, so finalize the
      // admitted run (release its concurrency counter) before returning, or the
      // re-entry would double-admit. The `finally` teardown (keyed by sessionId)
      // is a no-op for WAIT_FIFO (no row inserted) and already covered for the
      // 429 (the inner create-catch marked the reserved row failed). The poll
      // pre-gates the common case, so a WAIT_FIFO race here is rare; sustained
      // GLOBAL saturation can still churn one timed_out run per retry seam.
      if (isWaitFifoError(e) || e instanceof SpawnerBusyError) {
        await finalizeRunMetric(
          'timed_out',
          'error',
          'awaiting sandbox capacity',
        );
        if (e instanceof SpawnerBusyError) {
          // Global host cap: keep our earned FIFO position — flip the claimed
          // ticket back to waiting so the next poll re-admits it in order.
          await ctx.runMutation(
            internal.sandbox.admission.parkAdmissionTicket,
            {
              organizationId: args.organizationId,
              kind: 'session',
              ownerType: 'workflow_run',
              ownerId,
              source: 'workflow',
              wfExecutionId: args.executionId,
              stepSlug: args.stepSlug,
            },
          );
        }
        return {
          mode: 'agent',
          ok: false,
          status: 'awaiting_capacity',
          outputFileIds: [],
          ...(e instanceof SpawnerBusyError &&
            e.retryAfterMs !== undefined && { retryAfterMs: e.retryAfterMs }),
        };
      }
      // Non-retryable terminal failure → finalize the run before returning.
      await finalizeRunMetric(
        'failed',
        'error',
        e instanceof Error ? e.message : String(e),
      );
      // A workflow-scoped step's terminal FAILURE must still drop its own
      // checkpoint (the finally skips teardown): the desk re-executes the same
      // slug on its rework/replan loops, and a surviving row would make that
      // fresh run "resume" a dead exec — or trip the budget-exhausted early
      // exit with the failed attempt's stale continuation state.
      if (preserveSessionAfterStep) {
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.deleteAgentCheckpoint,
            { sessionId: checkpointKey },
          );
        } catch (checkpointErr) {
          console.warn(
            '[runSandboxAgent] failed-step checkpoint cleanup failed:',
            checkpointErr,
          );
        }
      }
      return fail(e instanceof Error ? e.message : String(e));
    } finally {
      // Teardown UNLESS we handed off mid-run (then the session + VK + exec must
      // survive to the next segment) OR this step opts into a workflow-scoped
      // session (teardown happens when the execution completes). Keyed by
      // sessionId so it works on ANY segment — a resumed terminal segment never
      // saw the create/mint.
      if (!keepAlive && !preserveSessionAfterStep) {
        await teardownAgentSession(ctx, args.organizationId, sessionId);
      }
    }
  },
});
