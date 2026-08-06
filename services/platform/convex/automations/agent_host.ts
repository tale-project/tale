'use node';

/**
 * The live lane for `agent` nodes — the automation host's twin of the chat
 * external turn.
 *
 * An agent node runs one harness turn (Claude Code, Codex, …) in a
 * per-run sandbox session. The stepper KICKS the turn and parks the run; a
 * self-chaining drive action re-attaches in short windows (the same
 * ring-buffer protocol the chat lane uses, through the shared
 * `drainHarnessWindow` core); when the harness ends, the settle harvests
 * `/user/output`, revokes the turn's gateway key, writes the result into the
 * run's cursor, and pokes the stepper — which consumes it on its next entry.
 *
 * Everything org-scoped is bound here at construction (the run decides whose
 * session, whose skills, whose credentials — never the document), mirroring
 * `automationLlmCall`.
 */

import { randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import type { SkillViewer } from '../../lib/skills/visibility';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  buildExternalTurnExec,
  classifyHarnessEnd,
  drainHarnessWindow,
  type HarnessTimelinePart,
  connectorsBridgeUrlForSessions,
  isManagedHarness,
  SKILLS_DIR,
} from '../chat/external_turn_shared';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { resolveTurnVisionModel } from '../lib/providers/resolve_vision_model';
import { provisionSessionGatewayKey } from '../node_only/sandbox/gateway_provisioning';
import {
  SessionDuplicateError,
  sessionCancelExec,
  sessionCreate,
  sessionDeleteFiles,
  sessionIsAlive,
  sessionStageFiles,
  type SessionStageFile,
} from '../node_only/sandbox/helpers/session_client';
import { stageUrlForBlobRef } from '../node_only/sandbox/helpers/stage_url';
import {
  getVirtualKeySpendCents,
  resolveGatewayRouting,
  revokeVirtualKey,
} from '../node_only/sandbox/llm_gateway_admin';
import { harvestSessionOutput } from '../node_only/sandbox/session_exec';
import { agentWorkTurnDeadlineMs } from '../sandbox/agent_deadline';
import {
  sessionIdForWorkflowExecution,
  workflowExecutionOwnerId,
} from '../sandbox/session_naming';
import { ASK_HUMAN_TOOL } from '../sandbox/tool_names';
import type { AgentTurnFile, AgentTurnResult } from './checkpoints';
import { resolveServingTarget } from './llm_call';

// The turn's wall-clock deadline is the shared work-turn knob
// (`agentWorkTurnDeadlineMs`) — the exec's own `timeoutMs` is only a sliding
// orphan reaper, so this deadline is the sole absolute cap on the turn.

/** Gateway budget for one agent turn, in cents — the chat turn's default. */
const DEFAULT_AGENT_BUDGET_CENTS = 500;

export function workflowAgentBudgetCents(): number {
  const configured = Number(process.env.TALE_AUTOMATION_AGENT_BUDGET_CENTS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_AGENT_BUDGET_CENTS;
}

/** What one agent node asks for, templates already resolved. */
export interface WorkflowAgentRequest {
  model: string;
  prompt: string;
  system?: string;
  harness?: string;
  skills?: string[];
  connectors?: string[];
  /** Mount name → staging source: a folder id string, or
   * `{folderId|folderPath|content}`. */
  files?: Record<string, unknown>;
}

/** What the stepper parks in the cursor after a kick. */
export interface WorkflowAgentKick {
  execId: string;
  sessionId: string;
  deadlineAt: number;
  providerSlug: string;
  gatewayModel: string;
  harness: string;
}

/**
 * The per-run agent door the stepper carries — a seam like the llm door's, so
 * the stepper suite substitutes a recording host without a sandbox.
 */
export interface AutomationAgentHost {
  /** Resolve the model, then schedule the turn start. Throws a clean,
   * author-facing error when the model or harness cannot serve. */
  kick(args: {
    runId: string;
    nodeId: string;
    request: WorkflowAgentRequest;
  }): Promise<WorkflowAgentKick>;
  /** The settled result, or `null` while the turn still runs. Reads fresh —
   * the settle may land after the stepper's turn loaded its checkpoints. */
  poll(args: {
    runId: string;
    execId: string;
  }): Promise<AgentTurnResult | null>;
  /** Cut a turn (deadline, cancellation): reap the exec and revoke its key. */
  cancel(args: { sessionId: string; execId: string }): Promise<void>;
}

const DEFAULT_HARNESS = 'claude-code';

/** An `automationHumanAsks` row as the host consumes it — the internal reads
 * return it untyped (`v.any()`), so every consumer narrows through here. */
interface AskRow {
  _id: Id<'automationHumanAsks'>;
  runId: string;
  nodeId: string;
  execId: string;
  question: string;
  expiresAt: number;
  status: string;
  agentSessionId?: string;
  answer?: string;
}

function readAskRow(value: unknown): AskRow | null {
  if (value === null || typeof value !== 'object') return null;
  const record: Record<string, unknown> = { ...value };
  if (
    typeof record._id !== 'string' ||
    typeof record.runId !== 'string' ||
    typeof record.nodeId !== 'string' ||
    typeof record.execId !== 'string' ||
    typeof record.question !== 'string' ||
    typeof record.expiresAt !== 'number' ||
    typeof record.status !== 'string'
  ) {
    return null;
  }
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the row came from the automationHumanAsks table read
    _id: record._id as Id<'automationHumanAsks'>,
    runId: record.runId,
    nodeId: record.nodeId,
    execId: record.execId,
    question: record.question,
    expiresAt: record.expiresAt,
    status: record.status,
    ...(typeof record.agentSessionId === 'string'
      ? { agentSessionId: record.agentSessionId }
      : {}),
    ...(typeof record.answer === 'string' ? { answer: record.answer } : {}),
  };
}

/** The extra margin the parked cursor's deadline gets past the ask's expiry,
 * so the poll-side expiry settle always wins over the stepper's generic
 * time-limit cut (whose message would blame the agent, not the silence). */
const ASK_DEADLINE_MARGIN_MS = 60 * 60 * 1000;

/** Best-effort close of a turn's pending ask on the cancel paths — an
 * unanswerable card must not keep soliciting an answer. */
async function closePendingAskForExec(
  ctx: ActionCtx,
  sessionId: string,
  execId: string,
): Promise<void> {
  const ask = readAskRow(
    await ctx.runQuery(internal.automations.human_asks.getPendingAskForExec, {
      sessionId,
      execId,
    }),
  );
  if (ask === null) return;
  await ctx
    .runMutation(internal.automations.human_asks.closeAsk, {
      askId: ask._id,
      status: 'cancelled',
    })
    .catch((err) => console.warn('[agent-host] ask close failed:', err));
}

/** The instructions line that makes the tool discoverable — the shim only
 * advertises generic `workspace_tool`, so the turn is told the name. */
const ASK_HUMAN_GUIDANCE =
  "When you hit a decision or fact ONLY the run's human operator can " +
  `provide, call the "${ASK_HUMAN_TOOL}" workspace tool (via workspace_tool) ` +
  'with one complete, self-contained question (you may bundle several), ' +
  'then say you are waiting and END YOUR TURN. You will be resumed with the ' +
  'answer as your next message. Never guess, never invent placeholder ' +
  'values for such facts, and never ask about things you can determine ' +
  'yourself from the staged files.';

/** The real agent door for one run's organization. */
export function automationAgentHost(
  ctx: ActionCtx,
  organizationId: string,
): AutomationAgentHost {
  return {
    kick: async ({ runId, nodeId, request }) => {
      const harness = request.harness ?? DEFAULT_HARNESS;
      if (!isManagedHarness(harness)) {
        throw new Error(
          `the harness "${harness}" cannot run a managed automation turn — pick a managed-capable harness (e.g. "claude-code" or "codex")`,
        );
      }
      const target = await resolveServingTarget(
        ctx,
        organizationId,
        request.model,
      );
      const routing = resolveGatewayRouting(
        target.providerSlug,
        target.modelId,
      );
      // A text-only serving model still meets image inputs (scanned PDFs,
      // screenshots) — arm the harness vision polyfill with the org's vision
      // model so those route through the gateway instead of 404ing the turn.
      const vision = await resolveTurnVisionModel(ctx, organizationId, target);
      const execId = randomUUID();
      const sessionId = sessionIdForWorkflowExecution(runId);
      const deadlineAt = Date.now() + agentWorkTurnDeadlineMs();
      // The op row exists BEFORE the start action is scheduled (the chat
      // lane's invariant): from this point, every death of the scheduled
      // start leaves a stale-heartbeat op the agent-turn watchdog settles,
      // instead of a turn no sweep can see or claim. The start's own upsert
      // later merges the minted key onto this row.
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId,
          sessionId,
          execId,
          kind: 'workflow-agent',
          status: 'running',
          modelRef: `${target.providerSlug}/${routing.gatewayModel}`,
          deadlineMs: deadlineAt,
          heartbeatAt: Date.now(),
        },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.automations.agent_host.startWorkflowAgentTurn,
        {
          organizationId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper hands the durable run id through as a string
          runId: runId as never,
          nodeId,
          execId,
          sessionId,
          harness,
          providerSlug: target.providerSlug,
          modelId: target.modelId,
          gatewayModel: routing.gatewayModel,
          ...(vision !== null
            ? {
                visionProviderSlug: vision.providerSlug,
                visionModelId: vision.modelId,
              }
            : {}),
          deadlineAt,
          request: {
            model: request.model,
            prompt: request.prompt,
            ...(request.system !== undefined ? { system: request.system } : {}),
            ...(request.skills !== undefined ? { skills: request.skills } : {}),
            ...(request.connectors !== undefined
              ? { connectors: request.connectors }
              : {}),
            ...(request.files !== undefined ? { files: request.files } : {}),
          },
        },
      );
      return {
        execId,
        sessionId,
        deadlineAt,
        providerSlug: target.providerSlug,
        gatewayModel: routing.gatewayModel,
        harness,
      };
    },
    poll: async ({ runId, execId }) => {
      const state = await ctx.runQuery(
        internal.automations.queries.readAgentCursor,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper only holds ids it was invoked with
        { organizationId, runId: runId as never },
      );
      const agent = state?.cursor?.agent;
      if (agent === undefined || agent.execId !== execId) return null;
      if (agent.result !== undefined) return agent.result;
      // A turn parked on an ask waits for a person, not for the sandbox — but
      // not forever. Past the ask's own expiry, the turn settles as errored
      // and the manifest decides what an unanswered question means.
      const ask = readAskRow(
        await ctx.runQuery(
          internal.automations.human_asks.getPendingAskForExec,
          { sessionId: agent.sessionId, execId },
        ),
      );
      if (ask !== null && Date.now() > ask.expiresAt) {
        await ctx.runMutation(internal.automations.human_asks.closeAsk, {
          askId: ask._id,
          status: 'expired',
        });
        await ctx.runMutation(
          internal.automations.mutations.recordAgentTurnSettled,
          {
            organizationId,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper only holds ids it was invoked with
            runId: runId as never,
            nodeId: ask.nodeId,
            execId,
            result: {
              errored: true,
              reason:
                'the agent asked the operator a question and nobody answered within 7 days',
              text: '',
              files: [],
            },
          },
        );
      }
      return null;
    },
    cancel: async ({ sessionId, execId }) => {
      await sessionCancelExec(sessionId, execId).catch((err) =>
        console.warn('[agent-host] exec cancel failed:', err),
      );
      await closePendingAskForExec(ctx, sessionId, execId);
      await releaseTurnKey(ctx, {
        organizationId,
        sessionId,
        execId,
        status: 'cancelled',
      });
    },
  };
}

/**
 * Claim the finalize, record + revoke the turn's gateway key spend, and stamp
 * the op row terminal. Safe to race — `claimSessionOpFinalize` elects one
 * winner and a loser does nothing.
 */
export async function releaseTurnKey(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    status: 'completed' | 'failed' | 'cancelled';
    exitCode?: number;
    agentResultStatus?: string;
  },
): Promise<{ won: boolean; spentCents?: number }> {
  const { sessionId, execId } = args;
  const won = await ctx.runMutation(
    internal.sandbox.session_mutations.claimSessionOpFinalize,
    { sessionId, execId },
  );
  if (!won) return { won: false };
  const op = await ctx.runQuery(
    internal.sandbox.session_queries.getExternalTurnOpForFinalize,
    { sessionId, execId },
  );
  let spentCents: number | undefined;
  const mintedKeyId = op?.mintedKeyId;
  if (mintedKeyId !== undefined) {
    const spent = await getVirtualKeySpendCents(mintedKeyId);
    if (spent !== null) {
      spentCents = spent;
      await ctx.runMutation(
        internal.sandbox.session_mutations.recordSessionOpSpend,
        { sessionId, execId, spentCents: spent },
      );
    }
    await revokeVirtualKey(mintedKeyId).catch((err) =>
      console.warn(`[agent-host] revoke VK ${mintedKeyId} failed:`, err),
    );
    await ctx.runMutation(
      internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
      { sessionId, llmGatewayKeyId: mintedKeyId },
    );
  }
  await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
    organizationId: args.organizationId,
    sessionId,
    execId,
    kind: 'workflow-agent',
    status: args.status,
    ...(args.exitCode !== undefined ? { exitCode: args.exitCode } : {}),
    ...(args.agentResultStatus !== undefined
      ? { agentResultStatus: args.agentResultStatus }
      : {}),
  });
  return { won: true, ...(spentCents !== undefined ? { spentCents } : {}) };
}

/**
 * Ensure the run's workflow sandbox session exists (AGENT profile). One
 * session per run, shared by every agent/script node of that run; torn down
 * with the run. Mirrors the chat lane's orphan-adoption self-heal. Exported
 * for the script host, which runs in the same session.
 */
export async function ensureWorkflowSession(
  ctx: ActionCtx,
  organizationId: string,
  runId: string,
): Promise<string> {
  const sessionId = sessionIdForWorkflowExecution(runId);
  const ownerId = workflowExecutionOwnerId(runId);
  const existing = await ctx.runQuery(
    internal.sandbox.session_queries.getActiveSessionByOwner,
    { ownerType: 'workflow_run', ownerId },
  );
  if (existing !== null) {
    if (await sessionIsAlive(sessionId)) {
      // A hibernated row over a still-warm container (a review pause, or the
      // run-terminal release racing a late node): re-admit through the cap
      // check, or the turn runs on a slot no budget counts.
      if (existing.status === 'stopped') {
        await ctx.runMutation(
          internal.sandbox.session_mutations.resumeSessionSlotWithCapCheck,
          { organizationId, sessionId },
        );
      }
      return sessionId;
    }
    // Re-admit BEFORE recreating the container: if the org is full this
    // throws with nothing to clean up, instead of leaving a fresh container
    // whose row still reads `stopped`.
    await ctx.runMutation(
      internal.sandbox.session_mutations.resumeSessionSlotWithCapCheck,
      { organizationId, sessionId },
    );
    try {
      await sessionCreate({ sessionId, organizationId, profile: 'agent' });
    } catch (err) {
      if (!(err instanceof SessionDuplicateError)) {
        // Give the just-taken slot back — a dead create must not hold the
        // org's workflow budget until the reconcile cron notices.
        await ctx
          .runMutation(
            internal.sandbox.session_mutations.hibernateAutomationScopedSession,
            { executionId: runId },
          )
          .catch((releaseErr) =>
            console.warn(
              '[agent-host] slot release after failed resume-create failed:',
              releaseErr,
            ),
          );
        throw err;
      }
      console.warn(
        `[agent-host] adopting orphan sandbox container for ${sessionId}`,
      );
    }
    return sessionId;
  }
  const rowId = await ctx.runMutation(
    internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
    {
      organizationId,
      sessionId,
      profile: 'agent',
      ownerType: 'workflow_run',
      ownerId,
      createdBy: 'system:automation',
    },
  );
  try {
    await sessionCreate({ sessionId, organizationId, profile: 'agent' });
  } catch (err) {
    if (err instanceof SessionDuplicateError) {
      console.warn(
        `[agent-host] adopting orphan sandbox container for ${sessionId} (no platform row)`,
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        {
          rowId,
          status: 'active',
        },
      );
      return sessionId;
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'failed',
    });
    throw err;
  }
  await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
    rowId,
    status: 'active',
  });
  return sessionId;
}

/**
 * The skill-viewer scope of one automation run: a project-pinned run reads
 * as its project (org skills plus team skills of the project's teams), an
 * org-level run — or one whose project is gone — as the org (org skills
 * only). Never a member's own scope: a deployed automation runs on behalf of
 * whoever triggers it, so a narrower-than-org skill must be shared with the
 * run's project to be reachable.
 */
export async function resolveRunSkillViewer(
  ctx: ActionCtx,
  organizationId: string,
  runId: Id<'automationRuns'> | string,
): Promise<SkillViewer> {
  const projectId = await ctx.runQuery(
    internal.automations.queries.getRunProjectId,
    {
      organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper hands the durable run id through as a string
      runId: runId as Id<'automationRuns'>,
    },
  );
  if (projectId === null) return { kind: 'org' };
  const scope = await ctx.runQuery(
    internal.projects.internal_queries.getProjectSkillScope,
    { projectId },
  );
  if (scope === null) return { kind: 'org' };
  return { kind: 'project', teamIds: scope.teamIds };
}

/**
 * Stage one skill's WHOLE bundle at `destDir` (a `/user`-relative path),
 * read as `viewer` — the run's own scope, resolved by
 * {@link resolveRunSkillViewer} or the task host. A missing skill and one the
 * scope may not equip fail the same way, by name — a run against a skill
 * that is not reachable must not quietly proceed without it.
 */
export async function stageSkillBundle(
  ctx: ActionCtx,
  organizationId: string,
  sessionId: string,
  slug: string,
  destDir: string,
  viewer: SkillViewer,
): Promise<number> {
  const orgSlug = await orgSlugFromId(ctx, organizationId);
  const bundle = await ctx.runAction(
    internal.skills.file_actions.readSkillBundle,
    { orgSlug, slug, viewer },
  );
  if (bundle === null || bundle.files.length === 0) {
    throw new Error(
      `the skill "${slug}" is not available to this run — it does not exist or is not shared with the run's scope`,
    );
  }
  const files = bundle.files.map((file) => ({
    path: `${destDir}/${file.path}`,
    contentBase64: file.contentBase64,
  }));
  const result = await sessionStageFiles(sessionId, files);
  if (result.skipped.length > 0) {
    throw new Error(
      `staging skill "${slug}" failed: ${result.skipped.map((s) => s.path).join(', ')}`,
    );
  }
  return files.length;
}

/** Stage the node's declared skills under the session skills dir and return
 * the instructions addendum describing them (empty when none). */
export async function stageWorkflowSkills(
  ctx: ActionCtx,
  organizationId: string,
  sessionId: string,
  skillSlugs: readonly string[],
  viewer: SkillViewer,
): Promise<string> {
  if (skillSlugs.length === 0) return '';
  for (const slug of skillSlugs) {
    await stageSkillBundle(
      ctx,
      organizationId,
      sessionId,
      slug,
      `${SKILLS_DIR}/${slug}`,
      viewer,
    );
  }
  return [
    'Skills equipped for this task (read a skill before using it):',
    ...skillSlugs.map((slug) => `- /user/${SKILLS_DIR}/${slug}/SKILL.md`),
  ].join('\n');
}

/** A staging source an agent/script node's `files` map may name. */
type StagingSource =
  | { folderId: string }
  | { folderPath: string }
  | { content: string };

function parseStagingSource(value: unknown): StagingSource | null {
  if (typeof value === 'string' && value !== '') return { folderId: value };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = { ...value };
  if (typeof record.folderId === 'string') return { folderId: record.folderId };
  if (typeof record.folderPath === 'string') {
    return { folderPath: record.folderPath };
  }
  if (typeof record.content === 'string') return { content: record.content };
  return null;
}

/** Path-safe mount name under the workspace: strip a legacy `workspace/`
 * prefix, refuse separators-out and dot-tricks. */
function mountNameOf(raw: string): string {
  const name = raw.replace(/^workspace\//, '').replace(/\/+$/, '');
  if (
    name === '' ||
    name.startsWith('/') ||
    name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(
      `the files mount name ${JSON.stringify(raw)} is not a valid workspace path`,
    );
  }
  return name;
}

/**
 * Stage the node's `files` map into the session workspace: each mount becomes
 * `/user/<prefix><name>/…` holding the referenced folder's documents (or the
 * inline content). A folder reference that does not resolve fails the turn —
 * a run against the wrong folder must not quietly proceed with nothing.
 */
export async function stageWorkflowFiles(
  ctx: ActionCtx,
  organizationId: string,
  sessionId: string,
  files: Record<string, unknown> | undefined,
  pathPrefix: string,
): Promise<string[]> {
  if (files === undefined) return [];
  const toStage: SessionStageFile[] = [];
  const mounts: string[] = [];
  for (const [rawName, rawSource] of Object.entries(files)) {
    const name = mountNameOf(rawName);
    const source = parseStagingSource(rawSource);
    if (source === null) {
      throw new Error(
        `the files entry ${JSON.stringify(rawName)} names no usable source — use a folder id string, {folderPath}, or {content}`,
      );
    }
    // The run's session is shared across its nodes — clear the mount first so
    // a file from an earlier staging of the same mount cannot linger into
    // this node's view of its inputs. Best-effort: a fresh session has
    // nothing to clear.
    await sessionDeleteFiles(sessionId, [`${pathPrefix}${name}`]).catch((err) =>
      console.debug(
        `[agent-host] mount pre-clear skipped for ${pathPrefix}${name}:`,
        err instanceof Error ? err.message : err,
      ),
    );
    if ('content' in source) {
      toStage.push({
        path: `${pathPrefix}${name}`,
        contentBase64: Buffer.from(source.content, 'utf8').toString('base64'),
      });
      mounts.push(name);
      continue;
    }
    const rows = await ctx.runQuery(
      internal.documents.internal_queries.listFilesByFolderInternal,
      {
        organizationId,
        ...('folderId' in source
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reference is data from the run's own scope; a wrong id resolves to null below
            { folderId: source.folderId as never }
          : { folderPath: source.folderPath }),
      },
    );
    if (rows === null) {
      throw new Error(
        `the folder referenced by files.${name} does not exist (${JSON.stringify(source)})`,
      );
    }
    for (const file of rows) {
      // Blob-aware: a BYO-bucket org's documents carry `s3:` refs, which stage
      // via the token-gated stream route instead of a `_storage` URL.
      const url = await stageUrlForBlobRef(
        ctx,
        String(file.fileId),
        organizationId,
      );
      if (url === null) continue; // blob purged under a live row — skip, don't fail
      toStage.push({ path: `${pathPrefix}${name}/${file.name}`, url });
    }
    mounts.push(name);
  }
  if (toStage.length > 0) {
    const staged = await sessionStageFiles(sessionId, toStage);
    if (staged.skipped.length > 0) {
      throw new Error(
        `staging input files failed: ${staged.skipped.map((s) => s.path).join(', ')}`,
      );
    }
  }
  return mounts;
}

const requestValidator = v.object({
  model: v.string(),
  prompt: v.string(),
  system: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
  connectors: v.optional(v.array(v.string())),
  files: v.optional(v.any()),
});

/**
 * The scheduled turn start — everything slow: session ensure, staging, key
 * mint, exec build, first window. Any throw settles the node with the error
 * instead of stranding the parked run.
 */
export const startWorkflowAgentTurn = internalAction({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
    nodeId: v.string(),
    execId: v.string(),
    sessionId: v.string(),
    harness: v.string(),
    providerSlug: v.string(),
    modelId: v.string(),
    gatewayModel: v.string(),
    /** Vision-polyfill model (absent when the serving model reads images
     * itself) — provisioned onto the turn key and armed on the exec. */
    visionProviderSlug: v.optional(v.string()),
    visionModelId: v.optional(v.string()),
    deadlineAt: v.number(),
    request: requestValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ensureWorkflowSession(ctx, args.organizationId, args.runId);

      const skillViewer = await resolveRunSkillViewer(
        ctx,
        args.organizationId,
        args.runId,
      );
      const skillsAddendum = await stageWorkflowSkills(
        ctx,
        args.organizationId,
        args.sessionId,
        args.request.skills ?? [],
        skillViewer,
      );
      const mounts = await stageWorkflowFiles(
        ctx,
        args.organizationId,
        args.sessionId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated loosely above; parseStagingSource re-guards every entry
        args.request.files as Record<string, unknown> | undefined,
        'workspace/',
      );

      const budgetCents = workflowAgentBudgetCents();
      const visionRef =
        args.visionProviderSlug !== undefined &&
        args.visionModelId !== undefined
          ? {
              providerSlug: args.visionProviderSlug,
              modelId: args.visionModelId,
            }
          : null;
      // Resolved once: the harness needs it to route image reads, and the op
      // row records it so the run's viewers can see which model did the
      // reading after the fact.
      const visionModelRef =
        visionRef !== null
          ? resolveGatewayRouting(visionRef.providerSlug, visionRef.modelId)
              .gatewayModel
          : undefined;
      const key = await provisionSessionGatewayKey(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        allowedModels: [
          { providerSlug: args.providerSlug, modelId: args.modelId },
          ...(visionRef !== null ? [visionRef] : []),
        ],
        budgetCents,
      });
      await ctx.runMutation(
        internal.sandbox.session_mutations.insertSessionToken,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          tokenHash: key.keyHash,
          llmGatewayKeyId: key.keyId,
          scope: {
            agentKind: args.harness,
            allowedModels: [args.gatewayModel],
            connectorGrants: [...(args.request.connectors ?? [])],
            budgetCents,
            // The one workspace tool an automation turn holds: ask the run's
            // operator. The org-data READ tools stay chat-lane only — a run
            // has no turn user to scope them to.
            toolGrants: [ASK_HUMAN_TOOL],
          },
          expiresAt: args.deadlineAt,
        },
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          execId: args.execId,
          kind: 'workflow-agent',
          status: 'running',
          modelRef: `${args.providerSlug}/${args.gatewayModel}`,
          deadlineMs: args.deadlineAt,
          heartbeatAt: Date.now(),
          mintedKeyId: key.keyId,
        },
      );

      const instructions = [
        ...(args.request.system !== undefined && args.request.system !== ''
          ? [args.request.system]
          : []),
        ...(skillsAddendum !== '' ? [skillsAddendum] : []),
        ...(mounts.length > 0
          ? [
              [
                'Input files staged for this task:',
                ...mounts.map((name) => `- /user/workspace/${name}/`),
              ].join('\n'),
            ]
          : []),
        ASK_HUMAN_GUIDANCE,
        "Write every file you produce to /user/output/ — files there are collected when your turn ends and become this step's output.",
      ].join('\n\n');

      const exec = buildExternalTurnExec({
        harness: args.harness,
        gatewayModel: args.gatewayModel,
        serving: { kind: 'gateway', token: key.token },
        instructions,
        prompt: args.request.prompt,
        execId: args.execId,
        // Always mounted: `ask_human` rides the bridge, so every automation
        // turn gets the shim even when the node declares no connectors.
        bridgeUrl: connectorsBridgeUrlForSessions(),
        ...(visionModelRef !== undefined
          ? { vision: { model: visionModelRef } }
          : {}),
      });

      const progress = liveProgressSink(
        ctx,
        args,
        'workflow-agent',
        visionModelRef,
      );
      const window = await drainHarnessWindow({
        sessionId: args.sessionId,
        execId: args.execId,
        harness: args.harness,
        start: exec,
        onText: progress.onText,
        onTimeline: progress.onTimeline,
      });
      await progress.flush();
      await continueOrSettle(ctx, args, window);
    } catch (err) {
      console.error('[agent-host] turn start failed:', err);
      await settleWorkflowAgentTurn(ctx, args, {
        errored: true,
        reason: `the agent turn could not start: ${err instanceof Error ? err.message : String(err)}`,
        text: '',
        files: [],
      });
    }
    return null;
  },
});

/** The self-chaining drainer: one attach window per invocation. */
export const driveWorkflowAgentTurn = internalAction({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
    nodeId: v.string(),
    execId: v.string(),
    sessionId: v.string(),
    harness: v.string(),
    providerSlug: v.string(),
    gatewayModel: v.string(),
    deadlineAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Orphan check: the run may have been cancelled, failed by the stepper's
    // deadline, or moved past this node. An orphan turn is cut, its key
    // revoked, and nothing else touched.
    const state = await ctx.runQuery(
      internal.automations.queries.readAgentCursor,
      { organizationId: args.organizationId, runId: args.runId },
    );
    const agent = state?.cursor?.agent;
    const live =
      state !== null &&
      (state.status === 'waiting' ||
        state.status === 'running' ||
        state.status === 'queued') &&
      state.cursor?.node === args.nodeId &&
      agent?.execId === args.execId &&
      agent.result === undefined;
    if (!live) {
      await sessionCancelExec(args.sessionId, args.execId).catch(() => {
        // Already gone — the reap is best-effort.
        console.warn('[agent-host] orphan exec reap failed (already gone?)');
      });
      await closePendingAskForExec(ctx, args.sessionId, args.execId);
      await releaseTurnKey(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        status: 'cancelled',
      });
      // The run went terminal while this turn was live, so the terminal
      // hooks' hibernate skipped past it — the op is terminal now.
      await ctx
        .runMutation(
          internal.sandbox.session_mutations.hibernateAutomationScopedSession,
          { executionId: args.runId },
        )
        .catch((err) =>
          console.warn('[agent-host] orphan slot release failed:', err),
        );
      return null;
    }

    if (Date.now() > args.deadlineAt) {
      await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
        console.warn('[agent-host] deadline exec cancel failed:', err),
      );
      await settleWorkflowAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent turn ran past its time limit and was stopped',
        text: '',
        files: [],
      });
      return null;
    }

    const progress = liveProgressSink(ctx, args, 'workflow-agent');
    let window;
    try {
      window = await drainHarnessWindow({
        sessionId: args.sessionId,
        execId: args.execId,
        harness: args.harness,
        onText: progress.onText,
        onTimeline: progress.onTimeline,
      });
    } catch (err) {
      console.error('[agent-host] drive window threw:', err);
      await progress.flush();
      await settleWorkflowAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent turn stopped unexpectedly',
        text: '',
        files: [],
      });
      return null;
    }
    await progress.flush();
    await continueOrSettle(ctx, args, window);
    return null;
  },
});

/**
 * A member answered a parked ask: resume the SAME harness conversation on a
 * fresh exec whose first message is the answer. Everything upstream of the
 * node keeps its checkpoints; the session keeps its files; the conversation
 * keeps its context (`--resume`). Guarded end-to-end — a stale answer (run
 * moved on, cancelled, superseded) retargets nothing and starts nothing.
 */
export const resumeWorkflowAgentTurnWithAnswer = internalAction({
  args: {
    organizationId: v.string(),
    askId: v.id('automationHumanAsks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ask = readAskRow(
      await ctx.runQuery(internal.automations.human_asks.getAskForResume, {
        askId: args.askId,
        organizationId: args.organizationId,
      }),
    );
    if (ask === null || ask.status !== 'answered' || ask.answer === undefined) {
      console.warn('[agent-host] answered-ask resume: ask not resumable');
      return null;
    }
    const askRunId = ask.runId;
    const state = await ctx.runQuery(
      internal.automations.queries.readAgentCursor,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ask row carries the durable run id
      { organizationId: args.organizationId, runId: askRunId as never },
    );
    const agent = state?.cursor?.agent;
    const live =
      state !== null &&
      (state.status === 'waiting' ||
        state.status === 'running' ||
        state.status === 'queued') &&
      state.cursor?.node === ask.nodeId &&
      agent?.execId === ask.execId &&
      agent.result === undefined;
    if (!live || agent === undefined) {
      console.warn(
        '[agent-host] answered-ask resume: the run moved on — answer recorded, nothing to resume',
      );
      return null;
    }

    const request = readWorkflowAgentRequest(agent.input);
    const sessionId = agent.sessionId;
    const execId = randomUUID();
    const deadlineAt = Date.now() + agentWorkTurnDeadlineMs();
    // Serving is re-resolved, not replayed from the cursor: the wait can span
    // days and the org's provider config may have moved — the key, the token
    // scope, and the exec must name the SAME model either way.
    const keys: TurnKeys = {
      organizationId: args.organizationId,
      runId: askRunId,
      nodeId: ask.nodeId,
      execId,
      sessionId,
      harness: agent.harness,
      providerSlug: agent.providerSlug,
      gatewayModel: agent.gatewayModel,
      deadlineAt,
    };
    try {
      // The wait may have outlived the container (idle reaper stops and
      // preserves) — the session volume holds the workspace AND the harness's
      // own conversation state, so an adopt-or-recreate brings both back.
      await ensureWorkflowSession(ctx, args.organizationId, askRunId);

      const target = await resolveServingTarget(
        ctx,
        args.organizationId,
        request.model,
      );
      const routing = resolveGatewayRouting(
        target.providerSlug,
        target.modelId,
      );
      keys.providerSlug = target.providerSlug;
      keys.gatewayModel = routing.gatewayModel;
      const vision = await resolveTurnVisionModel(
        ctx,
        args.organizationId,
        target,
      );
      // Resolved once, for the harness and for the op row's record of which
      // model read this turn's images.
      const visionModelRef =
        vision !== null
          ? resolveGatewayRouting(vision.providerSlug, vision.modelId)
              .gatewayModel
          : undefined;
      const budgetCents = workflowAgentBudgetCents();
      const key = await provisionSessionGatewayKey(ctx, {
        organizationId: args.organizationId,
        sessionId,
        allowedModels: [
          { providerSlug: target.providerSlug, modelId: target.modelId },
          ...(vision !== null
            ? [{ providerSlug: vision.providerSlug, modelId: vision.modelId }]
            : []),
        ],
        budgetCents,
      });
      await ctx.runMutation(
        internal.sandbox.session_mutations.insertSessionToken,
        {
          organizationId: args.organizationId,
          sessionId,
          tokenHash: key.keyHash,
          llmGatewayKeyId: key.keyId,
          scope: {
            agentKind: agent.harness,
            allowedModels: [routing.gatewayModel],
            connectorGrants: [...(request.connectors ?? [])],
            budgetCents,
            toolGrants: [ASK_HUMAN_TOOL],
          },
          expiresAt: deadlineAt,
        },
      );
      // Cursor first, op row second, exec last — the same
      // row-exists-before-the-slow-part ordering as the kick, so a death
      // between any two steps leaves a state the watchdog/poll can settle.
      const retarget = await ctx.runMutation(
        internal.automations.human_asks.retargetAgentCursor,
        {
          organizationId: args.organizationId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ask row carries the durable run id
          runId: askRunId as never,
          nodeId: ask.nodeId,
          fromExecId: ask.execId,
          toExecId: execId,
          deadlineAt,
        },
      );
      if (!retarget.retargeted) {
        console.warn(
          '[agent-host] answered-ask resume: cursor retarget lost the race — leaving the run as-is',
        );
        return null;
      }
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId: args.organizationId,
          sessionId,
          execId,
          kind: 'workflow-agent',
          status: 'running',
          modelRef: `${keys.providerSlug}/${keys.gatewayModel}`,
          deadlineMs: deadlineAt,
          heartbeatAt: Date.now(),
          mintedKeyId: key.keyId,
        },
      );

      const instructions = [
        ...(request.system !== undefined && request.system !== ''
          ? [request.system]
          : []),
        ASK_HUMAN_GUIDANCE,
        "Write every file you produce to /user/output/ — files there are collected when your turn ends and become this step's output.",
      ].join('\n\n');
      const prompt = [
        'The operator answered your question:',
        '',
        ask.answer,
        '',
        'Continue the task from where you left off, applying this answer. Ask again only if a genuinely NEW operator-only decision comes up.',
      ].join('\n');
      const exec = buildExternalTurnExec({
        harness: agent.harness,
        gatewayModel: keys.gatewayModel,
        serving: { kind: 'gateway', token: key.token },
        instructions,
        prompt,
        execId,
        bridgeUrl: connectorsBridgeUrlForSessions(),
        ...(ask.agentSessionId !== undefined
          ? { resume: ask.agentSessionId }
          : {}),
        ...(visionModelRef !== undefined
          ? { vision: { model: visionModelRef } }
          : {}),
      });
      if (ask.agentSessionId === undefined) {
        // The asking turn ended without a resume handle (a harness that never
        // reported one). The answer still reaches the agent — as a fresh
        // conversation over the same workspace — so warn rather than fail.
        console.warn(
          '[agent-host] answered-ask resume without a harness session handle — starting fresh over the preserved workspace',
        );
      }

      const progress = liveProgressSink(
        ctx,
        keys,
        'workflow-agent',
        visionModelRef,
      );
      const window = await drainHarnessWindow({
        sessionId,
        execId,
        harness: agent.harness,
        start: exec,
        onText: progress.onText,
        onTimeline: progress.onTimeline,
      });
      await progress.flush();
      await continueOrSettle(ctx, keys, window);
    } catch (err) {
      console.error('[agent-host] answered-ask resume failed:', err);
      await settleWorkflowAgentTurn(ctx, keys, {
        errored: true,
        reason: `the agent turn could not resume after the answer: ${err instanceof Error ? err.message : String(err)}`,
        text: '',
        files: [],
      });
    }
    return null;
  },
});

/** Narrow the cursor's recorded request (stored as plain JSON) back to the
 * fields the resume needs. Absent fields degrade, never throw — the resume
 * must work for any request the kick accepted. */
function readWorkflowAgentRequest(input: Record<string, unknown>): {
  model: string;
  system?: string;
  connectors?: string[];
} {
  return {
    model: typeof input.model === 'string' ? input.model : '',
    ...(typeof input.system === 'string' ? { system: input.system } : {}),
    ...(Array.isArray(input.connectors) &&
    input.connectors.every((slug) => typeof slug === 'string')
      ? { connectors: input.connectors }
      : {}),
  };
}

interface TurnKeys {
  organizationId: string;
  runId: string;
  nodeId: string;
  execId: string;
  sessionId: string;
  harness: string;
  providerSlug: string;
  gatewayModel: string;
  deadlineAt: number;
}

/**
 * Stream the turn's live text + tool transcript onto the session op row, so
 * the run's viewers can watch what the agent is doing INSIDE the sandbox
 * while it works. The chat lane renders that from its persisted message; a
 * run has no message, so the op row carries a bounded tail
 * (`sandboxSessionOps.progressText` / `liveTimeline`) that
 * `getAgentNodeSandboxOp` reads back. Best-effort: a failed progress write
 * never disturbs the turn.
 */
/** Shared by the workflow AND task agent lanes (`kind` picks the op lane) —
 * the ONE writer of an agent turn's live transcript. */
export function liveProgressSink(
  ctx: ActionCtx,
  args: Pick<TurnKeys, 'organizationId' | 'sessionId' | 'execId'>,
  kind: 'workflow-agent' | 'task-agent',
  /** The gateway model armed as this turn's vision polyfill, if any. Recorded
   * on every write (it is constant for the turn) so the run's viewers can see
   * WHICH model read their images — resolution happens per turn against a live
   * catalog, so asking again later can answer differently than what ran. */
  visionModelRef?: string,
): {
  onText: (text: string) => void;
  onTimeline: (parts: HarnessTimelinePart[]) => void;
  /** Await the writes queued so far — the settle path calls this before its
   * own op writes, so a late live flush cannot land after (and shrink) the
   * final transcript snapshot. */
  flush: () => Promise<void>;
} {
  // Serialized like the chat lane's stream chain: each write carries the full
  // state-so-far, so in-order landing is what keeps the tail monotonic.
  let chain: Promise<void> = Promise.resolve();
  const write = (patch: {
    progressText?: string;
    liveTimeline?: HarnessTimelinePart[];
  }) => {
    chain = chain.then(() =>
      ctx
        .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          execId: args.execId,
          kind,
          status: 'running',
          lastEventAt: Date.now(),
          ...(visionModelRef !== undefined && { visionModelRef }),
          ...patch,
        })
        .then(() => undefined)
        .catch((err) =>
          console.warn('[agent-host] live progress write failed:', err),
        ),
    );
  };
  return {
    onText: (text) => write({ progressText: text }),
    onTimeline: (liveTimeline) => write({ liveTimeline }),
    flush: () => chain,
  };
}

async function continueOrSettle(
  ctx: ActionCtx,
  args: TurnKeys,
  window: Awaited<ReturnType<typeof drainHarnessWindow>>,
): Promise<void> {
  if (window.kind === 'running') {
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: 'workflow-agent',
      status: 'running',
      heartbeatAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.automations.agent_host.driveWorkflowAgentTurn,
      {
        organizationId: args.organizationId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        runId: args.runId as never,
        nodeId: args.nodeId,
        execId: args.execId,
        sessionId: args.sessionId,
        harness: args.harness,
        providerSlug: args.providerSlug,
        gatewayModel: args.gatewayModel,
        deadlineAt: args.deadlineAt,
      },
    );
    return;
  }
  if (window.kind === 'gone') {
    await settleWorkflowAgentTurn(ctx, args, {
      errored: true,
      reason: 'the sandbox session ended before the agent turn finished',
      text: '',
      files: [],
    });
    return;
  }
  // Final transcript snapshot before the settle stamps the op terminal — the
  // throttled live writes can miss the last window's activity, and this is
  // what the run views show after the turn ends.
  await ctx
    .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: 'workflow-agent',
      status: 'running',
      lastEventAt: Date.now(),
      ...(window.text !== '' ? { progressText: window.text } : {}),
      liveTimeline: window.timeline,
    })
    .catch((err) =>
      console.warn('[agent-host] final progress write failed:', err),
    );
  const { errored, crashReason } = classifyHarnessEnd(window);
  const ended = window.ended;

  // A clean turn end with a question on the table is not a settle — it is the
  // WAIT. The node stays parked on its cursor (no result), the key is
  // released (this turn is over; the answered resume mints its own), and the
  // run sits `waiting` until a person answers or the ask expires. A CRASHED
  // turn never waits: its question dies with it and the error settles as
  // usual.
  const pendingAsk = readAskRow(
    await ctx.runQuery(internal.automations.human_asks.getPendingAskForExec, {
      sessionId: args.sessionId,
      execId: args.execId,
    }),
  );
  if (pendingAsk !== null && !errored) {
    await ctx.runMutation(internal.automations.human_asks.recordAskParked, {
      askId: pendingAsk._id,
      ...(ended?.sessionId !== undefined
        ? { agentSessionId: ended.sessionId }
        : {}),
    });
    // The stepper's generic time-limit cut must not fire while the turn
    // legitimately waits — the ask's own expiry (enforced by the poll) is the
    // clock now, and the margin keeps its message the one the operator sees.
    await ctx.runMutation(internal.automations.human_asks.retargetAgentCursor, {
      organizationId: args.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      runId: args.runId as never,
      nodeId: args.nodeId,
      fromExecId: args.execId,
      deadlineAt: pendingAsk.expiresAt + ASK_DEADLINE_MARGIN_MS,
    });
    await releaseTurnKey(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      status: 'completed',
      agentResultStatus: 'awaiting_human',
      ...(window.execResult?.exitCode != null
        ? { exitCode: window.execResult.exitCode }
        : {}),
    });
    return;
  }
  if (pendingAsk !== null) {
    // Crashed with a question pending: the ask cannot be answered into a dead
    // conversation — close it so the panel stops offering it.
    await ctx.runMutation(internal.automations.human_asks.closeAsk, {
      askId: pendingAsk._id,
      status: 'cancelled',
    });
  }

  const text =
    ended?.finalText !== undefined && ended.finalText !== ''
      ? ended.finalText
      : window.text;
  await settleWorkflowAgentTurn(
    ctx,
    args,
    {
      errored,
      ...(crashReason !== undefined ? { reason: crashReason } : {}),
      text,
      files: [],
      ...(ended?.status !== undefined ? { status: ended.status } : {}),
      ...(ended?.usageTotals !== undefined ? { usage: ended.usageTotals } : {}),
    },
    {
      ...(window.execResult?.exitCode != null
        ? { exitCode: window.execResult.exitCode }
        : {}),
      ...(ended?.status !== undefined
        ? { agentResultStatus: ended.status }
        : {}),
      harvest: true,
    },
  );
}

/**
 * Settle the turn exactly once: harvest `/user/output`, revoke the key, stamp
 * the op row, write the result into the run's cursor, and poke the stepper.
 * Losers of the finalize claim do nothing — the winner's cursor write is what
 * the stepper consumes.
 */
async function settleWorkflowAgentTurn(
  ctx: ActionCtx,
  args: TurnKeys,
  result: AgentTurnResult,
  opts: {
    exitCode?: number;
    agentResultStatus?: string;
    harvest?: boolean;
  } = {},
): Promise<void> {
  const release = await releaseTurnKey(ctx, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    execId: args.execId,
    status: result.errored ? 'failed' : 'completed',
    ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
    ...(opts.agentResultStatus !== undefined
      ? { agentResultStatus: opts.agentResultStatus }
      : {}),
  });
  if (!release.won) {
    // The finalize claim is burned — but the winner may have died between its
    // claim and its cursor record (a 30-minute action ceiling kill, a
    // restart), which would leave the run parked on a result nobody can ever
    // write. The record has its own first-wins gate, so finishing the dead
    // winner's job is safe: when the result is already there this returns
    // without touching anything.
    const state = await ctx.runQuery(
      internal.automations.queries.readAgentCursor,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      { organizationId: args.organizationId, runId: args.runId as never },
    );
    const agent = state?.cursor?.agent;
    if (
      agent === undefined ||
      agent.execId !== args.execId ||
      agent.result !== undefined
    ) {
      return;
    }
    console.warn(
      `[agent-host] finalize claim for ${args.execId} was burned with no recorded result — completing the dead settle's record`,
    );
  }

  let files: AgentTurnFile[] = result.files;
  if (opts.harvest === true) {
    try {
      const harvested = await harvestSessionOutput(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
      });
      files = harvested.files.map((file) => ({
        name: file.path.split('/').at(-1) ?? file.path,
        storageId: file.storageId,
        size: file.size,
        contentType: file.contentType,
      }));
    } catch (err) {
      console.warn('[agent-host] output harvest failed:', err);
    }
  }

  await ctx.runMutation(internal.automations.mutations.recordAgentTurnSettled, {
    organizationId: args.organizationId,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
    runId: args.runId as never,
    nodeId: args.nodeId,
    execId: args.execId,
    result: { ...result, files },
  });
}
