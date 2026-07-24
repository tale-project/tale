'use node';

/**
 * Shared machinery for the async third-party coding turn.
 *
 * A coding turn runs a harness CLI inside the thread's sandbox session. The
 * exec runs UNDER runnerd, independent of any single Convex action: it is
 * kicked once and then DRAINED in short self-chaining windows (a Convex action
 * cannot be held open for a long turn — a cold or slow turn would outlive its
 * execution window and be killed mid-run). Each window re-attaches to the
 * running exec from the START of runnerd's byte-identical replay buffer,
 * re-parses the full output-so-far, SETs the assistant message, and settles
 * when the harness turn ends. Re-parsing from the start (rather than carrying
 * a per-delta cursor across windows) keeps a JSONL line that straddles a
 * window boundary from being stranded by the fresh per-window parser.
 *
 * The kick owns the gateway token (it starts the exec with the token in the
 * env); a drain window only ATTACHES, so no secret is ever persisted.
 */

import { randomUUID } from 'node:crypto';

import { getHarnessGlue } from '../../lib/harnesses/registry';
import {
  isHarnessSlug,
  type HarnessEvent,
  type HarnessExec,
} from '../../lib/harnesses/types';
import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { provisionSessionGatewayKey } from '../node_only/sandbox/gateway_provisioning';
import {
  drainSessionExecResilient,
  SessionNotFoundError,
  sessionCancelExec,
  sessionCreate,
  sessionIsAlive,
  sessionStageFiles,
  type SessionExecBody,
} from '../node_only/sandbox/helpers/session_client';
import { sessionIdForUser, userOwnerId } from '../sandbox/session_naming';

/** Where a conversation's equipped skills land inside the session. */
const SKILLS_DIR = 'workspace/.tale/skills';
/** One drain window; well under the Convex action execution ceiling. */
export const DRAIN_WINDOW_MS = 90_000;
/** Overall wall-clock a turn may run before it is cut as hung. */
export const CODING_TURN_DEADLINE_MS = 30 * 60_000;
/** Session gateway key budget per turn, in cents. */
export const TURN_BUDGET_CENTS = 500;

export interface CodingTurnScope {
  organizationId: string;
  threadId: string;
  userId: string;
}

/** The org's first directly-served model — the managed model a coding turn
 * runs on until per-conversation model choice lands. */
export async function resolveManagedModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<{ providerSlug: string; modelId: string } | null> {
  const listing = await ctx.runAction(api.chat.composer.listComposerModels, {
    organizationId,
  });
  const direct = listing.models.find(
    (model) =>
      model.credential.authMethod === 'api-key' ||
      model.credential.authMethod === 'env',
  );
  return direct
    ? { providerSlug: direct.providerSlug, modelId: direct.id }
    : null;
}

/** The gateway base URL as a session's CONTAINER reaches it (sandbox network
 * alias, never the host address). */
export function gatewayBaseUrlForSessions(): string {
  const url =
    process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
  return url.replace(/\/$/, '');
}

/**
 * Ensure the caller's coding sandbox session exists with the AGENT profile.
 *
 * The session is USER-scoped, one persistent sandbox per (org, user): a coding
 * chat is the user's ongoing workspace, so every coding thread they open
 * shares it and its files/`--resume` state persist across conversations. The
 * CONTAINER is disposable — a reaped/stopped one is recreated against the same
 * deterministic id, which re-attaches the preserved workspace — but the DATA
 * lives until the user explicitly destroys it. (run_code keeps its own
 * separate thread-scoped `ensureThreadSession`.)
 */
export async function ensureAgentSession(
  ctx: ActionCtx,
  scope: CodingTurnScope,
): Promise<string> {
  const sessionId = sessionIdForUser(scope.organizationId, scope.userId);
  const ownerId = userOwnerId(scope.organizationId, scope.userId);
  const existing = await ctx.runQuery(
    internal.sandbox.session_queries.getActiveSessionByOwner,
    { ownerType: 'user', ownerId },
  );
  if (existing !== null) {
    if (await sessionIsAlive(sessionId)) return sessionId;
    await sessionCreate({
      sessionId,
      organizationId: scope.organizationId,
      profile: 'agent',
    });
    await ctx.runMutation(
      internal.sandbox.session_mutations.resumeStoppedSession,
      { organizationId: scope.organizationId, sessionId },
    );
    return sessionId;
  }
  const rowId = await ctx.runMutation(
    internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
    {
      organizationId: scope.organizationId,
      sessionId,
      profile: 'agent',
      ownerType: 'user',
      ownerId,
      createdBy: scope.userId,
    },
  );
  try {
    await sessionCreate({
      sessionId,
      organizationId: scope.organizationId,
      profile: 'agent',
    });
  } catch (err) {
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
 * Stage the thread's equipped skills into the session and return the
 * instructions addendum describing them (empty when nothing staged).
 */
export async function stageSkills(
  ctx: ActionCtx,
  scope: CodingTurnScope,
  sessionId: string,
  skillSlugs: readonly string[],
): Promise<string> {
  if (skillSlugs.length === 0) return '';
  const orgSlug = await orgSlugFromId(ctx, scope.organizationId);
  const files: Array<{ path: string; contentBase64: string }> = [];
  const staged: string[] = [];
  for (const slug of skillSlugs) {
    const skill = await ctx.runAction(internal.skills.file_actions.readSkill, {
      orgSlug,
      slug,
      viewerUserId: scope.userId,
      isOrgAdmin: false,
    });
    if (skill === null) continue;
    files.push({
      path: `${SKILLS_DIR}/${slug}/SKILL.md`,
      contentBase64: Buffer.from(skill.body, 'utf8').toString('base64'),
    });
    staged.push(slug);
  }
  if (files.length === 0) return '';
  const result = await sessionStageFiles(sessionId, files);
  if (result.skipped.length > 0) {
    throw new Error(
      `staging skills failed: ${result.skipped.map((s) => s.path).join(', ')}`,
    );
  }
  return [
    'Skills equipped for this conversation (read a skill before using it):',
    ...staged.map((slug) => `- /user/${SKILLS_DIR}/${slug}/SKILL.md`),
  ].join('\n');
}

/** Provision the session gateway key for a model, returning the plaintext
 * token (inject into the exec env; never persist). */
export async function provisionTurnGatewayToken(
  ctx: ActionCtx,
  scope: CodingTurnScope,
  sessionId: string,
  model: { providerSlug: string; modelId: string },
): Promise<string> {
  const key = await provisionSessionGatewayKey(ctx, {
    organizationId: scope.organizationId,
    sessionId,
    allowedModels: [model],
    budgetCents: TURN_BUDGET_CENTS,
  });
  return key.token;
}

/** Build the harness exec for a managed coding turn. */
export function buildCodingExec(args: {
  harness: string;
  gatewayModel: string;
  gatewayToken: string;
  instructions: string;
  prompt: string;
  resume?: string;
  execId: string;
}): HarnessExec {
  if (!isHarnessSlug(args.harness)) {
    throw new Error(`Unknown coding agent "${args.harness}".`);
  }
  const glue = getHarnessGlue(args.harness, loadHarnesses());
  return glue.buildExec({
    prompt: args.prompt,
    model: args.gatewayModel,
    credential: {
      mode: 'managed',
      gateway: {
        baseUrl: gatewayBaseUrlForSessions(),
        token: args.gatewayToken,
      },
    },
    workdir: '/user/workspace',
    ...(args.resume !== undefined ? { resume: args.resume } : {}),
    posture: 'act',
    ...(args.instructions !== '' ? { instructions: args.instructions } : {}),
    execId: args.execId,
  });
}

/** Text produced so far: the streamed deltas concatenated, or the complete
 * text blocks when a harness emits those instead of deltas. */
function textFromEvents(events: readonly HarnessEvent[]): string {
  const deltas = events
    .filter(
      (e): e is Extract<HarnessEvent, { type: 'text-delta' }> =>
        e.type === 'text-delta',
    )
    .map((e) => e.text)
    .join('');
  if (deltas !== '') return deltas;
  return events
    .filter(
      (e): e is Extract<HarnessEvent, { type: 'text' }> => e.type === 'text',
    )
    .map((e) => e.text)
    .join('\n\n');
}

function lastTurnEnded(
  events: readonly HarnessEvent[],
): Extract<HarnessEvent, { type: 'turn-ended' }> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.type === 'turn-ended') return e;
  }
  return undefined;
}

export type WindowOutcome =
  | { kind: 'done' }
  | { kind: 'continue' }
  | { kind: 'gone' };

/**
 * Drain ONE window of a coding turn. Re-attaches from the ring-buffer start,
 * re-parses the full output-so-far, streams it into the assistant message,
 * and settles the turn when the harness ends. `start` is set on the kick's
 * first window (it starts the exec with the gateway token in the env); a
 * drain window omits it and only attaches.
 */
export async function drainCodingWindow(
  ctx: ActionCtx,
  args: {
    scope: CodingTurnScope;
    sessionId: string;
    execId: string;
    messageId: Id<'messages'>;
    harness: string;
    providerSlug: string;
    gatewayModel: string;
    start?: HarnessExec;
  },
): Promise<WindowOutcome> {
  const glue = getHarnessGlue(
    isHarnessSlug(args.harness) ? args.harness : 'claude-code',
    loadHarnesses(),
  );
  const parser = glue.createParser();
  const events: HarnessEvent[] = [];
  const onStdout = (chunk: string) => {
    for (const e of parser.feed(chunk)) events.push(e);
  };

  const body: SessionExecBody = args.start
    ? {
        execId: args.execId,
        command: args.start.argv,
        cwd: args.start.cwd,
        env: args.start.env,
        ...(args.start.stdin !== undefined
          ? {
              stdinBase64: Buffer.from(args.start.stdin, 'utf8').toString(
                'base64',
              ),
            }
          : {}),
        ...(args.start.stdinMode !== undefined
          ? { stdinMode: args.start.stdinMode }
          : {}),
        collectOutput: false,
        timeoutMs: CODING_TURN_DEADLINE_MS,
      }
    : {
        execId: args.execId,
        collectOutput: false,
        timeoutMs: CODING_TURN_DEADLINE_MS,
      };

  // On the kick's first window we STAGE the exec's own input files, then start
  // it; drain windows attach from the ring-buffer start (resumeSinceSeq 0).
  if (
    args.start?.stagedFiles !== undefined &&
    args.start.stagedFiles.length > 0
  ) {
    const staged = await sessionStageFiles(
      args.sessionId,
      args.start.stagedFiles.map((file) => ({
        path: file.path,
        contentBase64: Buffer.from(file.content, 'utf8').toString('base64'),
      })),
    );
    if (staged.skipped.length > 0) {
      throw new Error(
        `staging exec inputs failed: ${staged.skipped.map((s) => s.path).join(', ')}`,
      );
    }
  }

  const windowSignal = AbortSignal.timeout(DRAIN_WINDOW_MS);
  let exited = false;
  try {
    await drainSessionExecResilient(
      args.sessionId,
      body,
      windowSignal,
      { onStdout },
      args.start ? {} : { resumeSinceSeq: 0 },
    );
    exited = true;
  } catch (err) {
    if (err instanceof SessionNotFoundError) return { kind: 'gone' };
    if (!windowSignal.aborted) throw err;
    // Window elapsed with the exec still live — not terminal.
  }
  for (const e of parser.end()) events.push(e);

  const text = textFromEvents(events);
  if (text !== '') {
    await ctx.runMutation(internal.chat.messages.setAssistantTextInternal, {
      organizationId: args.scope.organizationId,
      messageId: args.messageId,
      text,
    });
  }

  const ended = lastTurnEnded(events);
  const terminal = exited || ended !== undefined;
  if (!terminal) {
    // Still running: heartbeat + let the next window continue.
    await ctx.runMutation(
      internal.chat.generations.advanceCodingCursorInternal,
      {
        organizationId: args.scope.organizationId,
        threadId: args.scope.threadId,
        lastSeq: 0,
      },
    );
    return { kind: 'continue' };
  }

  // A harness that lingers after its turn (held-open stdin) has ended the turn
  // but not the process — reap it so it can't hold the session.
  if (!exited && ended !== undefined) {
    await sessionCancelExec(args.sessionId, args.execId).catch(() => undefined);
  }

  await finalizeCodingTurn(ctx, {
    scope: args.scope,
    messageId: args.messageId,
    providerSlug: args.providerSlug,
    gatewayModel: args.gatewayModel,
    finalText: ended?.finalText,
    fallbackText: text,
    usageTotals: ended?.usageTotals,
    resume: ended?.sessionId,
    errored: ended?.isError === true,
  });
  return { kind: 'done' };
}

/**
 * Settle a coding turn: finalize the assistant message, meter usage, keep the
 * harness resume handle for the next turn, and delete the generation row. When
 * the turn errored with no text, the message carries the reason instead.
 */
export async function finalizeCodingTurn(
  ctx: ActionCtx,
  args: {
    scope: CodingTurnScope;
    messageId: Id<'messages'>;
    providerSlug: string;
    gatewayModel: string;
    finalText?: string;
    fallbackText: string;
    usageTotals?: {
      inputTokens: number;
      outputTokens: number;
      costEstimateUsd?: number;
    };
    resume?: string;
    errored: boolean;
    /** An explicit failure reason (deadline, session gone) — shown under the
     * message. Falls back to a generic note when the turn errored with no
     * text. */
    reason?: string;
  },
): Promise<void> {
  const haveText =
    (args.finalText !== undefined && args.finalText !== '') ||
    args.fallbackText !== '';
  const blockedReason =
    args.reason ??
    (args.errored && !haveText
      ? 'The coding agent ended without producing a reply.'
      : undefined);
  await ctx.runMutation(
    internal.chat.messages.finalizeAssistantMessageInternal,
    {
      organizationId: args.scope.organizationId,
      messageId: args.messageId,
      ...(args.finalText !== undefined ? { finalText: args.finalText } : {}),
      model: args.gatewayModel,
      providerSlug: args.providerSlug,
      ...(args.usageTotals !== undefined ? { usage: args.usageTotals } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {}),
    },
  );

  if (args.usageTotals !== undefined) {
    await ctx.runMutation(
      internal.governance.internal_mutations.incrementUsageLedger,
      {
        organizationId: args.scope.organizationId,
        userId: args.scope.userId,
        inputTokens: args.usageTotals.inputTokens,
        outputTokens: args.usageTotals.outputTokens,
        costEstimateCents: Math.round(
          (args.usageTotals.costEstimateUsd ?? 0) * 100,
        ),
        timestamp: Date.now(),
        model: args.gatewayModel,
        provider: args.providerSlug,
      },
    );
  }

  if (args.resume !== undefined) {
    await ctx.runMutation(internal.chat.threads.setCodingResumeInternal, {
      organizationId: args.scope.organizationId,
      threadId: args.scope.threadId,
      codingResume: args.resume,
    });
  }

  await ctx.runMutation(internal.chat.generations.endGenerationInternal, {
    organizationId: args.scope.organizationId,
    threadId: args.scope.threadId,
  });
  // A chat coding session is THREAD-scoped, not turn-scoped: the harness keeps
  // its conversation (and `--resume` state) across the thread's turns, and the
  // next turn reuses it WARM. So the turn end does NOT tear the session down —
  // reclamation is the thread-delete path (`destroyThreadSession`) and the
  // idle reaper (a reaped container recreates against the preserved workspace
  // on the next turn). NOTE: wiring thread-delete + idle-reap for coding
  // sessions is the outstanding lifecycle follow-up.
}

/** A fresh exec id for a turn. */
export function newExecId(): string {
  return randomUUID();
}
