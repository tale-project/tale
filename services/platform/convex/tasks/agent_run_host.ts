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

import { v } from 'convex/values';

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
  sessionIsAlive,
} from '../node_only/sandbox/helpers/session_client';
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import { harvestSessionOutput } from '../node_only/sandbox/session_exec';
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
    if (await sessionIsAlive(sessionId)) return;
    try {
      await sessionCreate({ sessionId, organizationId, profile: 'agent' });
    } catch (err) {
      if (!(err instanceof SessionDuplicateError)) throw err;
      console.warn(
        `[task-agent] adopting orphan sandbox container for ${sessionId}`,
      );
    }
    await ctx.runMutation(
      internal.sandbox.session_mutations.resumeStoppedSession,
      { organizationId, sessionId },
    );
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

/** Phrase the turn's prompt from the task brief. */
function buildTaskPrompt(brief: {
  title: string;
  description?: string;
  labels?: string[];
  identifier?: string;
  projectName?: string;
}): string {
  const heading =
    brief.identifier !== undefined
      ? `You are working on task ${brief.identifier}: ${brief.title}`
      : `You are working on this task: ${brief.title}`;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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

      // A text-only serving model still meets image inputs (task
      // attachments, scanned PDFs) — arm the vision polyfill so those route
      // through the gateway instead of 404ing the turn.
      const vision = await resolveTurnVisionModel(
        ctx,
        args.organizationId,
        target,
      );
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
        'Write every file you produce to /user/output/ — files there are collected when your turn ends and reported back to the task.',
      ].join('\n\n');

      const exec = buildExternalTurnExec({
        harness: args.harness,
        gatewayModel: routing.gatewayModel,
        serving: { kind: 'gateway', token: key.token },
        instructions,
        prompt: buildTaskPrompt(brief),
        execId: args.execId,
        ...(args.connectors.length > 0
          ? { bridgeUrl: connectorsBridgeUrlForSessions() }
          : {}),
        ...(vision !== null
          ? {
              vision: {
                model: resolveGatewayRouting(
                  vision.providerSlug,
                  vision.modelId,
                ).gatewayModel,
              },
            }
          : {}),
      });

      const progress = liveProgressSink(ctx, args, 'task-agent');
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
  if (!release.won) return;

  if (result.errored) {
    await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- carried verbatim from the turn's own args
      runId: args.runId as never,
      error: result.reason ?? 'the agent run failed',
    });
    return;
  }

  let fileNames: string[] = [];
  try {
    const harvested = await harvestSessionOutput(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
    });
    fileNames = harvested.files.map(
      (file) => file.path.split('/').at(-1) ?? file.path,
    );
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
}
