'use node';

/**
 * The coding-agent turn: one chat message answered by a third-party harness
 * (Claude Code, Codex, …) inside the thread's sandbox session.
 *
 * This is the runtime consumer the harness layer was built for — the YAML
 * facts, `buildHarnessExec`, and the stream parsers all pre-exist; this file
 * only composes them with the session machinery:
 *
 *   persist user message → begin generation → resolve credential (managed
 *   gateway v1) → ensure the thread's AGENT-profile session → stage skills +
 *   exec inputs → run the harness over the streaming exec → parse events →
 *   append the assistant message → settle → schedule teardown.
 *
 * V1 serves the MANAGED credential path only: the org's provider credentials
 * reach the container as a session-scoped gateway virtual key, so secrets
 * never enter the sandbox. A subscription credential (vendor coding plan) is
 * refused with a reason until its delivery lands — honest refusal over a
 * half-wired secret path. Connector bridging (MCP) is likewise deferred: the
 * thread's connector picks are stored but not yet mounted, because mounting
 * today would grant ALL org integrations rather than the picked ones.
 */

import { randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { getHarnessGlue } from '../../lib/harnesses/registry';
import { isHarnessSlug, type HarnessEvent } from '../../lib/harnesses/types';
import { api, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { loadHarnesses } from '../lib/providers/load_system_config';
import {
  provisionSessionGatewayKey,
  type SessionGatewayKey,
} from '../node_only/sandbox/gateway_provisioning';
import {
  sessionCreate,
  sessionExec,
  sessionIsAlive,
  sessionStageFiles,
} from '../node_only/sandbox/helpers/session_client';
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import { sessionIdForThread } from '../sandbox/session_naming';

/** Where a conversation's equipped skills land inside the session (relative
 * to the /user mount), and how the agent is told about them. */
const SKILLS_DIR = 'workspace/.tale/skills';

/** One coding turn may run this long before the exec is cut. A backstop for
 * a hung CLI, not a work budget — real tasks run many minutes. */
const CODING_TURN_TIMEOUT_MS = 30 * 60_000;

/** Session gateway key budget per turn, in cents. Conservative default until
 * the sandbox-quota governance policy carries a per-turn figure. */
const TURN_BUDGET_CENTS = 500;

const HEARTBEAT_EVERY_MS = 10_000;

interface CodingTurnScope {
  organizationId: string;
  threadId: string;
  userId: string;
}

/** Fail the turn loudly but INSIDE the conversation: settle the generation
 * and answer with the reason, so a refused turn reads as a reply rather than
 * a spinner that dies. */
async function refuseTurn(
  ctx: ActionCtx,
  scope: CodingTurnScope,
  reason: string,
): Promise<{ status: 'refused'; reason: string }> {
  await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
    organizationId: scope.organizationId,
    threadId: scope.threadId,
    role: 'assistant',
    parts: [{ type: 'text', text: reason }],
    blockedReason: reason,
  });
  await ctx.runMutation(internal.chat.generations.endGenerationInternal, {
    organizationId: scope.organizationId,
    threadId: scope.threadId,
  });
  return { status: 'refused', reason };
}

/**
 * Ensure the thread's sandbox session exists with the AGENT profile — the
 * posture harness CLIs run under (network to the gateway alias, browser
 * stack available). Mirrors `ensureThreadSession` (run_code's DEFAULT
 * profile variant); the same owner key means one session per thread, so a
 * thread mixes run_code and coding turns at whichever profile arrived first.
 */
async function ensureAgentSession(
  ctx: ActionCtx,
  scope: CodingTurnScope,
): Promise<string> {
  const sessionId = sessionIdForThread(scope.threadId);
  const existing = await ctx.runQuery(
    internal.sandbox.session_queries.getActiveSessionByOwner,
    { ownerType: 'thread', ownerId: scope.threadId },
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
      ownerType: 'thread',
      ownerId: scope.threadId,
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

/** The org's first directly-served model, as the composer lists them — the
 * turn's managed model when the thread has no better answer. */
async function resolveManagedModel(
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
  if (!direct) return null;
  return { providerSlug: direct.providerSlug, modelId: direct.id };
}

/** Stage the thread's equipped skills into the session and describe them to
 * the agent. Returns the instructions addendum (empty when nothing staged). */
async function stageSkills(
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
    // A silently missing skill would silently change behaviour — fail loud.
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
 * Start one coding-agent turn on a thread. Runs the harness to completion and
 * returns a compact acknowledgement — the conversation itself streams into
 * the `messages` and `generations` tables the client already subscribes to.
 *
 * The handler's return type is annotated explicitly — this action calls back
 * through the generated `api`, and an unannotated return would flow that
 * cycle into the API surface and degrade its types.
 */
export const startCodingTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    harness: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal('completed'), v.literal('refused')),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: 'completed' | 'refused'; reason?: string }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const scope: CodingTurnScope = {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: auth.userId,
    };

    if (!isHarnessSlug(args.harness)) {
      return {
        status: 'refused',
        reason: `Unknown coding agent "${args.harness}".`,
      };
    }

    const thread = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (thread === null) {
      return { status: 'refused', reason: 'This conversation does not exist.' };
    }

    await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      role: 'user',
      parts: [{ type: 'text', text: args.userText }],
    });
    await ctx.runMutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      streamId: randomUUID(),
    });

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      // V1 credential posture: managed gateway only — the org's provider
      // credentials, never inside the container. A vendor coding plan
      // (subscription credential) is a follow-up delivery.
      const managedModel = await resolveManagedModel(ctx, args.organizationId);
      if (managedModel === null) {
        return await refuseTurn(
          ctx,
          scope,
          'This coding agent needs a model to run on, and the organization has no directly usable AI provider credential. Connect one under Settings → AI providers.',
        );
      }

      const sessionId = await ensureAgentSession(ctx, scope);

      const routing = resolveGatewayRouting(
        managedModel.providerSlug,
        managedModel.modelId,
      );
      const gatewayKey: SessionGatewayKey = await provisionSessionGatewayKey(
        ctx,
        {
          organizationId: args.organizationId,
          sessionId,
          allowedModels: [managedModel],
          budgetCents: TURN_BUDGET_CENTS,
        },
      );

      const skillsAddendum = await stageSkills(
        ctx,
        scope,
        sessionId,
        thread.capabilities?.skills ?? [],
      );

      const glue = getHarnessGlue(args.harness, loadHarnesses());
      const execId = randomUUID();
      const exec = glue.buildExec({
        prompt: args.userText,
        model: routing.gatewayModel,
        credential: {
          mode: 'managed',
          gateway: {
            baseUrl: gatewayBaseUrlForSessions(),
            token: gatewayKey.token,
          },
        },
        workdir: '/user/workspace',
        ...(thread.codingResume !== undefined
          ? { resume: thread.codingResume }
          : {}),
        posture: 'act',
        ...(skillsAddendum !== '' ? { instructions: skillsAddendum } : {}),
        execId,
      });

      if (exec.stagedFiles !== undefined && exec.stagedFiles.length > 0) {
        const staged = await sessionStageFiles(
          sessionId,
          exec.stagedFiles.map((file) => ({
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

      heartbeat = setInterval(() => {
        void ctx
          .runMutation(internal.chat.generations.heartbeatInternal, {
            organizationId: args.organizationId,
            threadId: args.threadId,
          })
          .catch(() => undefined);
      }, HEARTBEAT_EVERY_MS);

      const parser = glue.createParser();
      const events: HarnessEvent[] = [];
      const feed = (chunk: string) => {
        for (const event of parser.feed(chunk)) events.push(event);
      };
      // The stdout stream is the harness's parseable events (collectOutput is
      // off — collecting the unbounded stream would trip the runner's cap).
      // stderr, though, is where a CLI that dies before emitting a single
      // event says why, so keep a bounded tail of it for the refusal message.
      let stderrTail = '';
      const onStderr = (text: string) => {
        stderrTail = (stderrTail + text).slice(-2000);
      };

      const result = await sessionExec(
        sessionId,
        {
          execId,
          command: exec.argv,
          cwd: exec.cwd,
          env: exec.env,
          ...(exec.stdin !== undefined
            ? {
                stdinBase64: Buffer.from(exec.stdin, 'utf8').toString('base64'),
              }
            : {}),
          ...(exec.stdinMode !== undefined
            ? { stdinMode: exec.stdinMode }
            : {}),
          collectOutput: false,
          timeoutMs: CODING_TURN_TIMEOUT_MS,
        },
        AbortSignal.timeout(CODING_TURN_TIMEOUT_MS + 60_000),
        { onStdout: feed, onStderr },
      );
      for (const event of parser.end()) events.push(event);

      let ended: Extract<HarnessEvent, { type: 'turn-ended' }> | undefined;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event !== undefined && event.type === 'turn-ended') {
          ended = event;
          break;
        }
      }
      const text =
        ended?.finalText ??
        events
          .filter(
            (event): event is Extract<HarnessEvent, { type: 'text' }> =>
              event.type === 'text',
          )
          .map((event) => event.text)
          .join('\n\n');

      const failedExec = result.status !== 'completed';
      const erroredTurn = ended?.isError === true;
      if ((failedExec && text === '') || (erroredTurn && text === '')) {
        return await refuseTurn(
          ctx,
          scope,
          `The coding agent failed before producing a reply (${
            result.errorMessage ?? ended?.status ?? result.status
          }).`,
        );
      }

      await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
        organizationId: args.organizationId,
        threadId: args.threadId,
        role: 'assistant',
        parts: [{ type: 'text', text }],
        model: routing.gatewayModel,
        providerSlug: managedModel.providerSlug,
        ...(ended?.usageTotals !== undefined
          ? { usage: ended.usageTotals }
          : {}),
      });

      // Remember the harness's own conversation handle so the next turn
      // resumes it (the workspace it lives in is preserved across turns).
      const resumeHandle = ended?.sessionId;
      if (resumeHandle !== undefined) {
        await ctx.runMutation(internal.chat.threads.setCodingResumeInternal, {
          organizationId: args.organizationId,
          threadId: args.threadId,
          codingResume: resumeHandle,
        });
      }

      if (ended?.usageTotals !== undefined) {
        await ctx.runMutation(
          internal.governance.internal_mutations.incrementUsageLedger,
          {
            organizationId: args.organizationId,
            userId: auth.userId,
            inputTokens: ended.usageTotals.inputTokens,
            outputTokens: ended.usageTotals.outputTokens,
            costEstimateCents: Math.round(
              (ended.usageTotals.costEstimateUsd ?? 0) * 100,
            ),
            timestamp: Date.now(),
            model: routing.gatewayModel,
            provider: managedModel.providerSlug,
          },
        );
      }

      await ctx.runMutation(internal.chat.generations.endGenerationInternal, {
        organizationId: args.organizationId,
        threadId: args.threadId,
      });
      return { status: 'completed' };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The coding turn failed.';
      console.error('[coding-turn] turn failed:', error);
      return await refuseTurn(
        ctx,
        scope,
        `The coding agent could not run: ${reason}`,
      );
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      await ctx.scheduler.runAfter(
        0,
        internal.node_only.sandbox.session_teardown
          .teardownThreadSessionAtTurnEnd,
        { threadId: args.threadId },
      );
    }
  },
});

/** The gateway base URL as a session's CONTAINER reaches it — the sandbox
 * network alias, never the host address (same source and default the vision
 * lane uses). */
function gatewayBaseUrlForSessions(): string {
  const url =
    process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
  return url.replace(/\/$/, '');
}
