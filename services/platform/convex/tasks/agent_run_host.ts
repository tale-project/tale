'use node';

/**
 * The live lane for TASK agent runs — the task-side twin of the automation
 * `agent_host`. A project agent assigned to a task runs one harness turn in
 * its STANDING sandbox session (`sessionIdForProjectAgent` — the workspace
 * persists across runs, so the agent keeps working state between
 * assignments). The public kick (`tasks/mutations.startTaskAgentRun`) inserts
 * the queued `taskAgentRuns` row and schedules the start here; the
 * self-chaining drive re-attaches in short windows through the shared
 * `drainHarnessWindow` core; the settle harvests `/user/output`, revokes the
 * turn's gateway key, posts the result as an agent task comment, and parks
 * the task at `in_review` (agents never complete work — the hard rule
 * `agentUpdateTaskStatus` enforces). A failed run keeps the task at
 * `in_progress`: failure is the RUN's state, and the run card offers Retry.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  liveProgressSink,
  releaseTurnKey,
  stageWorkflowSkills,
  workflowAgentBudgetCents,
} from '../automations/agent_host';
import { resolveServingTarget } from '../automations/llm_call';
import {
  buildExternalTurnExec,
  classifyHarnessEnd,
  drainHarnessWindow,
  connectorsBridgeUrlForSessions,
} from '../chat/external_turn_shared';
import { resolveTurnVisionModel } from '../lib/providers/resolve_vision_model';
import { provisionSessionGatewayKey } from '../node_only/sandbox/gateway_provisioning';
import {
  SessionDuplicateError,
  sessionCancelExec,
  sessionCreate,
  sessionDeleteFiles,
  sessionIsAlive,
  sessionListFiles,
  sessionStageFiles,
  type SessionStageFile,
} from '../node_only/sandbox/helpers/session_client';
import { stageUrlForBlobRef } from '../node_only/sandbox/helpers/stage_url';
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import {
  harvestSessionOutput,
  OUTPUT_DIR,
} from '../node_only/sandbox/session_exec';
import { projectAgentOwnerId } from '../sandbox/session_naming';

/** The argument shape every turn phase carries verbatim. */
const turnArgs = {
  organizationId: v.string(),
  runId: v.id('projectAgentRuns'),
  taskId: v.id('tasks'),
  agentId: v.id('projectAgents'),
  execId: v.string(),
  sessionId: v.string(),
  harness: v.string(),
  deadlineAt: v.number(),
};

interface TurnKeys {
  organizationId: string;
  runId: string;
  taskId: string;
  agentId: string;
  execId: string;
  sessionId: string;
  harness: string;
  deadlineAt: number;
}

/**
 * Ensure the agent's standing sandbox session exists (AGENT profile), with
 * the chat lane's orphan-adoption self-heal. Unlike the per-run workflow
 * session it is NEVER torn down here — idle stop-and-preserve owns its
 * lifecycle.
 */
async function ensureProjectAgentSession(
  ctx: ActionCtx,
  organizationId: string,
  agentId: string,
  sessionId: string,
): Promise<void> {
  const ownerId = projectAgentOwnerId(agentId);
  const existing = await ctx.runQuery(
    internal.sandbox.session_queries.getActiveSessionByOwner,
    { ownerType: 'project_agent', ownerId },
  );
  if (existing !== null) {
    if (await sessionIsAlive(sessionId)) {
      // A hibernated row over a still-warm container: re-admit through the
      // cap check, or the turn runs on a slot no budget counts. Throws
      // QUOTA_EXCEEDED when the org is full — the caller parks the run.
      if (existing.status === 'stopped') {
        await ctx.runMutation(
          internal.sandbox.session_mutations.resumeSessionSlotWithCapCheck,
          { organizationId, sessionId },
        );
      }
      return;
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
        // org's budget until the reconcile cron notices.
        await ctx
          .runMutation(
            internal.sandbox.session_mutations.releaseProjectAgentSessionSlot,
            { organizationId, agentId },
          )
          .catch((releaseErr) =>
            console.warn(
              '[task-agent] slot release after failed resume-create failed:',
              releaseErr,
            ),
          );
        throw err;
      }
      console.warn(
        `[task-agent] adopting orphan sandbox container for ${sessionId}`,
      );
    }
    return;
  }
  const rowId = await ctx.runMutation(
    internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
    {
      organizationId,
      sessionId,
      profile: 'agent',
      ownerType: 'project_agent',
      ownerId,
      createdBy: 'system:task-agent',
    },
  );
  try {
    await sessionCreate({ sessionId, organizationId, profile: 'agent' });
  } catch (err) {
    if (err instanceof SessionDuplicateError) {
      console.warn(
        `[task-agent] adopting orphan sandbox container for ${sessionId} (no platform row)`,
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        {
          rowId,
          status: 'active',
        },
      );
      return;
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
}

/** The task's own delivery box inside the agent's STANDING session — the
 * subject-scoped subdir the turn's instructions name, the start sweep
 * clears, and the settle harvests. Scoped per task because the session is
 * per AGENT: without it, concurrent or successive runs of the agent's other
 * tasks would share one box and cross-attach deliverables. */
export function taskOutputDir(taskId: string): string {
  return `${OUTPUT_DIR}/${taskId}`;
}

/** The task's read-only INPUTS mirror — where the start stages the user's
 * attachments and the task's current deliverables before every turn. Each
 * run is a FRESH conversation and the delivery box is swept at start, so
 * without this mirror a rerun asked to "extend the deck" cannot see the deck
 * it is extending (it would grab whatever stale files another task left in
 * the shared standing workspace). Outside `/user/output` so the box sweep
 * and the settle harvest never touch it. */
export function taskInputsDir(taskId: string): string {
  return `/user/inputs/${taskId}`;
}

/** Flatten a stored file name into a single safe path segment for the inputs
 * mirror and dedupe collisions. Attachment names are user input and only
 * length-capped at write time, so separators and dot-tricks must die here —
 * the daemon would reject the traversal anyway, but as a whole-staging
 * failure instead of a renamed file. Exported for its unit test. */
export function safeInputFileName(raw: string, taken: Set<string>): string {
  let name = raw.replace(/[\\/]/g, '_').trim();
  if (name === '' || name === '.' || name === '..') name = 'file';
  let candidate = name;
  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    candidate = `${suffix}-${name}`;
  }
  taken.add(candidate);
  return candidate;
}

/** What `stageTaskInputs` actually landed, for the prompt to name. */
export interface StagedTaskInputs {
  dir: string;
  attachments: string[];
  outputs: string[];
}

/**
 * Mirror the task's inputs into the standing session: the user's attachments
 * under `<dir>/attachments/`, the task's current deliverables (earlier runs'
 * harvested outputs) under `<dir>/outputs/`. Re-mirrored from scratch every
 * turn — attachments and outputs may have changed since the last run, and a
 * stale mirror would mislead worse than none. A purged blob under a live row
 * skips that file (mirroring `stageWorkflowFiles`); a staging failure throws
 * so the run fails with the real reason instead of quietly proceeding
 * blind.
 */
async function stageTaskInputs(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    taskId: string;
    attachments: Array<{ fileId: string; fileName: string }>;
    outputs: Array<{ fileId: string; fileName: string }>;
  },
): Promise<StagedTaskInputs> {
  const dir = taskInputsDir(args.taskId);
  const staged: StagedTaskInputs = { dir, attachments: [], outputs: [] };
  try {
    await sessionDeleteFiles(args.sessionId, [dir]);
  } catch (err) {
    console.warn('[task-agent] inputs pre-clear failed (continuing):', err);
  }
  const toStage: SessionStageFile[] = [];
  for (const [kind, files] of [
    ['attachments', args.attachments],
    ['outputs', args.outputs],
  ] as const) {
    const taken = new Set<string>();
    for (const file of files) {
      const url = await stageUrlForBlobRef(
        ctx,
        file.fileId,
        args.organizationId,
      );
      if (url === null) continue; // blob purged under a live row — skip, don't fail
      const name = safeInputFileName(file.fileName, taken);
      toStage.push({ path: `${dir}/${kind}/${name}`, url });
      staged[kind].push(name);
    }
  }
  if (toStage.length === 0) return staged;
  const result = await sessionStageFiles(args.sessionId, toStage);
  if (result.skipped.length > 0) {
    throw new Error(
      `staging task inputs failed: ${result.skipped
        .map((skip) => skip.path)
        .join(', ')}`,
    );
  }
  return staged;
}

/** Phrase the turn's prompt from the task brief. Exported for its unit test.
 * `feedback` is the @mention comment that kicked a rerun — it leads the
 * brief's work section so the agent treats it as the delta to address, not
 * as one more line of context (the same comment closes the discussion tail,
 * so it is dropped from there rather than said twice). `discussion` is the
 * rerun's only memory of earlier runs — each turn is a fresh conversation.
 * `inputs` names what `stageTaskInputs` landed, and the same-file-name rule
 * makes a revision REPLACE the task's deliverable instead of piling a
 * renamed sibling next to it. `outputDir` is the task's OWN delivery box:
 * named in the user prompt (not only the system addendum) because a resumed
 * standing-session conversation happily reuses last turn's path from memory,
 * and a deliverable written outside the box is not collected. */
export function buildTaskPrompt(
  brief: {
    title: string;
    description?: string;
    labels?: string[];
    identifier?: string;
    projectName?: string;
    discussion?: Array<{ author: 'user' | 'agent'; body: string }>;
  },
  feedback?: string,
  outputDir?: string,
  inputs?: StagedTaskInputs,
): string {
  const heading =
    brief.identifier !== undefined
      ? `You are working on task ${brief.identifier}: ${brief.title}`
      : `You are working on this task: ${brief.title}`;
  const feedbackText = feedback?.trim() ?? '';
  let discussion = brief.discussion ?? [];
  const lastEntry = discussion.at(-1);
  if (
    feedbackText !== '' &&
    lastEntry?.author === 'user' &&
    lastEntry.body.trim() === feedbackText
  ) {
    discussion = discussion.slice(0, -1);
  }
  const stagedLines = [
    ...(inputs !== undefined && inputs.attachments.length > 0
      ? [
          `- ${inputs.dir}/attachments/ — files the user attached to the task: ${inputs.attachments.join(', ')}`,
        ]
      : []),
    ...(inputs !== undefined && inputs.outputs.length > 0
      ? [
          `- ${inputs.dir}/outputs/ — the task's current deliverables, produced by earlier runs: ${inputs.outputs.join(', ')}`,
        ]
      : []),
  ];
  return [
    heading,
    ...(brief.projectName !== undefined
      ? [`Project: ${brief.projectName}`]
      : []),
    ...(brief.labels !== undefined && brief.labels.length > 0
      ? [`Labels: ${brief.labels.join(', ')}`]
      : []),
    ...(brief.description !== undefined && brief.description !== ''
      ? [`Description:\n${brief.description}`]
      : []),
    ...(discussion.length > 0
      ? [
          [
            'Task discussion so far (oldest first — earlier runs of you posted the agent messages):',
            ...discussion.map(
              (entry) =>
                `${entry.author === 'user' ? 'User' : 'You (an earlier run)'}: ${entry.body}`,
            ),
          ].join('\n\n'),
        ]
      : []),
    ...(feedbackText !== ''
      ? [
          `The task was sent back with reviewer feedback — address it before anything else:\n${feedbackText}`,
        ]
      : []),
    ...(stagedLines.length > 0
      ? [
          [
            `Task inputs — read-only copies staged for this turn:`,
            ...stagedLines,
            ...(inputs !== undefined && inputs.outputs.length > 0
              ? [
                  'To revise an existing deliverable, start from its staged copy and write the updated file into the delivery box under the SAME file name — it replaces the previous version on the task.',
                ]
              : []),
          ].join('\n'),
        ]
      : []),
    ...(outputDir !== undefined
      ? [
          `Deliverables: write every file you produce into ${outputDir}/ (create it if needed). Only files in that exact directory are collected and attached to this task — anything written elsewhere, including /user/output/ itself, is discarded.`,
        ]
      : []),
    'When you are done, end with a short report of what you did and what you produced — that report is posted back to the task for human review.',
  ].join('\n\n');
}

/**
 * The scheduled turn start — everything slow: model resolution, session
 * ensure, staging, key mint, exec build, first window. Any throw fails the
 * run cleanly instead of stranding it queued.
 */
export const startTaskAgentTurn = internalAction({
  args: {
    ...turnArgs,
    model: v.string(),
    instructions: v.optional(v.string()),
    skills: v.array(v.string()),
    connectors: v.array(v.string()),
    /** The @mention comment that kicked this rerun, folded into the brief. */
    feedback: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency gate: the kick, the capacity wake, and the watchdog retry
    // can each schedule a start; only a run still at `queued` under THIS
    // execId gets one. Without it a second start mints a second gateway key
    // and a second exec — the spawner does not dedupe execIds.
    const runRow = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      { runId: args.runId },
    );
    if (
      runRow === null ||
      runRow.status !== 'queued' ||
      runRow.execId !== args.execId
    ) {
      console.warn(
        `[task-agent] start for ${args.execId} skipped (run ${runRow?.status ?? 'gone'})`,
      );
      return null;
    }
    try {
      const target = await resolveServingTarget(
        ctx,
        args.organizationId,
        args.model,
      );
      const routing = resolveGatewayRouting(
        target.providerSlug,
        target.modelId,
      );

      await ensureProjectAgentSession(
        ctx,
        args.organizationId,
        args.agentId,
        args.sessionId,
      );

      // The STANDING session serves every task of this agent, so the
      // delivery box is PER TASK — /user/output/<taskId>/ — and the harvest
      // reads only that subdir: another task's run (even a CONCURRENT one —
      // the live-run mutex is per task, not per agent) can never leak its
      // deliverables here. Before the turn, sweep this task's own subdir
      // (the settle must attach exactly what THIS run produced) plus any
      // legacy loose files at the box root, which are no longer harvested
      // and would only accumulate. Best-effort: a sweep failure costs
      // precision, not the run.
      const outputDir = taskOutputDir(args.taskId);
      try {
        const leftovers: string[] = [];
        for (const dir of [outputDir, OUTPUT_DIR]) {
          for (const entry of (await sessionListFiles(args.sessionId, dir)) ??
            []) {
            if (entry.type === 'file') leftovers.push(`${dir}/${entry.name}`);
          }
        }
        if (leftovers.length > 0) {
          await sessionDeleteFiles(args.sessionId, leftovers);
        }
      } catch (err) {
        console.warn('[task-agent] output-box sweep failed (continuing):', err);
      }

      // A project agent's equipment is the PROJECT's: team skills resolve
      // against the project's teams, never against whoever configured the
      // agent or whoever triggers the run.
      const projectScope = await ctx.runQuery(
        internal.projects.internal_queries.getProjectAgentSkillScope,
        { agentId: args.agentId },
      );
      const skillsAddendum = await stageWorkflowSkills(
        ctx,
        args.organizationId,
        args.sessionId,
        args.skills,
        projectScope === null
          ? { kind: 'org' }
          : { kind: 'project', teamIds: projectScope.teamIds },
      );

      const brief = await ctx.runQuery(
        internal.tasks.agent_runs.getTaskBriefForAgentRun,
        { taskId: args.taskId },
      );
      if (brief === null) throw new Error('the task no longer exists');

      const inputs = await stageTaskInputs(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        taskId: args.taskId,
        attachments: brief.attachments,
        outputs: brief.outputs,
      });

      // A text-only serving model still meets image inputs (task
      // attachments, scanned PDFs) — arm the vision polyfill so those route
      // through the gateway instead of 404ing the turn.
      const vision = await resolveTurnVisionModel(
        ctx,
        args.organizationId,
        target,
      );
      // Resolved once: the harness needs it to route image reads, and the op
      // row records it so the run's viewers can see which model did the
      // reading after the fact.
      const visionModelRef =
        vision !== null
          ? resolveGatewayRouting(vision.providerSlug, vision.modelId)
              .gatewayModel
          : undefined;
      const budgetCents = workflowAgentBudgetCents();
      const key = await provisionSessionGatewayKey(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        allowedModels: [
          { providerSlug: target.providerSlug, modelId: target.modelId },
          ...(vision !== null ? [vision] : []),
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
            allowedModels: [routing.gatewayModel],
            connectorGrants: [...args.connectors],
            budgetCents,
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
          kind: 'task-agent',
          status: 'running',
          modelRef: `${target.providerSlug}/${routing.gatewayModel}`,
          deadlineMs: args.deadlineAt,
          heartbeatAt: Date.now(),
          mintedKeyId: key.keyId,
        },
      );
      await ctx.runMutation(internal.tasks.agent_runs.setTaskAgentRunRunning, {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        runId: args.runId as never,
      });

      const instructions = [
        ...(args.instructions !== undefined && args.instructions !== ''
          ? [args.instructions]
          : []),
        ...(skillsAddendum !== '' ? [skillsAddendum] : []),
        `Write every file you produce to ${outputDir}/ (this task's own delivery box — never plain /user/output/) — files there are collected when your turn ends and attached to the task.`,
        `Your workspace (/user/workspace) is a standing area shared across ALL tasks assigned to you — files already there may belong to other tasks. Trust the task brief and its staged inputs over anything found lying around.`,
      ].join('\n\n');

      const exec = buildExternalTurnExec({
        harness: args.harness,
        gatewayModel: routing.gatewayModel,
        serving: { kind: 'gateway', token: key.token },
        instructions,
        prompt: buildTaskPrompt(brief, args.feedback, outputDir, inputs),
        execId: args.execId,
        ...(args.connectors.length > 0
          ? { bridgeUrl: connectorsBridgeUrlForSessions() }
          : {}),
        ...(visionModelRef !== undefined
          ? { vision: { model: visionModelRef } }
          : {}),
      });

      const progress = liveProgressSink(
        ctx,
        args,
        'task-agent',
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
      // A full session budget is not a failure — park the run and let the
      // next slot release (or the watchdog backstop) restart it. Everything
      // else settles as a failure with the REAL reason.
      if (isQuotaExceededError(err)) {
        console.warn(
          `[task-agent] no session slot for ${args.execId} — parking the run until one frees`,
        );
        await ctx.runMutation(
          internal.tasks.agent_runs.parkTaskAgentRunForCapacity,
          { runId: args.runId, execId: args.execId },
        );
        return null;
      }
      console.error('[task-agent] turn start failed:', err);
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        reason: `the agent run could not start: ${err instanceof Error ? err.message : String(err)}`,
        text: '',
      });
    }
    return null;
  },
});

/** The `QUOTA_EXCEEDED` shape thrown by the slot reserve and the cap-checked
 * resume — the one start failure that parks instead of failing. */
function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { code?: unknown }).code === 'QUOTA_EXCEEDED'
    );
  }
  // A ConvexError thrown inside a sub-mutation reaches the action wrapped as
  // a plain Error whose message carries the payload — match the code there.
  return err instanceof Error && err.message.includes('QUOTA_EXCEEDED');
}

/** The self-chaining drainer: one attach window per invocation. */
export const driveTaskAgentTurn = internalAction({
  args: turnArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    // Orphan check: the run may have been cancelled or already settled. An
    // orphan turn is cut, its key revoked, and nothing else touched.
    const run = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        runId: args.runId as never,
      },
    );
    const live =
      run !== null &&
      (run.status === 'queued' || run.status === 'running') &&
      run.execId === args.execId;
    if (!live) {
      await sessionCancelExec(args.sessionId, args.execId).catch(() => {
        console.warn('[task-agent] orphan exec reap failed (already gone?)');
      });
      await releaseTurnKey(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        status: 'cancelled',
      });
      await releaseProjectAgentSlotAfterSettle(ctx, args);
      return null;
    }

    if (Date.now() > args.deadlineAt) {
      await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
        console.warn('[task-agent] deadline exec cancel failed:', err),
      );
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent run ran past its time limit and was stopped',
        text: '',
      });
      return null;
    }

    const progress = liveProgressSink(ctx, args, 'task-agent');
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
      console.error('[task-agent] drive window threw:', err);
      await progress.flush();
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent run stopped unexpectedly',
        text: '',
      });
      return null;
    }
    await progress.flush();
    await continueOrSettle(ctx, args, window);
    return null;
  },
});

/** Cut a live exec (cancel button, leaving in_progress): reap + revoke. The
 * run row is already marked cancelled by the public mutation. */
export const cancelTaskAgentExec = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    execId: v.string(),
    /** Optional so pre-field cancels already in the scheduler still land;
     * without it the slot waits for the reconcile cron. */
    agentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
      console.warn('[task-agent] exec cancel failed:', err),
    );
    await releaseTurnKey(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      status: 'cancelled',
    });
    if (args.agentId !== undefined) {
      await releaseProjectAgentSlotAfterSettle(ctx, {
        organizationId: args.organizationId,
        agentId: args.agentId,
      });
    }
    return null;
  },
});

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
      kind: 'task-agent',
      status: 'running',
      heartbeatAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.tasks.agent_run_host.driveTaskAgentTurn,
      {
        organizationId: args.organizationId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        runId: args.runId as never,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        taskId: args.taskId as never,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from this invocation's own args
        agentId: args.agentId as never,
        execId: args.execId,
        sessionId: args.sessionId,
        harness: args.harness,
        deadlineAt: args.deadlineAt,
      },
    );
    return;
  }
  if (window.kind === 'gone') {
    await settleTaskAgentTurn(ctx, args, {
      errored: true,
      reason: 'the sandbox session ended before the agent run finished',
      text: '',
    });
    return;
  }
  // Final transcript snapshot before the settle stamps the op terminal — the
  // throttled live writes can miss the last window's activity, and this is
  // what the run's Details dialog shows after the turn ends.
  await ctx
    .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: 'task-agent',
      status: 'running',
      lastEventAt: Date.now(),
      ...(window.text !== '' ? { progressText: window.text } : {}),
      liveTimeline: window.timeline,
    })
    .catch((err) =>
      console.warn('[task-agent] final progress write failed:', err),
    );
  const { errored, crashReason } = classifyHarnessEnd(window);
  const ended = window.ended;
  const text =
    ended?.finalText !== undefined && ended.finalText !== ''
      ? ended.finalText
      : window.text;
  await settleTaskAgentTurn(ctx, args, {
    errored,
    ...(crashReason !== undefined ? { reason: crashReason } : {}),
    text,
  });
}

/**
 * Settle exactly once (the session-op finalize claim elects the winner):
 * harvest `/user/output`, then on success post the agent's report as a task
 * comment and park the task at `in_review`; on failure record the error on
 * the run row and leave the task where it is.
 */
async function settleTaskAgentTurn(
  ctx: ActionCtx,
  args: TurnKeys,
  result: { errored: boolean; reason?: string; text: string },
): Promise<void> {
  const release = await releaseTurnKey(ctx, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    execId: args.execId,
    status: result.errored ? 'failed' : 'completed',
  });
  if (!release.won) {
    // The finalize claim keys on the op row — a start that died BEFORE
    // writing one (model unresolvable, spawner error, staging failure) loses
    // the claim with the run still live, and returning here would strand it
    // at `queued` with the real reason lost (observed live: a quota throw
    // rotted for 4½ minutes, then the watchdog failed it with a wrong
    // message). Mirror of the automation lane's fallback: when this exec
    // still owns a non-terminal run, finish the job — the mark mutations are
    // first-wins, so racing a live winner degrades to a no-op.
    const run = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      { runId: args.runId as never },
    );
    if (
      run === null ||
      run.execId !== args.execId ||
      run.status === 'settled' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return;
    }
    console.warn(
      `[task-agent] finalize claim for ${args.execId} was burned with the run still live — recording the settle anyway`,
    );
  }

  if (result.errored) {
    await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      runId: args.runId as never,
      error: result.reason ?? 'the agent run failed',
    });
    await releaseProjectAgentSlotAfterSettle(ctx, args);
    return;
  }

  let fileNames: string[] = [];
  try {
    const harvested = await harvestSessionOutput(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      outputDir: taskOutputDir(args.taskId),
    });
    const files = harvested.files.map((file) => ({
      fileId: file.storageId,
      fileName: file.path.split('/').at(-1) ?? file.path,
      fileType: file.contentType,
      fileSize: file.size,
    }));
    fileNames = files.map((file) => file.fileName);
    if (files.length > 0) {
      // Deliverables outlive the run: re-source each harvested blob's
      // metadata row OUT of the agent temp-GC lane (source 'agent' +
      // no documentId is retention-eligible), then merge the set into the
      // task's Output zone (same fileName ⇒ replace). Best-effort — losing
      // the attach must not lose the settle.
      for (const file of files) {
        await ctx
          .runMutation(
            internal.file_metadata.internal_mutations.saveFileMetadata,
            {
              organizationId: args.organizationId,
              storageId: file.fileId,
              fileName: file.fileName,
              contentType: file.fileType,
              size: file.fileSize,
              source: 'task-output',
            },
          )
          .catch((err) =>
            console.warn('[task-agent] output metadata claim failed:', err),
          );
      }
      await ctx.runMutation(
        internal.tasks.internal_mutations.agentRecordTaskOutputs,
        {
          organizationId: args.organizationId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
          taskId: args.taskId as never,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
          runId: args.runId as never,
          files,
        },
      );
    }
  } catch (err) {
    console.warn('[task-agent] output harvest failed:', err);
  }

  const resultText =
    result.text.trim() !== ''
      ? result.text.trim()
      : 'The agent finished without a report.';
  const body = [
    resultText,
    ...(fileNames.length > 0
      ? [
          ['Files produced:', ...fileNames.map((name) => `- ${name}`)].join(
            '\n',
          ),
        ]
      : []),
  ].join('\n\n');

  let resultMessageId: string | undefined;
  try {
    const comment = await ctx.runMutation(
      internal.tasks.internal_mutations.agentAddComment,
      {
        organizationId: args.organizationId,
        actorId: args.agentId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
        taskId: args.taskId as never,
        body,
      },
    );
    resultMessageId = comment.messageId;
  } catch (err) {
    console.warn('[task-agent] result comment failed:', err);
  }

  const status = await ctx.runMutation(
    internal.tasks.internal_mutations.agentUpdateTaskStatus,
    {
      organizationId: args.organizationId,
      actorId: args.agentId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      taskId: args.taskId as never,
      status: 'in_review',
    },
  );
  if (!status.ok) {
    console.warn('[task-agent] in_review transition refused:', status.reason);
  }

  await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
    runId: args.runId as never,
    resultText,
    ...(resultMessageId !== undefined ? { resultMessageId } : {}),
  });
  await releaseProjectAgentSlotAfterSettle(ctx, args);
}

/**
 * Free the agent's standing-session slot the moment its run ends — the org's
 * whole agent budget otherwise stays held through the ~30-min idle sweep. A
 * sibling task's live turn keeps the session up (the release mutation checks
 * running ops); the workspace is preserved either way. Best-effort: a failed
 * release costs latency (the reconcile cron gets it), never the settle.
 */
async function releaseProjectAgentSlotAfterSettle(
  ctx: ActionCtx,
  args: Pick<TurnKeys, 'organizationId' | 'agentId'>,
): Promise<void> {
  try {
    await ctx.runMutation(
      internal.sandbox.session_mutations.releaseProjectAgentSessionSlot,
      { organizationId: args.organizationId, agentId: args.agentId },
    );
  } catch (err) {
    console.warn('[task-agent] session-slot release failed:', err);
  }
}
