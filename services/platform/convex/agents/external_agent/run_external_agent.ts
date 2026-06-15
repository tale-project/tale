'use node';

/**
 * External-agent runtime — runs a coding agent (Claude Code / OpenCode) inside
 * a sandbox session for one chat turn.
 *
 * Called for agents with `primaryBehavior === 'external-agent'`. Bypasses the
 * chat-loop generate_response pipeline: the user's message becomes one agent
 * run inside the thread's persistent sandbox session (`--resume` continues the
 * same conversation across turns). The agent's tool-use/text stream lands in
 * `sandboxSessionOps` live (via run_agent); this module saves the final
 * assistant text into the thread so the chat UI renders the reply, and owns
 * session lifecycle + the per-turn Bifrost virtual key.
 *
 * v1: empty `/workspace/repo` workspace (no repo attach); the agent clones with
 * the injected GITHUB_TOKEN if it needs a repo. The session is reused across
 * turns (owner = thread); the per-turn LLM key is minted and revoked here so no
 * plaintext gateway key is ever persisted.
 */

import { listMessages, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRoutingFromRef,
  revokeVirtualKey,
} from '../../node_only/sandbox/bifrost_admin';
import {
  SessionDuplicateError,
  SessionNotFoundError,
  sessionCreate,
  sessionDestroy,
  sessionEnvPatch,
  sessionIsAlive,
  sessionSetPinned,
} from '../../node_only/sandbox/helpers/session_client';
import { stageIntegrationSkills } from '../../node_only/sandbox/integration_skills';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import {
  sessionIdForThread,
  sessionIdForUser,
  userOwnerId,
} from '../../sandbox/session_naming';
import { buildSystemPromptAppend } from './system_prompt';
import {
  finalizeTurnSideEffects,
  handleTurnOutcome,
  isEmptyCompletedTurn,
  patchStreamingMessage,
  type TurnContext,
} from './turn_lifecycle';

const debugLog = createDebugLog(
  'DEBUG_EXTERNAL_AGENT',
  '[runExternalAgentTurn]',
);

// One persistent sandbox per USER, reused across all their chat threads (shared
// /workspace; each thread keeps its own Claude conversation via per-thread
// resume). Falls back to thread ownership only when no userId is available
// (system/rare). See [[sandbox-agent-sessions-e2e-2026-06-11]].
const OWNER_TYPE_USER = 'user';
const OWNER_TYPE_THREAD = 'thread';
// Data plane — Bifrost as seen from INSIDE the session container. (The
// management plane URL, BIFROST_URL, is read in bifrost_admin.ts.) Always the
// sandbox-network alias (it's hardcoded in the runtime NO_PROXY); kept
// separate from BIFROST_URL so host-run convex doesn't leak a host-only URL
// into the container (same split as SANDBOX_STORAGE_INTERNAL_BASE_URL).
const EXTERNAL_AGENT_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://bifrost:8080';
// Convex HTTP-ACTIONS base the in-sandbox MCP bridge calls for integration
// dispatch (/api/integrations/*). Resolved on the SANDBOX network, so it must
// be an on-net alias — the `--internal`, SSRF-locked agent container can reach
// neither the host (host.docker.internal) nor :3210; only on-net dual-homed
// aliases (like `bifrost`) work. Default `convex:3211` (the convex http-actions
// port): in prod the convex container is dual-homed onto the sandbox net; in
// dev a `convex` relay alias on the sandbox net forwards to the host-run convex.
// Override per environment with EXTERNAL_AGENT_INTEGRATIONS_URL.
const INTEGRATIONS_BASE_URL = (
  process.env.EXTERNAL_AGENT_INTEGRATIONS_URL || 'http://convex:3211'
).replace(/\/$/, '');
// Tier-2 broker credentials that CAN be injected into the container env (for
// CLIs like `git` that need a raw token in-process to clone/push/open PRs).
// Which of these are actually injected for a run is gated by the agent's
// integrationBindings (see the call site) — so binding an integration is the
// single switch for BOTH in-container env use and the dispatch bridge; an
// agent without `github` bound gets no GitHub token. The broker audits every
// fetch and skips grants without an active credential (degrades to anonymous).
const BROKERABLE_GRANTS = ['github'];
// Per-turn LLM budget CEILING for an external-agent run (cents), used only when
// the org has NO rolling cost cap (uncapped). When a cost cap IS configured the
// VK is sized to the rolling-remaining instead (see the mint below), so a long
// task is bounded by the org budget, not this flat default. Raised from the
// original $5 — a multi-hour task reuses ONE VK across all its continuations,
// and $5 would hard-reject a legitimate long run mid-task. Operator-tunable.
const TURN_BUDGET_CENTS = Number(
  process.env.EXTERNAL_AGENT_TURN_BUDGET_CENTS ?? '10000',
);
// The exec's SLIDING deadline window, threaded down as the exec `timeoutMs`.
// runnerd re-arms it on EVERY re-attach (ExecManager.armDeadline), so this is
// NOT a max turn duration — an actively-drained exec runs UNBOUNDED (the
// platform re-attaches every handoff, far inside this window). It only bounds a
// GENUINELY ORPHANED exec: nothing re-attaches for this long (platform fully
// gone) → runnerd reaps it (the orphan backstop; the watchdog normally
// reconnects within ~minutes, far inside this). Env-tunable.
const EXEC_DEADLINE_MS = Number(
  process.env.EXTERNAL_AGENT_EXEC_DEADLINE_MS ?? String(60 * 60 * 1000),
);
// Per-ACTION window: how long one action drains before handing off to a fresh
// continuation action. MUST sit safely below the runtime's hard action ceiling
// (measured: the local convex-local-backend hard-kills Node actions at 600s,
// ignoring ACTIONS_USER_TIMEOUT_SECS) — at 480s there's ~120s of margin for the
// handoff (VK poll + checkpoint store + schedule) + the next action's cold
// start. A hard kill skips the graceful handoff entirely, so the window must
// win the race. Env-raisable on deployments with a higher, honored ceiling.
const ACTION_WINDOW_MS = Number(
  process.env.EXTERNAL_AGENT_ACTION_WINDOW_MS ?? String(480 * 1000),
);

/**
 * Append a failure note to the timeline-so-far WITHOUT discarding it. On an
 * early end (timeout/abort/error) the message already holds the partial
 * tool timeline (patched live via onTimeline); we mark it failed and add the
 * reason rather than clobbering the history with a bare error string.
 */
function withErrorNote(
  content: AgentAssistantContent,
  note: string,
): AgentAssistantContent {
  const text = `\n\n⚠️ External agent run failed: ${note}`;
  if (typeof content === 'string') {
    return content.length > 0 ? content + text : text.trimStart();
  }
  return [...content, { type: 'text', text: text.trimStart() }];
}

export const runExternalAgentTurn = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    /** Model ref (`provider:model-id` or bare); scopes the minted VK. */
    modelRef: v.string(),
    rawPrompt: v.string(),
    systemInstructions: v.optional(v.string()),
    agentKind: v.union(v.literal('claude-code'), v.literal('opencode')),
    /** Turn posture from the thread's plan/act toggle ('execute' when absent). */
    permissionMode: v.optional(
      v.union(v.literal('plan'), v.literal('execute')),
    ),
    streamId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    /** The agent's integration allowlist — the session's dispatch grant set
     * (which integrations `integration({slug})` may invoke). Enforced
     * server-side by /api/integrations/execute; defaults to none-granted. */
    integrationBindings: v.optional(v.array(v.string())),
    organizationId: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Mutable: the one-shot empty-turn retry below swaps to a fresh exec id
    // (the catch path finalizes whichever exec is current).
    let execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let mintedKeyId: string | null = null;
    // The streaming assistant message, created BEFORE the run so the turn's tool
    // timeline is persisted incrementally into it (onTimeline below) and survives
    // cancel/timeout/disconnect. Finalized to success/failed at the end; the
    // catch falls back to a fresh failed message only if the run died before this
    // was created.
    let assistantMessageId: string | null = null;
    // Hoisted so the catch can finalize side-effects (it's assigned once the
    // sandbox is resolved, before the message + op row exist).
    let sessionId: string | null = null;
    // Mirror of the most recent content patched into the streaming message, so
    // the catch can mark it failed while preserving the partial tool timeline.
    let lastContent: AgentAssistantContent = '';

    try {
      // 1. Reuse the user's persistent sandbox, or create one (owner = user;
      // thread-owned fallback only when no userId is available). One sandbox
      // per user PER ORG serves all their threads in that org — shared
      // /workspace, per-thread Claude conversation. The owner key is
      // (org, user) so the same user in another org gets a separate sandbox.
      const ownerType = args.userId ? OWNER_TYPE_USER : OWNER_TYPE_THREAD;
      const ownerId = args.userId
        ? userOwnerId(args.organizationId, args.userId)
        : args.threadId;
      const existing = await ctx.runQuery(
        internal.sandbox.session_queries.getActiveSessionByOwner,
        { ownerType, ownerId },
      );
      // Liveness check BEFORE reuse: the spawner STOPS sessions (idle/TTL) and
      // its registry is in-memory, so a live platform row can point at a
      // container that's no longer running. The workspace is PRESERVED across a
      // stop, so a gone container means "resume", not "recreate fresh" —
      // re-create against the same deterministic id (re-attaches the host dir /
      // PVC) keeping the SAME incarnation so the per-thread --resume
      // conversation continues. Data is removed only by an explicit Destroy, so
      // we NEVER destroy the row here. Transport errors throw (a spawner blip
      // must not trigger a spurious resume/recreate).
      //
      // `sessionCreatedAt` is the --resume lower bound: a reused/resumed
      // session keeps its own createdAt (same incarnation); a freshly created
      // one uses now (it has no ops yet either way).
      let sessionCreatedAt: number;
      if (existing) {
        sessionId = existing.sessionId;
        sessionCreatedAt = existing.createdAt;
        const alive = await sessionIsAlive(existing.sessionId);
        if (!alive) {
          console.warn(
            '[runExternalAgentTurn] resuming stopped session in place:',
            sessionId,
          );
          try {
            await sessionCreate({
              sessionId,
              organizationId: args.organizationId,
              profile: 'agent',
            });
          } catch (createErr) {
            // 409: the container is actually still live (race with the reaper /
            // a re-adopted session). That's a successful resume, NOT an orphan
            // — reaping it here would wipe the preserved workspace.
            if (!(createErr instanceof SessionDuplicateError)) throw createErr;
            console.warn(
              '[runExternalAgentTurn] resume found live session (409), reusing:',
              sessionId,
            );
          }
        }
        // Normalize the row to active (refresh idle/TTL window, keep createdAt)
        // whenever we just resumed (container was gone) OR the snapshot shows a
        // hibernated row. Reading `!alive` here (not just the snapshot) closes a
        // reconcile race: the reaper-reconcile could flip this row to `stopped`
        // between the read above and now — re-creating the container without
        // this would leave a running session mislabeled "Stopped".
        if (!alive || existing.status === 'stopped') {
          await ctx.runMutation(
            internal.sandbox.session_mutations.resumeStoppedSession,
            { organizationId: args.organizationId, sessionId },
          );
        }
        // Re-push pin to the spawner: its registry is in-memory, so a spawner
        // restart (or a resume's fresh container) loses the always-on
        // exemption — the platform row is the truth.
        if (existing.pinned === true) {
          await sessionSetPinned(sessionId, true).catch((err) =>
            console.warn('[runExternalAgentTurn] re-pin failed:', err),
          );
        }
      } else {
        sessionId = args.userId
          ? sessionIdForUser(args.organizationId, args.userId)
          : sessionIdForThread(args.threadId);
        sessionCreatedAt = Date.now();
        const rowId = await ctx.runMutation(
          internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
          {
            organizationId: args.organizationId,
            sessionId,
            profile: 'agent',
            ownerType,
            ownerId,
            createdBy: args.userId ?? 'system',
            agentKind: args.agentKind,
          },
        );
        try {
          try {
            await sessionCreate({
              sessionId,
              organizationId: args.organizationId,
              profile: 'agent',
            });
          } catch (createErr) {
            // 409 duplicate: the spawner still owns a session under this
            // deterministic id that the platform no longer tracks (e.g. a
            // destroy that raced provisioning). Platform-side creation is
            // serialized by the per-owner reserve, so a duplicate can only be
            // an orphan — reap it and retry once instead of failing the turn.
            if (!(createErr instanceof SessionDuplicateError)) throw createErr;
            console.warn(
              `[runExternalAgentTurn] reaping orphan spawner session ${sessionId} (create 409)`,
            );
            await sessionDestroy(sessionId);
            await sessionCreate({
              sessionId,
              organizationId: args.organizationId,
              profile: 'agent',
            });
          }
        } catch (createErr) {
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
      }

      // EVERY turn (created OR reused): ensure the org's per-org upstream key +
      // provider config are in the gateway BEFORE the mint below binds the VK to
      // that key. provisionProviders is idempotent and memoized (steady-state =
      // one GET per provider, no writes), so this is cheap on a reused session.
      // Its failure is best-effort HERE because it surfaces downstream as the
      // mint's fail-closed error (no key to bind to) rather than a silently
      // over-permissive key.
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
          '[runExternalAgentTurn] gateway provider provisioning failed (continuing; mint fails closed if no key):',
          provisionErr,
        );
      }

      // The gateway AUTH POSTURE is fail-CLOSED, not best-effort. applyGatewayConfig
      // sets enforce_auth_on_inference + enforce_governance_header — the controls
      // that require a minted VK and enforce its allowed_models on the inference
      // path. Swallowing a failure here could leave the gateway accepting
      // un-keyed or model-unrestricted inference (fail-open), defeating the whole
      // per-turn VK model. Let it throw: the run catch finalizes the turn as
      // failed and the user retries, rather than running against an unguarded
      // gateway.
      await applyGatewayConfig();

      // 2. Inject Tier-2 integration credentials. Per-turn (not just at
      // create) so reused sessions pick up rotations; the broker audits
      // every fetch and skips grants without an active credential.
      // Gate on the agent's integrationBindings so the in-container env token
      // is injected only for explicitly-bound integrations — the same grant
      // set written to scope.integrationGrants for the dispatch bridge below.
      const brokerGrants = BROKERABLE_GRANTS.filter((g) =>
        (args.integrationBindings ?? []).includes(g),
      );
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
            console.warn(
              '[runExternalAgentTurn] session env names denied by runnerd:',
              denied,
            );
          }
        }
      } catch (credErr) {
        console.warn(
          '[runExternalAgentTurn] credential injection failed (continuing without):',
          credErr,
        );
      }

      // 2b. Materialize the org's integrations as CC-native skills so the agent
      // knows what's available + how to call the dispatch tool (readiness-
      // independent text; connection state comes from the tool result). Staged
      // per-turn → a connect/disconnect/binding change shows up next turn.
      // Best-effort: skill staging must never fail the turn.
      try {
        await stageIntegrationSkills(ctx, {
          organizationId: args.organizationId,
          sessionId,
        });
      } catch (skillErr) {
        console.warn(
          '[runExternalAgentTurn] integration skill staging failed (continuing):',
          skillErr,
        );
      }

      // 3. Mint a per-turn, model-scoped gateway key (revoked in finally).
      // Size its hard budget to the org's rolling-remaining cost (when a cost
      // cap applies) so Bifrost's own ceiling can't exceed the rolling cap even
      // between the seam-level budget checks; fall back to the flat per-turn
      // default when the org is uncapped. The turn-start gate in
      // start_agent_chat.ts already blocked a fully-exhausted budget, so a
      // started turn's remaining is > 0.
      let vkBudgetCents = TURN_BUDGET_CENTS;
      if (args.userId) {
        try {
          const budget = await ctx.runQuery(
            internal.governance.internal_queries.evaluateExternalAgentBudget,
            { organizationId: args.organizationId, userId: args.userId },
          );
          if (budget.rollingRemainingCents !== null) {
            vkBudgetCents = Math.max(
              1,
              Math.floor(budget.rollingRemainingCents),
            );
          }
        } catch (budgetErr) {
          console.warn(
            '[runExternalAgentTurn] budget sizing failed (using default):',
            budgetErr,
          );
        }
      }
      const vk = await mintVirtualKey({
        budgetCents: vkBudgetCents,
        allowedModels: [args.modelRef],
        organizationId: args.organizationId,
        sessionId,
      });
      mintedKeyId = vk.keyId;
      await ctx.runMutation(
        internal.sandbox.session_mutations.insertSessionToken,
        {
          organizationId: args.organizationId,
          sessionId,
          tokenHash: hashVirtualKey(vk.key),
          bifrostKeyId: vk.keyId,
          scope: {
            agentKind: args.agentKind,
            allowedModels: [args.modelRef],
            // The session's dispatch grant set = the agent's integrationBindings
            // (enforced by /api/integrations/execute). NOT the git-credential
            // slugs — git uses env injection (creds.env above), not the dispatch.
            integrationGrants: args.integrationBindings ?? [],
            budgetCents: vkBudgetCents,
          },
          expiresAt: Date.now() + 2 * 60 * 60 * 1000,
        },
      );

      // 4. Resume THIS thread's prior conversation, if any (a per-user sandbox
      // holds every thread's conversation — scope by thread, bounded to the
      // current session's lifetime).
      const agentSessionId = await ctx.runQuery(
        internal.sandbox.session_queries.latestAgentSessionId,
        { threadId: args.threadId, sinceStartedAt: sessionCreatedAt },
      );

      debugLog('run', {
        threadId: args.threadId,
        sessionId,
        agentKind: args.agentKind,
        resume: agentSessionId !== null,
      });

      // 5. Run the agent — streams tool-use/text into sandboxSessionOps live.
      // Direct import, NOT ctx.runAction: the action-RPC hop is capped at
      // ~5 minutes in self-hosted Convex, which kills the parent mid-turn
      // (and its finally then revokes the VK under the still-running agent).
      // 5a. Create the streaming assistant message BEFORE the run so its tool
      // timeline is persisted incrementally (onTimeline) and survives an early
      // end / handoff. Finalized to success/failed by handleTurnOutcome.
      const created = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: { role: 'assistant', content: '' },
        metadata: { status: 'pending' },
      });
      assistantMessageId = created.messageId;

      let turn: TurnContext = {
        organizationId: args.organizationId,
        sessionId,
        execId,
        threadId: args.threadId,
        agentKind: args.agentKind,
        modelRef: args.modelRef,
        assistantMessageId: created.messageId,
        mintedKeyId,
        continuationCount: 0,
        ...(args.permissionMode !== undefined && {
          permissionMode: args.permissionMode,
        }),
        ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
        ...(args.userId !== undefined && { userId: args.userId }),
        ...(args.streamId !== undefined && { streamId: args.streamId }),
      };

      // Narrowed copy for the closures below — flow narrowing on the mutable
      // outer `sessionId` (string | null, hoisted for the catch) doesn't
      // survive into function bodies.
      const liveSessionId: string = sessionId;

      // Stamp the durable-job fields on the op row up front so a continuation
      // action OR the recovery watchdog can resume/finalize THIS turn even if
      // this action dies (crash / 30min ceiling). Also re-stamped for the
      // retry exec below — keep the shape in stampTurnOpRow.
      const stampTurnOpRow = (id: string) =>
        ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
          organizationId: args.organizationId,
          sessionId: liveSessionId,
          threadId: args.threadId,
          execId: id,
          kind: 'agent-run',
          status: 'running',
          heartbeatAt: Date.now(),
          deadlineMs: Date.now() + EXEC_DEADLINE_MS,
          assistantMessageId: created.messageId,
          userId: args.userId ?? 'system',
          modelRef: args.modelRef,
          continuationCount: 0,
          ...(mintedKeyId !== null && { mintedKeyId }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          ...(args.streamId !== undefined && { streamId: args.streamId }),
        });
      await stampTurnOpRow(execId);

      // Compose the agent's own instructions with the plan-mode/steering
      // addendum + trust rules (pure, unit-tested in system_prompt.ts).
      const systemPromptAppend = buildSystemPromptAppend({
        systemInstructions: args.systemInstructions,
        permissionMode: args.permissionMode,
      });

      // Both attempts share ONE absolute action deadline — a fresh window for
      // the retry could cross the 30-min action ceiling, whose hard kill
      // skips the catch entirely.
      const actionDeadlineMs = Date.now() + ACTION_WINDOW_MS;
      const runAttempt = (id: string) =>
        runAgentInSessionImpl(ctx, {
          organizationId: args.organizationId,
          sessionId: liveSessionId,
          threadId: args.threadId,
          ...(args.streamId !== undefined && { streamId: args.streamId }),
          execId: id,
          agentSlug: args.agentKind,
          prompt: args.rawPrompt,
          // The agent CLI sends this verbatim to the gateway. Use the canonical
          // gateway routing so the request hits the SAME Bifrost record the VK
          // is bound to (per-model `<slug>__<modelId>` for custom providers;
          // `<slug>/<modelId>` for standard). Must match mintVirtualKey, which
          // derives the binding from the same resolver.
          model: resolveGatewayRoutingFromRef(args.modelRef).gatewayModel,
          ...(agentSessionId !== null && { agentSessionId }),
          ...(systemPromptAppend !== '' && { systemPromptAppend }),
          ...(args.permissionMode !== undefined && {
            permissionMode: args.permissionMode,
          }),
          gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
          gatewayToken: vk.key,
          integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
          timeoutMs: EXEC_DEADLINE_MS,
          budgetDeadlineMs: actionDeadlineMs,
          // Durable per-flush mirror: patch the streaming message with the
          // timeline-so-far. This is the record that survives cancel/timeout.
          onTimeline: async (content) => {
            lastContent = content;
            await patchStreamingMessage(ctx, created.messageId, content);
          },
        });

      let result = await runAttempt(execId);

      // One-shot automatic retry for a zero-output completion (empty-but-200
      // model response: the CLI exits 0 having produced nothing). Gated so it
      // can never fight the Stop flow, lose a steered message, or outrun the
      // action window; a second empty lands in handleTurnOutcome's honest
      // failure rendering.
      if (isEmptyCompletedTurn(result, args.permissionMode)) {
        const meta = await ctx.runQuery(
          internal.threads.internal_queries.getThreadMetadata,
          { threadId: args.threadId },
        );
        // Still THIS turn's live generation (a Stop flips status to idle; a
        // superseding turn rotates streamId).
        const stillLive =
          meta !== null &&
          meta.generationStatus === 'generating' &&
          (args.streamId === undefined || meta.streamId === args.streamId);
        // A consumed steer row's content lives only in the abandoned
        // attempt's transcript — retrying without it would drop the message.
        const steerInFlight = await ctx.runQuery(
          internal.threads.message_queue.countSteerInFlight,
          { threadId: args.threadId },
        );
        const windowLeftMs = actionDeadlineMs - Date.now();
        if (stillLive && steerInFlight === 0 && windowLeftMs > 2 * 60_000) {
          console.warn(
            '[runExternalAgentTurn] empty completed result — retrying once:',
            { threadId: args.threadId, execId, exitCode: result.exitCode },
          );
          const firstExecId = execId;
          const retryExecId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          // Order matters (crash safety): stamp exec-B's row FIRST, swap the
          // turn to it (the catch then finalizes B: VK revoke + gen clear),
          // and only then fence exec-A. The fence keeps the watchdog off A's
          // going-stale 'running' row — left unfenced it would run the FULL
          // side-effects in ~3min, revoking the VK under the live retry.
          await stampTurnOpRow(retryExecId);
          execId = retryExecId;
          turn = { ...turn, execId: retryExecId };
          try {
            // Claim A so no finalizer ever runs side-effects for it, then
            // park the row as terminal (status 'completed' + finishedAt).
            await ctx.runMutation(
              internal.sandbox.session_mutations.claimSessionOpFinalize,
              { sessionId, execId: firstExecId },
            );
            await ctx.runMutation(
              internal.sandbox.session_mutations.upsertSessionOp,
              {
                organizationId: args.organizationId,
                sessionId,
                threadId: args.threadId,
                execId: firstExecId,
                kind: 'agent-run',
                status: 'completed',
                ...(result.exitCode !== null && { exitCode: result.exitCode }),
              },
            );
            result = await runAttempt(retryExecId);
          } catch (fenceErr) {
            // Fence failed → A may still be claimable by the watchdog, so the
            // retry MUST not run. Park B instead and fall through with the
            // attempt-1 result (honest empty failure).
            console.warn(
              '[runExternalAgentTurn] empty-turn retry fence failed — skipping retry:',
              fenceErr,
            );
            try {
              await ctx.runMutation(
                internal.sandbox.session_mutations.claimSessionOpFinalize,
                { sessionId, execId: retryExecId },
              );
              await ctx.runMutation(
                internal.sandbox.session_mutations.upsertSessionOp,
                {
                  organizationId: args.organizationId,
                  sessionId,
                  threadId: args.threadId,
                  execId: retryExecId,
                  kind: 'agent-run',
                  status: 'completed',
                },
              );
            } catch (parkErr) {
              console.warn(
                '[runExternalAgentTurn] empty-turn retry park failed:',
                parkErr,
              );
            }
            execId = firstExecId;
            turn = { ...turn, execId: firstExecId };
          }
        } else {
          console.warn(
            '[runExternalAgentTurn] empty completed result — not retrying:',
            {
              threadId: args.threadId,
              execId,
              stillLive,
              steerInFlight,
              windowLeftMs,
            },
          );
        }
      }

      // 6. Dispatch: TERMINAL → finalize the message + VK revoke + usage ledger;
      // 'continued' → checkpoint to _storage + schedule the continuation action
      // (the >30min handoff; no finalize, the turn keeps going).
      await handleTurnOutcome(ctx, turn, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runExternalAgentTurn] failed:', {
        threadId: args.threadId,
        agentKind: args.agentKind,
        error: message,
      });
      // Self-heal: a reused session gone spawner-side mid-turn (container
      // stopped/crashed) leaves a live platform row that would 404 every future
      // turn. The workspace is PRESERVED (stop ≠ destroy), so mark the row
      // `stopped` — the next turn RESUMES it in place (re-attach, same
      // incarnation), not a fresh empty sandbox.
      if (err instanceof SessionNotFoundError && sessionId !== null) {
        await ctx
          .runMutation(
            internal.sandbox.session_mutations.markSessionRowStopped,
            { organizationId: args.organizationId, sessionId },
          )
          .catch((e) =>
            console.warn('[runExternalAgentTurn] self-heal stop failed:', e),
          );
      }
      // handleTurnOutcome seals a segment as 'success' BEFORE its later steps
      // (save next message / checkpoint / schedule continuation). If one of
      // those throws we land here, but the segment is already a legitimate
      // success — overwriting it with 'failed' would corrupt a completed turn,
      // and finalizing would revoke the VK of a continued turn whose exec is
      // still running. Re-read the status (mirrors cancel_generation.ts:70) and,
      // when it's already 'success', leave the row for the recovery watchdog.
      let alreadySucceeded = false;
      if (assistantMessageId !== null) {
        try {
          const recent = await listMessages(ctx, components.agent, {
            threadId: args.threadId,
            paginationOpts: { numItems: 10, cursor: null },
            excludeToolMessages: true,
          });
          alreadySucceeded = recent.page.some(
            (m) => m._id === assistantMessageId && m.status === 'success',
          );
        } catch (statusErr) {
          console.warn(
            '[runExternalAgentTurn] could not re-read message status before failover:',
            statusErr,
          );
        }
      }
      try {
        if (alreadySucceeded) {
          // Post-success side-effect failure: the turn's message is a genuine
          // success and the op row is left UNfinalized for the recovery
          // watchdog to resume/finalize — do not overwrite or revoke here.
          console.warn(
            '[runExternalAgentTurn] failure after a segment was sealed success; leaving the op for recovery:',
            message,
          );
        } else if (assistantMessageId !== null && sessionId !== null) {
          // The streaming message already holds the partial tool timeline
          // (patched live via onTimeline). Mark it failed and APPEND the reason
          // rather than discarding the history with a bare error string — this
          // is the fix for "cancel/timeout wipes the tool calls".
          await patchStreamingMessage(
            ctx,
            assistantMessageId,
            withErrorNote(lastContent, message),
            'failed',
          );
          // Terminal side-effects, exactly-once (the op row was stamped before
          // the run, so the claim succeeds here).
          await finalizeTurnSideEffects(ctx, {
            organizationId: args.organizationId,
            sessionId,
            execId,
            threadId: args.threadId,
            agentKind: args.agentKind,
            modelRef: args.modelRef,
            assistantMessageId,
            mintedKeyId,
            continuationCount: 0,
            ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
            ...(args.userId !== undefined && { userId: args.userId }),
            ...(args.streamId !== undefined && { streamId: args.streamId }),
          });
        } else {
          // Failed before the streaming message + op row existed (e.g. session
          // create). Save a fresh failed bubble; revoke the VK directly (no op
          // row to claim) + clear the generation status.
          await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            message: {
              role: 'assistant',
              content: `External agent run failed: ${message}`,
            },
            metadata: { status: 'failed', error: message },
          });
          if (mintedKeyId !== null) {
            await revokeVirtualKey(mintedKeyId).catch((e) =>
              console.warn('[runExternalAgentTurn] VK revoke failed:', e),
            );
          }
          if (args.streamId) {
            await ctx
              .runMutation(
                internal.threads.internal_mutations.clearGenerationStatus,
                { threadId: args.threadId, streamId: args.streamId },
              )
              .catch((e) =>
                console.error('[runExternalAgentTurn] clear gen failed:', e),
              );
          }
        }
      } catch (saveErr) {
        console.error(
          '[runExternalAgentTurn] also failed to finalize error:',
          saveErr,
        );
      }
    }

    return null;
  },
});
