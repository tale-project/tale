'use node';

/**
 * Shared machinery for the async third-party external turn.
 *
 * An external turn runs a harness CLI inside the thread's sandbox session. The
 * exec runs UNDER runnerd, independent of any single Convex action: it is
 * kicked once and then DRAINED in short self-chaining windows (a Convex action
 * cannot be held open for a long turn — a cold or slow turn would outlive its
 * execution window and be killed mid-run). Each window re-attaches to the
 * running exec from the START of runnerd's byte-identical replay buffer,
 * re-parses the full output-so-far, streams the accumulating reply into the
 * assistant message as it arrives, and settles when the harness turn ends —
 * the exec's exit, or the `turn-ended` event cutting the window early for a
 * hold-stdin harness whose process lingers after its reply. Re-parsing from
 * the start (rather than carrying a per-delta cursor across windows) keeps a
 * JSONL line that straddles a window boundary from being stranded by the
 * fresh per-window parser.
 *
 * The scheduled start action owns the gateway token (it starts the exec with
 * the token in the env); a drain window only ATTACHES, so no secret is ever
 * persisted.
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
  SessionDuplicateError,
  SessionNotFoundError,
  sessionCancelExec,
  sessionCreate,
  sessionIsAlive,
  sessionStageFiles,
  type SessionExecBody,
  type SessionExecResult,
} from '../node_only/sandbox/helpers/session_client';
import {
  getVirtualKeySpendCents,
  revokeVirtualKey,
} from '../node_only/sandbox/llm_gateway_admin';
import { sessionIdForUser, userOwnerId } from '../sandbox/session_naming';

/** Where a conversation's equipped skills land inside the session. */
const SKILLS_DIR = 'workspace/.tale/skills';
/** One drain window; well under the Convex action execution ceiling. */
export const DRAIN_WINDOW_MS = 90_000;
/** After the parser sees `turn-ended`, how long to keep draining for the
 * exec's natural exit (which carries a close-stdin harness's exit code)
 * before cutting the window. A hold-stdin harness (claude-code) never exits
 * on its own — without the cut, every reply would sit out the full window. */
export const TURN_ENDED_EXIT_GRACE_MS = 1_500;
/** Floor between two mid-window writes of the accumulating reply text. */
export const STREAM_TEXT_THROTTLE_MS = 1_000;
/** Overall wall-clock a turn may run before it is cut as hung. */
export const EXTERNAL_TURN_DEADLINE_MS = 30 * 60_000;
/** Session gateway key budget per turn, in cents. */
export const TURN_BUDGET_CENTS = 500;

export interface ExternalTurnScope {
  organizationId: string;
  threadId: string;
  userId: string;
}

/** How the managed lane resolved the model a turn runs on. A refusal carries
 * user-facing prose (the kick writes it under the message verbatim). */
export type ManagedModelChoice =
  | { ok: true; providerSlug: string; modelId: string }
  | { ok: false; reason: string };

/**
 * The managed model an external turn runs on: the composer's explicit pick
 * when one is sent, else the org's first directly-served model. Only a model
 * a direct-capable credential (api-key/env) serves can ride the session
 * gateway key, so a pick outside that set is refused by name — the composer
 * filters its picker to the same set, but a stale client or a direct API call
 * can still ask for more.
 */
export async function resolveManagedModel(
  ctx: ActionCtx,
  organizationId: string,
  requestedModelId?: string,
): Promise<ManagedModelChoice> {
  const listing = await ctx.runAction(api.chat.composer.listComposerModels, {
    organizationId,
  });
  const direct = listing.models.filter(
    (model) =>
      model.credential.authMethod === 'api-key' ||
      model.credential.authMethod === 'env',
  );
  if (requestedModelId !== undefined) {
    const match = direct.find((model) => model.id === requestedModelId);
    if (match) {
      return { ok: true, providerSlug: match.providerSlug, modelId: match.id };
    }
    const subscriptionOnly = listing.models.some(
      (model) => model.id === requestedModelId,
    );
    return {
      ok: false,
      reason: subscriptionOnly
        ? `The model "${requestedModelId}" is served by a subscription credential bound to its vendor's own tooling, so a third-party agent here cannot run it. Pick a directly served model.`
        : `The model "${requestedModelId}" is not offered by any active provider credential of this organization. Pick a model from the composer's list, or connect a provider under Settings → AI providers.`,
    };
  }
  const first = direct[0];
  return first
    ? { ok: true, providerSlug: first.providerSlug, modelId: first.id }
    : {
        ok: false,
        reason:
          'This third-party agent needs a model to run on, and the organization has no directly usable AI provider credential. Connect one under Settings → AI providers.',
      };
}

/** The gateway base URL as a session's CONTAINER reaches it (sandbox network
 * alias, never the host address). */
export function gatewayBaseUrlForSessions(): string {
  const url =
    process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
  return url.replace(/\/$/, '');
}

/** The integrations-bridge base URL as a session's CONTAINER reaches it — the
 * platform HTTP-actions origin over the sandbox network alias (same contract
 * as the staging callback), plus the bridge's route prefix. */
export function integrationsBridgeUrlForSessions(): string {
  const origin = (
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://convex:3211'
  ).replace(/\/$/, '');
  return `${origin}/api/integrations`;
}

/**
 * Ensure the caller's external-agent sandbox session exists with the AGENT profile.
 *
 * The session is USER-scoped, one persistent sandbox per (org, user): an external-agent
 * chat is the user's ongoing workspace, so every such thread they open
 * shares it and its files/`--resume` state persist across conversations. The
 * CONTAINER is disposable — a reaped/stopped one is recreated against the same
 * deterministic id, which re-attaches the preserved workspace — but the DATA
 * lives until the user explicitly destroys it. (run_code keeps its own
 * separate thread-scoped `ensureThreadSession`.)
 */
export async function ensureAgentSession(
  ctx: ActionCtx,
  scope: ExternalTurnScope,
): Promise<string> {
  const sessionId = sessionIdForUser(scope.organizationId, scope.userId);
  const ownerId = userOwnerId(scope.organizationId, scope.userId);
  const existing = await ctx.runQuery(
    internal.sandbox.session_queries.getActiveSessionByOwner,
    { ownerType: 'user', ownerId },
  );
  if (existing !== null) {
    if (await sessionIsAlive(sessionId)) return sessionId;
    // A 409 here means the spawner still holds this id's container — an orphan
    // the aliveness probe raced. It is bound to the SAME deterministic
    // workspace, so adopt it instead of failing the turn (reaping via destroy
    // would delete the user's preserved workspace).
    try {
      await sessionCreate({
        sessionId,
        organizationId: scope.organizationId,
        profile: 'agent',
      });
    } catch (err) {
      if (!(err instanceof SessionDuplicateError)) throw err;
      console.warn(
        `[external-turn] adopting orphan sandbox container for ${sessionId} (spawner had it; platform row was stale)`,
      );
    }
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
    // Same adopt-the-orphan self-heal: the container exists spawner-side under
    // this deterministic id, so keep the reserved row and use it rather than
    // failing the turn with a 409.
    if (err instanceof SessionDuplicateError) {
      console.warn(
        `[external-turn] adopting orphan sandbox container for ${sessionId} (no platform row; spawner had it)`,
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'active' },
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
 * Stage the thread's equipped skills into the session and return the
 * instructions addendum describing them (empty when nothing staged).
 *
 * A skill ships as its WHOLE bundle — `SKILL.md` verbatim plus every asset
 * beside it — because a script-driven skill (the document skills' `scripts/`
 * trees) is inert without them; `sessionStageFiles` chunks the payload, so
 * bundle size is the file layer's concern, not this one's.
 */
export async function stageSkills(
  ctx: ActionCtx,
  scope: ExternalTurnScope,
  sessionId: string,
  skillSlugs: readonly string[],
): Promise<string> {
  if (skillSlugs.length === 0) return '';
  const orgSlug = await orgSlugFromId(ctx, scope.organizationId);
  const files: Array<{ path: string; contentBase64: string }> = [];
  const staged: string[] = [];
  for (const slug of skillSlugs) {
    const bundle = await ctx.runAction(
      internal.skills.file_actions.readSkillBundle,
      {
        orgSlug,
        slug,
        viewerUserId: scope.userId,
        isOrgAdmin: false,
      },
    );
    if (bundle === null || bundle.files.length === 0) continue;
    for (const file of bundle.files) {
      files.push({
        path: `${SKILLS_DIR}/${slug}/${file.path}`,
        contentBase64: file.contentBase64,
      });
    }
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

/**
 * Provision AND TRACK the session gateway key for a turn. Returns the plaintext
 * token (inject into the exec env; never persist) and the gateway key id.
 *
 * The keyId is the whole point: it is persisted two ways so the VK is always
 * revocable, closing the per-turn credential leak. A `sandboxSessionTokens` row
 * (hash + scope + turn-deadline expiry) lets session teardown/destroy revoke it;
 * the caller also stamps the id on the turn's op row (`mintedKeyId`) so the
 * per-turn finalize and the recovery watchdog revoke it the instant the turn
 * settles. The plaintext token itself is never stored — only its sha256 hash.
 */
export async function provisionTurnGatewayToken(
  ctx: ActionCtx,
  scope: ExternalTurnScope,
  sessionId: string,
  model: { providerSlug: string; modelId: string },
  meta: {
    harness: string;
    gatewayModel: string;
    expiresAt: number;
    /** Integration slugs this turn's agent is equipped with — the bridge's
     * grant set, read back from the token row on every dispatch. */
    integrationGrants?: readonly string[];
    /** Workspace-tool names this turn may call (knowledge/documents reads) —
     * the /api/tools grant set, read back from the token row on dispatch. */
    toolGrants?: readonly string[];
  },
): Promise<{ token: string; keyId: string }> {
  const key = await provisionSessionGatewayKey(ctx, {
    organizationId: scope.organizationId,
    sessionId,
    allowedModels: [model],
    budgetCents: TURN_BUDGET_CENTS,
  });
  await ctx.runMutation(internal.sandbox.session_mutations.insertSessionToken, {
    organizationId: scope.organizationId,
    sessionId,
    tokenHash: key.keyHash,
    llmGatewayKeyId: key.keyId,
    scope: {
      agentKind: meta.harness,
      allowedModels: [meta.gatewayModel],
      integrationGrants: [...(meta.integrationGrants ?? [])],
      toolGrants: [...(meta.toolGrants ?? [])],
      budgetCents: TURN_BUDGET_CENTS,
      threadId: scope.threadId,
      userId: scope.userId,
    },
    expiresAt: meta.expiresAt,
  });
  return { token: key.token, keyId: key.keyId };
}

/**
 * Open (or re-stamp) the turn's op row — the single source of truth the
 * recovery watchdog, the Settings fleet page, and the per-turn finalize all
 * read. Written `running` at turn start with the durable finalize context
 * (`mintedKeyId` to revoke, `deadlineMs`, the streamed-into message, usage
 * attribution) and a fresh heartbeat. Idempotent: keyed by (sessionId, execId),
 * later calls patch only the fields they carry.
 */
export async function openExternalTurnOp(
  ctx: ActionCtx,
  args: {
    scope: ExternalTurnScope;
    sessionId: string;
    execId: string;
    messageId: Id<'messages'>;
    providerSlug: string;
    gatewayModel: string;
    streamId: string;
    deadlineMs: number;
    mintedKeyId?: string;
  },
): Promise<void> {
  await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
    organizationId: args.scope.organizationId,
    sessionId: args.sessionId,
    threadId: args.scope.threadId,
    execId: args.execId,
    kind: 'agent-run',
    status: 'running',
    assistantMessageId: args.messageId,
    userId: args.scope.userId,
    modelRef: `${args.providerSlug}/${args.gatewayModel}`,
    streamId: args.streamId,
    deadlineMs: args.deadlineMs,
    heartbeatAt: Date.now(),
    ...(args.mintedKeyId !== undefined
      ? { mintedKeyId: args.mintedKeyId }
      : {}),
  });
}

/** Bump the turn op row's heartbeat — proof of life for the recovery watchdog,
 * mirroring the generation row's heartbeat. A no-op if the row is gone. */
export async function heartbeatExternalTurnOp(
  ctx: ActionCtx,
  scope: ExternalTurnScope,
  sessionId: string,
  execId: string,
): Promise<void> {
  await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
    organizationId: scope.organizationId,
    sessionId,
    threadId: scope.threadId,
    execId,
    kind: 'agent-run',
    status: 'running',
    heartbeatAt: Date.now(),
  });
}

/** Whether a harness can run in the MANAGED external lane (V1's only path): it
 * must be a known slug AND declare `credentialPolicy.managed`. A byo-only
 * harness (e.g. Cursor) can't route through the session gateway, so a managed
 * turn on it would build an inert exec that hangs to the deadline — refuse it
 * up front instead. */
export function isManagedHarness(harness: string): boolean {
  if (!isHarnessSlug(harness)) return false;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.credentialPolicy.managed === true;
}

/** Build the harness exec for a managed external turn. */
export function buildExternalTurnExec(args: {
  harness: string;
  gatewayModel: string;
  gatewayToken: string;
  instructions: string;
  prompt: string;
  resume?: string;
  execId: string;
  /** When set, mount the in-image integrations MCP bridge pointed here —
   * only for turns whose agent is equipped with at least one connector. */
  bridgeUrl?: string;
  /** Extra per-exec env under the harness's own (the Tier-2 broker's git
   * credential + author identity) — the harness env wins on collision, so a
   * connector token can never shadow a credential/config key the harness
   * itself needs. */
  extraEnv?: Record<string, string>;
}): HarnessExec {
  if (!isHarnessSlug(args.harness)) {
    throw new Error(`Unknown external agent "${args.harness}".`);
  }
  const glue = getHarnessGlue(args.harness, loadHarnesses());
  const exec = glue.buildExec({
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
    ...(args.bridgeUrl !== undefined
      ? { mcp: { bridgeUrl: args.bridgeUrl } }
      : {}),
    execId: args.execId,
  });
  if (args.extraEnv === undefined) return exec;
  return { ...exec, env: { ...args.extraEnv, ...exec.env } };
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
 * Drain ONE window of an external turn. Re-attaches from the ring-buffer start,
 * re-parses the full output-so-far, streams it into the assistant message,
 * and settles the turn when the harness ends. `start` is set on the start
 * action's first window (it starts the exec with the gateway token in the
 * env); a drain window omits it and only attaches.
 */
export async function drainExternalTurnWindow(
  ctx: ActionCtx,
  args: {
    scope: ExternalTurnScope;
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

  // A hold-stdin harness (claude-code) lingers after its reply waiting for
  // more input, so its process exit can be a whole window away from the
  // `turn-ended` event that actually ends the turn. Cut the drain shortly
  // after the parser sees `turn-ended`; the grace lets a harness that DOES
  // exit deliver its terminal result (and exit code) first.
  const turnEndedCut = new AbortController();
  let turnEndedGrace: ReturnType<typeof setTimeout> | undefined;

  // Stream the text-so-far into the assistant message while the exec runs —
  // throttled, serialized, best-effort — so the reply reads live instead of
  // landing once per window. Each write carries the FULL text-so-far (the SET
  // is idempotent), so a failed write is healed by the next one.
  let lastStreamedText = '';
  let lastStreamAt = 0;
  let streamChain: Promise<unknown> = Promise.resolve();
  const streamTextSoFar = () => {
    const now = Date.now();
    if (now - lastStreamAt < STREAM_TEXT_THROTTLE_MS) return;
    const text = textFromEvents(events);
    if (text === '' || text === lastStreamedText) return;
    lastStreamAt = now;
    lastStreamedText = text;
    streamChain = streamChain.then(() =>
      ctx
        .runMutation(internal.chat.messages.setAssistantTextInternal, {
          organizationId: args.scope.organizationId,
          messageId: args.messageId,
          text,
        })
        .catch((err) =>
          console.warn('[external-turn] mid-window text write failed:', err),
        ),
    );
  };

  const onStdout = (chunk: string) => {
    for (const e of parser.feed(chunk)) {
      events.push(e);
      if (e.type === 'turn-ended' && turnEndedGrace === undefined) {
        turnEndedGrace = setTimeout(
          () => turnEndedCut.abort(),
          TURN_ENDED_EXIT_GRACE_MS,
        );
      }
    }
    streamTextSoFar();
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
        timeoutMs: EXTERNAL_TURN_DEADLINE_MS,
      }
    : {
        execId: args.execId,
        collectOutput: false,
        timeoutMs: EXTERNAL_TURN_DEADLINE_MS,
      };

  // On the start action's first window we STAGE the exec's input files, then start
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

  // The start action's first window is about to START the exec — flip the
  // generation
  // out of 'queued' NOW. The only other flip is the cursor advance at this
  // window's END, up to DRAIN_WINDOW_MS away, and until then the UI would
  // show "waiting to start" for a turn that is already running in the
  // sandbox. Setup (session ensure, key mint, staging) is over, so 'queued'
  // has told its truth.
  if (args.start !== undefined) {
    await ctx.runMutation(internal.chat.generations.heartbeatInternal, {
      organizationId: args.scope.organizationId,
      threadId: args.scope.threadId,
    });
  }

  const windowSignal = AbortSignal.timeout(DRAIN_WINDOW_MS);
  const drainSignal = AbortSignal.any([windowSignal, turnEndedCut.signal]);
  let exited = false;
  let execResult: SessionExecResult | undefined;
  try {
    execResult = await drainSessionExecResilient(
      args.sessionId,
      body,
      drainSignal,
      { onStdout },
      args.start ? {} : { resumeSinceSeq: 0 },
    );
    exited = true;
  } catch (err) {
    if (err instanceof SessionNotFoundError) return { kind: 'gone' };
    if (!drainSignal.aborted) throw err;
    // Window elapsed with the exec still live, or the turn ended under a
    // lingering exec — either way not a drain failure.
  } finally {
    if (turnEndedGrace !== undefined) clearTimeout(turnEndedGrace);
    // Order the terminal full-text write below after any in-flight streamed
    // one, and never leave a write dangling past the action.
    await streamChain;
  }
  for (const e of parser.end()) events.push(e);

  const text = textFromEvents(events);
  if (text !== '' && text !== lastStreamedText) {
    await ctx.runMutation(internal.chat.messages.setAssistantTextInternal, {
      organizationId: args.scope.organizationId,
      messageId: args.messageId,
      text,
    });
  }

  const ended = lastTurnEnded(events);
  const terminal = exited || ended !== undefined;
  if (!terminal) {
    // Still running: heartbeat BOTH the generation row (live-turn signal) and
    // the op row (the recovery watchdog's staleness clock) + let the next
    // window continue.
    await ctx.runMutation(
      internal.chat.generations.advanceExternalTurnCursorInternal,
      {
        organizationId: args.scope.organizationId,
        threadId: args.scope.threadId,
        lastSeq: 0,
      },
    );
    await heartbeatExternalTurnOp(
      ctx,
      args.scope,
      args.sessionId,
      args.execId,
    ).catch((err) => console.warn('[external-turn] op heartbeat failed:', err));
    return { kind: 'continue' };
  }

  // A harness that lingers after its turn (held-open stdin) has ended the turn
  // but not the process — reap it so it can't hold the session.
  if (!exited && ended !== undefined) {
    await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
      console.warn('[external-turn] linger reap failed:', err),
    );
  }

  // The exec terminated WITHOUT a `turn-ended` event: the harness crashed or was
  // killed. Don't launder that into an empty success — carry the exit as an
  // explicit failure reason (the agent's own `turn-ended.isError` wins when it
  // exists; a bare crash is errored by definition).
  const crashedNoResult = ended === undefined && exited;
  const errored =
    ended !== undefined ? ended.isError === true : crashedNoResult;
  const crashReason = crashedNoResult
    ? execResult?.errorMessage !== undefined && execResult.errorMessage !== ''
      ? `The third-party agent stopped: ${execResult.errorMessage}`
      : `The third-party agent exited unexpectedly${
          typeof execResult?.exitCode === 'number'
            ? ` (exit code ${execResult.exitCode})`
            : ''
        } without completing the turn.`
    : undefined;

  await finalizeExternalTurn(ctx, {
    scope: args.scope,
    sessionId: args.sessionId,
    execId: args.execId,
    messageId: args.messageId,
    providerSlug: args.providerSlug,
    gatewayModel: args.gatewayModel,
    finalText: ended?.finalText,
    fallbackText: text,
    usageTotals: ended?.usageTotals,
    resume: ended?.sessionId,
    errored,
    harness: args.harness,
    ...(crashReason !== undefined ? { reason: crashReason } : {}),
    ...(execResult?.exitCode != null ? { exitCode: execResult.exitCode } : {}),
    ...(ended?.status !== undefined ? { agentResultStatus: ended.status } : {}),
  });
  return { kind: 'done' };
}

/**
 * Settle an external turn EXACTLY ONCE: finalize the assistant message, meter
 * usage, revoke the turn's gateway VK, stamp the op row terminal, keep the
 * harness resume handle, and delete the generation row. When the turn errored
 * with no text, the message carries the reason instead.
 *
 * The drain window, the deadline cut, a user cancel, and the recovery watchdog
 * all race to finalize a turn; `claimSessionOpFinalize` is the OCC gate that
 * elects one winner. Only the winner runs the charge-once side-effects (usage
 * ledger + VK revoke + spend record) — re-running them would double-charge and
 * (before this) leak the credential. A caller that LOST the race still unblocks
 * the thread (idempotent generation delete) and returns.
 */
export async function finalizeExternalTurn(
  ctx: ActionCtx,
  args: {
    scope: ExternalTurnScope;
    /** The session + exec this turn ran as — the op-row key for the finalize
     * claim and VK revoke. Optional only for the degraded pre-op edge; the
     * live paths always pass them. */
    sessionId?: string;
    execId?: string;
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
    /** The user stopped the turn — a clean terminal, distinct from an error.
     * Keeps whatever streamed so far and stamps the op row `cancelled`. */
    cancelled?: boolean;
    /** An explicit failure reason (deadline, session gone, crash) — shown under
     * the message. Falls back to a generic note when the turn errored with no
     * text. */
    reason?: string;
    /** The harness exec's terminal exit code + the agent's self-reported status,
     * stamped on the op row for the fleet page + the recovery watchdog. */
    exitCode?: number;
    agentResultStatus?: string;
    /** The harness that ran the turn — the per-harness key on the turn-SLO
     * event. Every live call site has it; absent only on the degraded edge. */
    harness?: string;
    /** The turn hit its wall-clock deadline (distinct from a generic failure) —
     * recorded as the `timeout` outcome. */
    timedOut?: boolean;
  },
): Promise<void> {
  // Elect the single finalizer. `won` is true only when an op row exists, was
  // not yet finalized, and this call set `finalizedAt`. A `false` with an op row
  // present means another path already settled the turn → do nothing but unblock
  // the thread. A `false` with NO op row is the degraded pre-op edge → this call
  // is the sole owner and finalizes without a per-turn revoke (the token row's
  // teardown revoke is the backstop).
  let won = true;
  let mintedKeyId: string | undefined;
  let opStartedAt: number | undefined;
  let recovered = false;
  if (args.sessionId !== undefined && args.execId !== undefined) {
    won = await ctx.runMutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: args.sessionId, execId: args.execId },
    );
    const op = await ctx.runQuery(
      internal.sandbox.session_queries.getExternalTurnOpForFinalize,
      { sessionId: args.sessionId, execId: args.execId },
    );
    if (!won && op !== null) {
      // Another path already finalized this turn — just make sure the thread is
      // not left looking like it is still generating.
      await ctx.runMutation(internal.chat.generations.endGenerationInternal, {
        organizationId: args.scope.organizationId,
        threadId: args.scope.threadId,
      });
      return;
    }
    mintedKeyId = op?.mintedKeyId;
    opStartedAt = op?.startedAt;
    recovered = op?.resumedBy === 'watchdog';
  }

  const haveText =
    (args.finalText !== undefined && args.finalText !== '') ||
    args.fallbackText !== '';
  const blockedReason =
    args.reason ??
    (args.errored && !haveText
      ? 'The third-party agent ended without producing a reply.'
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
    await ctx.runMutation(internal.chat.threads.setExternalResumeInternal, {
      organizationId: args.scope.organizationId,
      threadId: args.scope.threadId,
      externalResume: args.resume,
    });
  }

  // Revoke the turn's gateway VK — the close of the per-turn credential leak.
  // Read the authoritative spend first (revoke deletes the key), record it on
  // the op row for the fleet page, then delete the key and mark its token row.
  let turnSpentCents: number | undefined;
  if (won && mintedKeyId !== undefined && args.sessionId !== undefined) {
    const spent = await getVirtualKeySpendCents(mintedKeyId);
    if (spent !== null) {
      turnSpentCents = spent;
      if (args.execId !== undefined) {
        await ctx.runMutation(
          internal.sandbox.session_mutations.recordSessionOpSpend,
          { sessionId: args.sessionId, execId: args.execId, spentCents: spent },
        );
      }
    }
    await revokeVirtualKey(mintedKeyId).catch((err) =>
      console.warn(`[external-turn] revoke VK ${mintedKeyId} failed:`, err),
    );
    await ctx.runMutation(
      internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
      { sessionId: args.sessionId, llmGatewayKeyId: mintedKeyId },
    );
  }

  // Stamp the op row terminal so the fleet page stops showing the turn as live
  // and the recovery watchdog never re-touches it.
  if (won && args.sessionId !== undefined && args.execId !== undefined) {
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.scope.organizationId,
      sessionId: args.sessionId,
      threadId: args.scope.threadId,
      execId: args.execId,
      kind: 'agent-run',
      status: args.cancelled
        ? 'cancelled'
        : args.errored
          ? 'failed'
          : 'completed',
      ...(args.exitCode !== undefined ? { exitCode: args.exitCode } : {}),
      ...(args.agentResultStatus !== undefined
        ? { agentResultStatus: args.agentResultStatus }
        : {}),
    });
  }

  // Record the durable turn-SLO event (survives session teardown, unlike the op
  // row). Winner-only, so each turn counts once. The outcome axis drives the
  // dashboard's success rate; a user Stop is `cancelled`, excluded from it.
  if (won && args.harness !== undefined) {
    const outcome = args.cancelled
      ? 'cancelled'
      : args.timedOut
        ? 'timeout'
        : args.errored
          ? 'failed'
          : 'completed';
    await ctx.runMutation(internal.sandbox.session_mutations.recordTurnEvent, {
      organizationId: args.scope.organizationId,
      threadId: args.scope.threadId,
      userId: args.scope.userId,
      harness: args.harness,
      modelRef: `${args.providerSlug}/${args.gatewayModel}`,
      outcome,
      durationMs:
        opStartedAt !== undefined ? Math.max(0, Date.now() - opStartedAt) : 0,
      ...(turnSpentCents !== undefined ? { spentCents: turnSpentCents } : {}),
      ...(recovered ? { recovered: true } : {}),
    });
  }

  await ctx.runMutation(internal.chat.generations.endGenerationInternal, {
    organizationId: args.scope.organizationId,
    threadId: args.scope.threadId,
  });
  // A chat external-agent session outlives the turn: the harness keeps
  // its conversation (and `--resume` state) across the thread's turns, and the
  // next turn reuses it WARM. So the turn end does NOT tear the session down —
  // reclamation is the thread-delete path (`destroyThreadSession`) and the
  // idle reaper (a reaped container recreates against the preserved workspace
  // on the next turn). NOTE: wiring thread-delete + idle-reap for external-agent
  // sessions is the outstanding lifecycle follow-up.
}

/** A fresh exec id for a turn. */
export function newExecId(): string {
  return randomUUID();
}
