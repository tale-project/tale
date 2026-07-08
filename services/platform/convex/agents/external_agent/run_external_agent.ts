'use node';

/**
 * External-agent runtime — runs a coding agent (Claude Code / Cursor) inside
 * a sandbox session for one chat turn.
 *
 * Called for agents with `primaryBehavior === 'external-agent'`. Bypasses the
 * chat-loop generate_response pipeline: the user's message becomes one agent
 * run inside the thread's persistent sandbox session (`--resume` continues the
 * same conversation across turns). The agent's tool-use/text stream lands in
 * `sandboxSessionOps` live (via run_agent); this module saves the final
 * assistant text into the thread so the chat UI renders the reply, and owns
 * session lifecycle + the per-turn gateway virtual key.
 *
 * v1: empty `/workspace/repo` workspace (no repo attach); the agent clones with
 * the injected GITHUB_TOKEN if it needs a repo. The session is reused across
 * turns (owner = thread); the per-turn LLM key is minted and revoked here so no
 * plaintext gateway key is ever persisted.
 */

import { listMessages, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import {
  collectScrubCredentialEnvKeys,
  filterUserEnvForManagedAgentEnv,
} from '../../../lib/agent-adapters/credential-env';
import {
  getAgentCapabilities,
  getCredentialEnvKeys,
  getCredentialPolicy,
  getSkillsStageDir,
  usesGateway,
} from '../../../lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../../lib/agent-adapters/events';
import { resolveProductAgentKind } from '../../../lib/agent-adapters/events';
import {
  SANDBOX_WORKSPACE_ABS_ROOT,
  isValidSandboxWorkdir,
  resolveSandboxWorkdirAbs,
  sandboxWorkdirSessionPath,
} from '../../../lib/shared/sandbox-workdir';
import {
  formatModelRef,
  parseModelRef,
} from '../../../lib/shared/utils/model-ref';
import { components, internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import { buildSkillsGuidance } from '../../lib/skills/guidance';
import { toId } from '../../lib/type_cast_helpers';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import { isRotatableApiError } from '../../node_only/sandbox/agent_run_outcome';
import { stageBoundOrgSkills } from '../../node_only/sandbox/bound_org_skills';
import { browserViewEnabled } from '../../node_only/sandbox/browser_view';
import {
  SessionDuplicateError,
  SessionNotFoundError,
  SpawnerBusyError,
  sessionCreate,
  sessionDestroy,
  sessionEnvPatch,
  sessionIsAlive,
  sessionListFiles,
  sessionSetPinned,
  sessionStageFiles,
} from '../../node_only/sandbox/helpers/session_client';
import {
  reconcileBuiltinSkills,
  stageIntegrationSkills,
} from '../../node_only/sandbox/integration_skills';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRoutingFromRef,
  revokeVirtualKey,
} from '../../node_only/sandbox/llm_gateway_admin';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';
import {
  pickToken,
  type TokenSelection,
} from '../../node_only/sandbox/token_pool_select';
import {
  stageWorkflowSkills,
  workspaceIsTaleRepo,
} from '../../node_only/sandbox/workflow_skills';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import {
  type ResolvedLanguageModel,
  resolveLanguageModel,
  resolveLanguageModelById,
} from '../../providers/resolve_model';
import { isWaitFifoError } from '../../sandbox/admission';
import {
  sessionIdForThread,
  sessionIdForUser,
  userOwnerId,
} from '../../sandbox/session_naming';
import {
  SANDBOX_ADMISSION_GLOBAL_BACKOFF_MS,
  SANDBOX_ADMISSION_POLL_BACKOFF_MS,
} from '../../sandbox/sessions_schema';
import {
  UPLOADS_ABS_ROOT,
  buildAttachmentPreamble,
  buildAttachmentStagePlan,
  composePromptWithAttachments,
} from './attachment_files';
import { resolveExternalAgentExecModel } from './exec_model';
import {
  externalAgentVkAllowlist,
  pickExternalAgentExecFallback,
} from './resolve_external_agent_model';
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
// Data plane — the LLM gateway as seen from INSIDE the session container. (The
// management plane URL, SANDBOX_LLM_GATEWAY_URL, is read in llm_gateway_admin.ts.)
// Always the sandbox-network alias (it's hardcoded in the runtime NO_PROXY);
// kept separate from SANDBOX_LLM_GATEWAY_URL so host-run convex doesn't leak a
// host-only URL into the container (same split as SANDBOX_STORAGE_INTERNAL_BASE_URL).
const EXTERNAL_AGENT_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
// Convex HTTP-ACTIONS base the in-sandbox MCP bridge calls for integration
// dispatch (/api/integrations/*). Resolved on the SANDBOX network, so it must
// be an on-net alias — the `--internal`, SSRF-locked agent container can reach
// neither the host (host.docker.internal) nor :3210; only on-net dual-homed
// aliases (like `sandbox-llm-gateway`) work. Default `convex:3211` (the convex http-actions
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
// Token-source rotation: max credential attempts per turn (initial pick + up to
// 2 failovers) before the turn fails; and the window floor below which a new
// attempt is not started (an auth retry-storm must fit before the seam).
const MAX_TOKEN_ATTEMPTS = 3;
const TOKEN_ROTATION_MIN_WINDOW_MS = 90 * 1000;
// Live browser view (read-only mirror), operator-gated and default ON (opt-out
// via SANDBOX_BROWSER_VIEW=0). When on, the adapter attaches Playwright MCP to
// the session's externally-launched HEADED Chromium over CDP (instead of self-
// launching headless) so the browser can be mirrored read-only by x11vnc. This
// MUST agree with the SPAWNER's SANDBOX_BROWSER_VIEW: the spawner is what
// actually launches the session container with TALE_BROWSER_CDP=1 (the
// entrypoint's start_browser_stack), so a one-sided flag is a misconfig —
// platform-on/spawner-off attaches to a CDP endpoint that was never started (the
// MCP retries and the browser tools fail); spawner-on/platform-off wastes a
// headed browser the agent never attaches to. Read here because this node action
// is where the exec spec is built. NOTE (deployment): one env value drives both
// sides (browserViewEnabled mirrors the spawner's `?? true` default), so they
// stay in lockstep — it is a single deployment-level operator decision.
const BROWSER_VIEW_ENABLED = browserViewEnabled();

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

/**
 * Stage this turn's chat attachments into the sandbox and return the prompt with
 * an absolute-path preamble appended, plus the dirs to grant the agent. The
 * heavy bytes never pass through this action: storage mints a presigned URL and
 * the in-container daemon fetches it directly (sessionStageFiles, url mode).
 *
 * Best-effort: a storage miss or a daemon-side skip degrades to a "not
 * delivered" line in the preamble (so the agent never assumes a file it cannot
 * read), and a transport failure is swallowed — staging must not fail the turn.
 */
async function stageChatAttachments(
  ctx: ActionCtx,
  opts: {
    attachments: ReadonlyArray<{
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }>;
    promptMessageId: string;
    sessionId: string;
    rawPrompt: string;
  },
): Promise<{ prompt: string; additionalDirs: string[] }> {
  const plan = buildAttachmentStagePlan(opts.promptMessageId, opts.attachments);
  const entries: {
    path: string;
    url: string;
    absPath: string;
    fileType: string;
    diskName: string;
  }[] = [];
  for (const p of plan.planned) {
    const raw = await ctx.storage.getUrl(toId<'_storage'>(p.fileId));
    if (!raw) {
      plan.skipped.push({ name: p.diskName, reason: 'not_found' });
      continue;
    }
    entries.push({
      path: p.stagePath,
      url: toSandboxStorageUrl(raw),
      absPath: p.absPath,
      fileType: p.fileType,
      diskName: p.diskName,
    });
  }

  const stagedOk: { absPath: string; fileType: string }[] = [];
  if (entries.length > 0) {
    try {
      const result = await sessionStageFiles(
        opts.sessionId,
        entries.map((e) => ({ path: e.path, url: e.url })),
      );
      const skippedReason = new Map(
        result.skipped.map((s) => [s.path, s.reason]),
      );
      for (const e of entries) {
        const reason = skippedReason.get(e.path);
        if (reason !== undefined) {
          plan.skipped.push({ name: e.diskName, reason });
        } else {
          stagedOk.push({ absPath: e.absPath, fileType: e.fileType });
        }
      }
      if (result.skipped.length > 0) {
        console.warn(
          '[runExternalAgentTurn] some attachments were skipped:',
          result.skipped,
        );
      }
    } catch (err) {
      console.warn(
        '[runExternalAgentTurn] attachment staging failed (continuing):',
        err,
      );
      for (const e of entries) {
        plan.skipped.push({ name: e.diskName, reason: 'stage_failed' });
      }
    }
  }

  const preamble = buildAttachmentPreamble(stagedOk, plan.skipped);
  return {
    prompt: composePromptWithAttachments(opts.rawPrompt, preamble),
    additionalDirs: stagedOk.length > 0 ? [UPLOADS_ABS_ROOT] : [],
  };
}

/**
 * Resolve the vision model that backs the image-read polyfill hook for a
 * text-only managed agent. Prefers the agent's explicit `visionModel` (validated to be
 * vision-capable); a missing/unresolvable/non-vision preferred model falls back
 * to the provider registry's `vision`-tagged default (per-provider
 * `defaults.vision`, else the first `vision`-tagged model). Throws only when NO
 * vision model resolves at all (the caller then skips the polyfill, fail-open).
 */
async function resolveVisionModel(
  ctx: ActionCtx,
  opts: { organizationId: string; preferredRef?: string },
): Promise<ResolvedLanguageModel> {
  if (opts.preferredRef && opts.preferredRef !== 'default') {
    const parsed = parseModelRef(opts.preferredRef);
    try {
      const resolved = await resolveLanguageModelById(ctx, {
        modelId: parsed.modelId,
        ...(parsed.providerName !== undefined && {
          providerName: parsed.providerName,
        }),
        organizationId: opts.organizationId,
      });
      if (resolved.modelData.tags.includes('vision')) return resolved;
      // Operator configured a model that can't see images — warn and fall back
      // rather than wiring a bridge that would 404 on the first image.
      console.warn(
        `[runExternalAgentTurn] configured visionModel '${opts.preferredRef}' is not vision-capable; using the vision-tagged default instead`,
      );
    } catch (err) {
      console.warn(
        `[runExternalAgentTurn] configured visionModel '${opts.preferredRef}' did not resolve; using the vision-tagged default instead:`,
        err,
      );
    }
  }
  return resolveLanguageModel(ctx, {
    tag: 'vision',
    organizationId: opts.organizationId,
  });
}

export const runExternalAgentTurn = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    /** Model ref (`provider:model-id` or bare); scopes the minted VK. */
    modelRef: v.string(),
    rawPrompt: v.string(),
    systemInstructions: v.optional(v.string()),
    agentKind: v.union(
      v.literal('claude-code'),
      v.literal('cursor'),
      v.literal('opencode'),
      v.literal('hermes'),
      v.literal('gemini'),
      v.literal('codex'),
      v.literal('pi'),
      v.literal('openclaw'),
    ),
    /** Credential mode (default 'managed'). 'byo' bypasses the gateway / VK and
     * uses the user-injected sandbox credentials. The per-agent authMode is the
     * sole control; there is no separate org-level gate. */
    authMode: v.optional(v.union(v.literal('managed'), v.literal('byo'))),
    /** Opt the managed run into the runtime's native web tools (Claude Code
     * WebSearch/WebFetch), lifting the governed deny. Absent/false keeps the
     * governed default; BYO is native regardless. */
    nativeWebTools: v.optional(v.boolean()),
    /** Turn posture from the thread's plan/act toggle ('execute' when absent). */
    permissionMode: v.optional(
      v.union(v.literal('plan'), v.literal('execute')),
    ),
    /** Interaction posture from the thread's interactive/autonomous toggle
     * ('interactive' when absent). Autonomous = no human in the loop: the
     * human-in-loop seams (steering, plan/human-control cards, prose questions)
     * are suppressed. Carried for the whole turn. */
    interactionMode: v.optional(
      v.union(v.literal('interactive'), v.literal('autonomous')),
    ),
    streamId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    /** The agent's integration allowlist — the session's dispatch grant set
     * (which integrations `integration({slug})` may invoke). Enforced
     * server-side by /api/integrations/execute; defaults to none-granted. */
    integrationBindings: v.optional(v.array(v.string())),
    /** The agent's workspace-tool allowlist (`toolNames`, schema-restricted to
     * EXTERNAL_AGENT_TOOL_NAMES) — the session's workspace-tool grant set
     * (which platform tools `workspace_tool({tool})` may invoke). Enforced
     * server-side by /api/tools/execute; defaults to none-granted. */
    toolNames: v.optional(v.array(v.string())),
    /** Org custom skills bound on the agent — staged into the sandbox each turn
     * (workflow disciplines are auto-staged separately). */
    skillBindings: v.optional(v.array(v.string())),
    /** Per-agent vision model (managed external agents) backing the image-read
     * polyfill hook when the agent's own model is text-only. Preferred over the
     * provider registry's `vision`-tagged default; ignored for BYO. */
    visionModel: v.optional(v.string()),
    /** Agent-configured fallback model refs (`supportedModels[1:]`), resolved
     * dynamically in chat_turn_generate. Layered with the catalog entry's
     * `fallbackModelId` on the primary for managed gateway runs. */
    fallbackModelRefs: v.optional(v.array(v.string())),
    /** Chat attachments uploaded with this turn. Staged into the sandbox under
     * /user/uploads/<promptMessageId>/ and referenced by absolute path in the
     * prompt so the agent can read them (the in-process path instead inlines
     * images as multimodal parts). Org-ownership of each fileId is already
     * verified upstream in start_agent_chat before dispatch. */
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    /** `@`-pinned knowledge-base files (folder pins pre-expanded upstream).
     * External agents run no platform RAG, so pins are delivered as real
     * files: staged into the sandbox alongside the attachments (deduped by
     * blob). Access already resolved + authorized in chatWithAgentTurn. */
    referencedFiles: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
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

    // Owner identity for the sandbox session AND its park-on-capacity admission
    // ticket. Hoisted so the catch can re-park on a capacity wait. One sandbox
    // per (org, user) serves all the user's threads; thread-owned is the
    // no-userId fallback.
    const ownerType = args.userId ? OWNER_TYPE_USER : OWNER_TYPE_THREAD;
    const ownerId = args.userId
      ? userOwnerId(args.organizationId, args.userId)
      : args.threadId;

    try {
      // BYO ("bring your own credentials"): the per-agent authMode is the sole
      // control — no separate org-level enable gate (configuring an agent is
      // already a privileged action). Managed (default) is unchanged.
      const byo = args.authMode === 'byo';
      const productKind: ProductAgentSlug = resolveProductAgentKind(
        args.agentKind,
      );
      const gatewayRun = usesGateway(productKind, args.authMode);
      const capabilities = getAgentCapabilities(productKind);

      // Vision polyfill (managed only): when the agent's own model lacks the
      // `vision` tag, arm the image-read hook (tale-vision-read-hook) backed by a
      // vision model so a text-only agent can still read images (e.g. an
      // uploaded invoice). The model is the agent's explicit `visionModel` when
      // set, else the org's `vision`-tagged default (see resolveVisionModel).
      // The hook transcribes through the SAME gateway with the session key (no
      // provider key enters the container); the VK below is scoped to also allow
      // that model. BYO brings its own credential + model, so it is never
      // polyfilled. (visionTool/visionModel are passed to the adapter, which
      // sets the TALE_VISION_* env that arms the hook.)
      let visionTool = false;
      let visionModel: string | undefined; // gateway model id the hook transcribes with
      let visionModelRef: string | undefined; // tale ref added to the VK allowlist
      // Model-level fallback (managed only): the catalog entry's
      // `fallbackModelId` (e.g. Opus 4.8 behind the Fable default) rides along
      // to the adapter, which arms Claude Code's fallback chain — overload /
      // unavailability retries AND the content-based Fable classifier
      // fallback. The VK below is scoped to also allow it, else the gateway
      // 403s the fallback request and the turn fails anyway.
      const agentFallbackRefs = args.fallbackModelRefs ?? [];
      let fallbackModelRef: string | undefined; // catalog tale ref for the VK allowlist
      let fallbackModel: string | undefined; // gateway model id the chain requests
      // BYO ids (config-driven): a catalog-shaped modelRef (the shipped
      // defaults) names the model by its GATEWAY id, which the runtime's own
      // backend does not know. Which translation the backend needs is
      // per-adapter (`credentialPolicy.byoModelIdSource`): the vendor-native
      // `nativeModelId` for a direct-to-vendor runtime (Claude Code →
      // Anthropic), the catalog id itself for an OpenRouter-style backend
      // (Hermes → OpenRouter). Both ride to exec_model, which picks by
      // dialect. A raw id the user typed matches no catalog entry and passes
      // through unchanged (no override).
      let byoNativeModel: string | undefined;
      let byoCatalogModel: string | undefined;
      if (args.modelRef && args.modelRef !== 'default') {
        try {
          const parsed = parseModelRef(args.modelRef);
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
          if (byo) {
            byoNativeModel = agentEntry?.nativeModelId;
            byoCatalogModel = agentEntry?.id;
          }
          if (
            gatewayRun &&
            agentEntry?.fallbackModelId !== undefined &&
            agentEntry.fallbackModelId !== parsed.modelId
          ) {
            fallbackModelRef = formatModelRef({
              providerName: agentEntry.providerName,
              modelId: agentEntry.fallbackModelId,
            });
          }
          if (gatewayRun && !(agentEntry?.tags.includes('vision') ?? false)) {
            const vision = await resolveVisionModel(ctx, {
              organizationId: args.organizationId,
              ...(args.visionModel !== undefined && {
                preferredRef: args.visionModel,
              }),
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
          // catalog is unavailable — skip the polyfill, the fallback, and the
          // BYO native mapping (the agent just runs without them this turn,
          // BYO on the raw ref). Never fail the turn over a convenience
          // feature.
          console.warn(
            '[runExternalAgentTurn] catalog model resolution skipped (vision/fallback/native):',
            err,
          );
        }
      }
      // The session VK allows the agent's model plus (when polyfilling) the
      // vision model the bridge calls and (when configured) the fallback model
      // — else the gateway 403s those requests.
      const execFallbackRef = pickExternalAgentExecFallback(
        agentFallbackRefs,
        fallbackModelRef,
      );
      if (gatewayRun && execFallbackRef && execFallbackRef !== 'default') {
        try {
          fallbackModel =
            resolveGatewayRoutingFromRef(execFallbackRef).gatewayModel;
        } catch {
          // Raw gateway id (env-managed tail) — pass through.
          fallbackModel = execFallbackRef;
        }
      } else if (!gatewayRun && agentFallbackRefs.length > 0) {
        fallbackModel = agentFallbackRefs[0];
      }

      const allowedModels = externalAgentVkAllowlist(
        args.modelRef,
        agentFallbackRefs,
        fallbackModelRef,
        visionModelRef,
      );

      // 1. Reuse the user's persistent sandbox, or create one. One sandbox per
      // user PER ORG serves all their threads in that org — shared /workspace,
      // per-thread Claude conversation.
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
            // Park-on-capacity: if the org is at its session cap, this throws
            // WAIT_FIFO (caught below → re-schedule + "Queued for capacity")
            // instead of failing the turn. Claims the FIFO ticket atomically.
            ticket: { source: 'chat', threadId: args.threadId },
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
        // Park-on-capacity: the slot is now held by this session row, so drop
        // the FIFO ticket (it stops counting against the queue) and clear any
        // "Queued for capacity" flag set by a prior parked attempt.
        await ctx.runMutation(
          internal.sandbox.admission.deleteAdmissionTicket,
          {
            ownerType,
            ownerId,
          },
        );
        if (args.streamId) {
          await ctx.runMutation(
            internal.threads.internal_mutations.setGenerationQueued,
            { threadId: args.threadId, streamId: args.streamId, queued: false },
          );
        }
      }

      // EVERY turn (created OR reused): ensure the org's per-org upstream key +
      // provider config are in the gateway BEFORE the mint below binds the VK to
      // that key. provisionProviders is idempotent and memoized (steady-state =
      // one GET per provider, no writes), so this is cheap on a reused session.
      // Its failure is best-effort HERE because it surfaces downstream as the
      // mint's fail-closed error (no key to bind to) rather than a silently
      // over-permissive key.
      // Provider provisioning + gateway auth-hardening apply only when the
      // runtime routes through the platform gateway (gateway-managed, not BYO
      // or env-managed managed runs like Cursor).
      if (gatewayRun) {
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

        // The gateway AUTH POSTURE is fail-CLOSED, not best-effort.
        // applyGatewayConfig sets enforce_auth_on_inference +
        // enforce_governance_header — the controls that require a minted VK and
        // enforce its allowed_models on the inference path. Swallowing a failure
        // here could leave the gateway accepting un-keyed or model-unrestricted
        // inference (fail-open), defeating the whole per-turn VK model. Let it
        // throw: the run catch finalizes the turn as failed and the user
        // retries, rather than running against an unguarded gateway.
        await applyGatewayConfig();
      }

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

      // 2a-pre. Scrub stale credential keys from reused sessions so a prior
      // runtime's env does not override this turn's injection order.
      try {
        const scrubKeys = collectScrubCredentialEnvKeys(
          productKind,
          gatewayRun,
          byo,
        );
        if (scrubKeys.length > 0) {
          await sessionEnvPatch(sessionId, { unset: scrubKeys });
        }
      } catch (scrubErr) {
        console.warn(
          '[runExternalAgentTurn] credential-env scrub failed (continuing):',
          scrubErr,
        );
      }

      const envManagedRun = !gatewayRun && !byo;
      const protectedEnvKeys = getCredentialEnvKeys(productKind);

      // 2a-mid / 2a-bis. Resolve agent + user env patches, then inject in an
      // order that matches the credential backend:
      //   env-managed managed → user first (filtered), agent wins on protected keys
      //   BYO / gateway-managed → agent first, user second (user wins on collision)
      let agentTokenBindings: { key: string; tokenSourceSlug: string }[] = [];
      let agentEnvPatch: Record<string, string> = {};
      if (args.agentSlug !== undefined) {
        try {
          const agentEnv = await ctx.runAction(
            internal.agents.agent_env_actions.resolveAgentEnv,
            {
              organizationId: args.organizationId,
              agentSlug: args.agentSlug,
              sessionId,
            },
          );
          agentTokenBindings = agentEnv.tokenBindings;
          agentEnvPatch = agentEnv.env;
        } catch (agentEnvErr) {
          console.warn(
            '[runExternalAgentTurn] agent env resolve failed (continuing):',
            agentEnvErr,
          );
        }
      }

      let userEnvPatch: Record<string, string> = {};
      if (args.userId) {
        try {
          const userEnv = await ctx.runAction(
            internal.sandbox.user_env_actions.resolveUserEnv,
            {
              organizationId: args.organizationId,
              userId: args.userId,
              sessionId,
            },
          );
          userEnvPatch = userEnv.env;
        } catch (userEnvErr) {
          console.warn(
            '[runExternalAgentTurn] user env resolve failed (continuing):',
            userEnvErr,
          );
        }
      }

      if (envManagedRun) {
        userEnvPatch = filterUserEnvForManagedAgentEnv(
          userEnvPatch,
          protectedEnvKeys,
        );
      }

      const envPatches = envManagedRun
        ? [userEnvPatch, agentEnvPatch]
        : [agentEnvPatch, userEnvPatch];

      for (const patch of envPatches) {
        if (Object.keys(patch).length === 0) continue;
        try {
          const denied = await sessionEnvPatch(sessionId, { set: patch });
          if (denied.length > 0) {
            console.warn(
              '[runExternalAgentTurn] session env names denied by runnerd:',
              denied,
            );
          }
        } catch (patchErr) {
          console.warn(
            '[runExternalAgentTurn] session env patch failed (continuing):',
            patchErr,
          );
        }
      }

      // 2a-ter. Token-source rotation (env-backed runs with a binding): fetch the
      // token source): fetch the broker pool, pick one at random, and inject it
      // under the BINDING's env var — AFTER user env so the rotated credential
      // wins for LLM auth. The run loop below fails over to a different token on
      // a rate-limit/auth error. v1 honors the first binding (warns if more).
      // Fail-fast: resolveTokenPool throws on an unreachable/empty/malformed
      // broker → the catch marks the turn failed.
      let tokenPool: {
        tokens: string[];
        targetEnvVar: string;
        selection: TokenSelection;
      } | null = null;
      const triedTokens = new Set<string>();
      if (!gatewayRun && agentTokenBindings.length > 0) {
        if (agentTokenBindings.length > 1) {
          console.warn(
            `[runExternalAgentTurn] ${agentTokenBindings.length} token-source bindings — v1 honors only the first (${agentTokenBindings[0].key}).`,
          );
        }
        const binding = agentTokenBindings[0];
        const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
        const pool = await ctx.runAction(
          internal.node_only.sandbox.token_source_pool.resolveTokenPool,
          {
            organizationId: args.organizationId,
            orgSlug,
            sessionId,
            slug: binding.tokenSourceSlug,
          },
        );
        // The binding's env var name wins over the source's default targetEnvVar.
        tokenPool = {
          tokens: pool.tokens,
          targetEnvVar: binding.key,
          selection: pool.selection,
        };
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

      // 2b-pre. Thread-scoped working directory (composer chip;
      // `threadMetadata.sandboxWorkdir`): the CLI process starts here each
      // turn, so a repo checked out under the workspace exposes its own
      // CLAUDE.md / project skills to the agent. Fail-open to the workspace
      // root — an invalid or not-yet-cloned path degrades the turn to today's
      // behaviour instead of failing it (the chip probes existence at save
      // time and documents this fallback).
      let workdirRel: string | undefined;
      try {
        const threadMeta = await ctx.runQuery(
          internal.threads.internal_queries.getThreadMetadata,
          { threadId: args.threadId },
        );
        const requested = threadMeta?.sandboxWorkdir;
        if (requested !== undefined && requested !== '') {
          if (!isValidSandboxWorkdir(requested)) {
            console.warn(
              '[runExternalAgentTurn] invalid sandboxWorkdir — running at workspace root:',
              { threadId: args.threadId, requested },
            );
          } else if (
            (await sessionListFiles(
              sessionId,
              sandboxWorkdirSessionPath(requested),
            )) === null
          ) {
            // null ⇒ spawner 404: the directory doesn't exist (yet).
            console.warn(
              '[runExternalAgentTurn] sandboxWorkdir missing in workspace — running at workspace root:',
              { threadId: args.threadId, requested },
            );
          } else {
            workdirRel = requested;
          }
        }
      } catch (workdirErr) {
        console.warn(
          '[runExternalAgentTurn] sandboxWorkdir resolution failed — running at workspace root:',
          workdirErr,
        );
      }

      // 2b. Materialize the org's integrations as CC-native skills so the agent
      // knows what's available + how to call the dispatch tool (readiness-
      // independent text; connection state comes from the tool result). Staged
      // per-turn → a connect/disconnect/binding change shows up next turn.
      // Best-effort: skill staging must never fail the turn.
      // Feeds the skills-guidance section of the system-prompt append: the
      // workflow skills the agent can actually load this turn + whether the
      // workspace is Tale's own monorepo (whose AGENTS.md already carries the
      // workflow, so the generated section is skipped there). The repo-skill
      // precedence scan follows the thread workdir — that's where the agent's
      // runtime will discover project skills.
      let availableWorkflowSkills: ReadonlySet<string> = new Set<string>();
      let workspaceIsTale = false;
      try {
        await stageIntegrationSkills(ctx, {
          organizationId: args.organizationId,
          sessionId,
          productKind,
          nativeWebTools: byo || args.nativeWebTools === true,
          ...(workdirRel !== undefined && { workdirRel }),
        });
        await reconcileBuiltinSkills(ctx, {
          sessionId,
          productKind,
          ...(workdirRel !== undefined && { workdirRel }),
        });
        await stageBoundOrgSkills(ctx, {
          organizationId: args.organizationId,
          sessionId,
          skillBindings: args.skillBindings,
          productKind,
          ...(workdirRel !== undefined && { workdirRel }),
        });
        availableWorkflowSkills = await stageWorkflowSkills(ctx, {
          organizationId: args.organizationId,
          sessionId,
          productKind,
          ...(workdirRel !== undefined && { workdirRel }),
        });
        workspaceIsTale = await workspaceIsTaleRepo(sessionId, workdirRel);
      } catch (skillErr) {
        console.warn(
          '[runExternalAgentTurn] integration skill staging failed (continuing):',
          skillErr,
        );
      }

      // 3. Mint a per-turn, model-scoped gateway key (MANAGED only; revoked in
      // finally). BYO never touches the gateway — the agent uses the user's own
      // credentials, so no VK is minted (mintedKeyId stays null and the finalize
      // path skips the spend-poll + revoke).
      let gatewayToken: string | null = null;
      if (gatewayRun) {
        // Size its hard budget to the org's rolling-remaining cost (when a cost
        // cap applies) so the gateway's own ceiling can't exceed the rolling cap
        // even between the seam-level budget checks; fall back to the flat
        // per-turn default when the org is uncapped. The turn-start gate in
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
          allowedModels,
          organizationId: args.organizationId,
          sessionId,
        });
        mintedKeyId = vk.keyId;
        gatewayToken = vk.key;
        await ctx.runMutation(
          internal.sandbox.session_mutations.insertSessionToken,
          {
            organizationId: args.organizationId,
            sessionId,
            tokenHash: hashVirtualKey(vk.key),
            llmGatewayKeyId: vk.keyId,
            scope: {
              agentKind: args.agentKind,
              allowedModels,
              // The session's dispatch grant set = the agent's
              // integrationBindings (enforced by /api/integrations/execute).
              integrationGrants: args.integrationBindings ?? [],
              budgetCents: vkBudgetCents,
              // Workspace-tool grant set + execution context for
              // /api/tools/execute. Grants and context both live on the
              // token row, so the container can neither widen the grant
              // set nor spoof another thread/user.
              toolGrants: args.toolNames ?? [],
              ...(args.agentSlug !== undefined && {
                agentSlug: args.agentSlug,
              }),
              threadId: args.threadId,
              ...(args.userId !== undefined && { userId: args.userId }),
            },
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
          },
        );
      }

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
        ...(args.interactionMode !== undefined && {
          interactionMode: args.interactionMode,
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

      // Deliver this turn's chat attachments AND `@`-pinned knowledge files
      // into the sandbox: stage each file under /user/uploads/ and reference
      // the absolute paths in the prompt so the agent reads the real files
      // (images load as vision). KB pins are deduped against attachments by
      // blob — the same file uploaded and pinned stages once. Adapters
      // without out-of-cwd attachment dirs skip staging. The in-process agent
      // path instead scopes RAG retrieval (and files uploads via
      // workspace_uploads); the external agent has no such channel.
      let promptForRun = args.rawPrompt;
      let attachmentDirs: string[] = [];
      const attachmentFileIds = new Set(
        (args.attachments ?? []).map((a) => a.fileId),
      );
      const filesToStage = [
        ...(args.attachments ?? []),
        ...(args.referencedFiles ?? []).filter(
          (ref) => !attachmentFileIds.has(ref.fileId),
        ),
      ];
      if (capabilities.supportsAttachmentDirs && filesToStage.length > 0) {
        const staged = await stageChatAttachments(ctx, {
          attachments: filesToStage,
          promptMessageId: args.promptMessageId,
          sessionId: liveSessionId,
          rawPrompt: args.rawPrompt,
        });
        promptForRun = staged.prompt;
        attachmentDirs = staged.additionalDirs;
      }

      // Compose the agent's own instructions with the plan-mode/steering
      // addendum + trust rules (pure, unit-tested in system_prompt.ts).
      const systemPromptAppend = buildSystemPromptAppend({
        systemInstructions: args.systemInstructions,
        permissionMode: args.permissionMode,
        interactionMode: args.interactionMode,
        browserCdp: BROWSER_VIEW_ENABLED,
        // Claude-Code-only: the staged workflow skills live in CC's user-level
        // skill dir. Skipped on the Tale monorepo workspace — its AGENTS.md
        // already carries the workflow and the house rules point at it.
        skillsGuidance:
          getSkillsStageDir(productKind) !== null && !workspaceIsTale
            ? buildSkillsGuidance(availableWorkflowSkills)
            : undefined,
      });

      // When the thread runs in a workspace subdir, the workspace root rides
      // along as an additional readable dir so root-level files and sibling
      // checkouts stay reachable from the agent's narrowed cwd.
      const agentAdditionalDirs =
        workdirRel !== undefined
          ? [...attachmentDirs, SANDBOX_WORKSPACE_ABS_ROOT]
          : attachmentDirs;

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
          prompt: promptForRun,
          ...(workdirRel !== undefined && {
            workdir: resolveSandboxWorkdirAbs(workdirRel),
          }),
          ...(agentAdditionalDirs.length > 0 && {
            additionalDirs: agentAdditionalDirs,
          }),
          // Live browser view (operator flag, default off): attach Playwright
          // MCP over CDP to the session's headed Chromium so it can be mirrored
          // read-only. Only set when on so the adapter's headless self-launch
          // stays byte-identical to today otherwise.
          ...(BROWSER_VIEW_ENABLED && { browserCdp: true }),
          // GATEWAY-managed: the canonical gateway routing so the request hits
          // the SAME gateway record the VK is bound to — must match
          // mintVirtualKey's resolver. BYO: the id the runtime's backend
          // speaks (gateway ids don't exist there) — vendor-native or catalog
          // per the adapter's dialect — else the raw ref. ENV-managed (e.g.
          // Cursor): the raw ref — its backend only knows native ids.
          // 'default'/empty → omit so the runtime uses its own default
          // (routing 'default' through the gateway mapper mints the invalid
          // `default__default/default`). Matrix in exec_model.ts.
          model: resolveExternalAgentExecModel({
            byo,
            gatewayRun,
            modelRef: args.modelRef,
            byoModelIdSource: getCredentialPolicy(productKind).byoModelIdSource,
            byoNativeModel,
            byoCatalogModel,
            toGatewayModel: (ref) =>
              resolveGatewayRoutingFromRef(ref).gatewayModel,
          }),
          // Managed model-level fallback (catalog fallbackModelId, VK-allowed
          // above). Never sent for BYO — the user's model list is not overridden.
          ...(fallbackModel !== undefined && { fallbackModel }),
          authMode: byo ? 'byo' : 'managed',
          ...(args.nativeWebTools !== undefined && {
            nativeWebTools: args.nativeWebTools,
          }),
          ...(agentSessionId !== null && { agentSessionId }),
          ...(systemPromptAppend !== '' && { systemPromptAppend }),
          ...(args.permissionMode !== undefined && {
            permissionMode: args.permissionMode,
          }),
          ...(args.interactionMode !== undefined && {
            interactionMode: args.interactionMode,
          }),
          // MANAGED only: route through the gateway with the minted VK and
          // expose the integration-dispatch bridge (authed by that key). BYO
          // carries no gateway/bridge — the agent uses the user-injected session
          // credentials directly.
          ...(!byo &&
            gatewayRun &&
            gatewayToken !== null && {
              gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
              gatewayToken,
              integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
            }),
          ...(visionTool &&
            visionModel !== undefined && { visionTool: true, visionModel }),
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

      // Token-source failover: on a rate-limit (429/529) or auth (401/403, raised
      // early as an auth-abort) terminal result, swap to a different token and
      // re-run — up to MAX_TOKEN_ATTEMPTS total, while enough window remains.
      // Reuses the empty-turn retry's exec-row turnover fence (stamp B → claim+
      // park A). A `running` handoff is not a failure and never rotates.
      // The durable workflow path has a sibling loop (workflow_sandbox_exec) that
      // also rotates on RESUMED segments via `--resume`; the two are deliberately
      // NOT shared — this one carries op-row fencing the workflow path lacks.
      let tokenAttempt = 1;
      if (tokenPool !== null) {
        const pool = tokenPool;
        while (
          result.status !== 'running' &&
          tokenAttempt < MAX_TOKEN_ATTEMPTS &&
          actionDeadlineMs - Date.now() > TOKEN_ROTATION_MIN_WINDOW_MS &&
          isRotatableApiError({
            isError: result.isError,
            apiErrorStatus: result.apiErrorStatus,
            terminationReason: result.terminationReason,
            authAbortStatus: result.authAbortStatus,
          })
        ) {
          const nextToken = pickToken(pool.tokens, triedTokens, pool.selection);
          if (nextToken === null) break; // no distinct token left → fail below
          triedTokens.add(nextToken);
          tokenAttempt += 1;
          await sessionEnvPatch(sessionId, {
            set: { [pool.targetEnvVar]: nextToken },
          });
          const prevExecId = execId;
          const retryExecId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          await stampTurnOpRow(retryExecId);
          execId = retryExecId;
          // Mutate the field (not `{ ...turn }`) — spreading the accumulator in
          // a loop is the no-accumulating-spread offense; turn is the same ctx.
          turn.execId = retryExecId;
          try {
            await ctx.runMutation(
              internal.sandbox.session_mutations.claimSessionOpFinalize,
              { sessionId, execId: prevExecId },
            );
            await ctx.runMutation(
              internal.sandbox.session_mutations.upsertSessionOp,
              {
                organizationId: args.organizationId,
                sessionId,
                threadId: args.threadId,
                execId: prevExecId,
                kind: 'agent-run',
                status: 'completed',
                ...(result.exitCode !== null && { exitCode: result.exitCode }),
              },
            );
          } catch (fenceErr) {
            console.warn(
              '[runExternalAgentTurn] token-rotation fence failed — stopping rotation:',
              fenceErr,
            );
            break;
          }
          console.warn(
            `[runExternalAgentTurn] token rotation: attempt ${tokenAttempt}/${MAX_TOKEN_ATTEMPTS} after status=${result.apiErrorStatus ?? result.authAbortStatus}`,
            { threadId: args.threadId },
          );
          result = await runAttempt(retryExecId);
        }
      }

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
      // 'running' (non-terminal handoff) → checkpoint to _storage + schedule the
      // continuation action (the >30min handoff; no finalize, the turn keeps going).
      await handleTurnOutcome(ctx, turn, result);
    } catch (err) {
      // Park-on-capacity (NOT a failure): the org is at its session cap
      // (WAIT_FIFO from reserve — ticket already waiting) or the global host is
      // at capacity (SpawnerBusyError from create — flip the claimed ticket back
      // to waiting to keep FIFO position). Nothing was built yet (no message /
      // op / VK; a 429-after-reserve already marked its row failed), so re-stamp
      // the thread "Queued for capacity" and re-schedule THIS turn. The wait is
      // unbounded by design — only the user cancelling, or a slot freeing (incl.
      // the ticket reaper clearing a dead head), ends it.
      if (isWaitFifoError(err) || err instanceof SpawnerBusyError) {
        if (err instanceof SpawnerBusyError) {
          await ctx
            .runMutation(internal.sandbox.admission.parkAdmissionTicket, {
              organizationId: args.organizationId,
              kind: 'session',
              ownerType,
              ownerId,
              source: 'chat',
              threadId: args.threadId,
            })
            .catch((e) =>
              console.warn('[runExternalAgentTurn] re-park failed:', e),
            );
        }
        const backoffMs = Math.min(
          Math.max(
            (err instanceof SpawnerBusyError ? err.retryAfterMs : undefined) ??
              SANDBOX_ADMISSION_POLL_BACKOFF_MS,
            1000,
          ),
          SANDBOX_ADMISSION_GLOBAL_BACKOFF_MS * 6,
        );
        if (args.streamId) {
          await ctx
            .runMutation(
              internal.threads.internal_mutations.setGenerationQueued,
              {
                threadId: args.threadId,
                streamId: args.streamId,
                queued: true,
              },
            )
            .catch((e) =>
              console.warn('[runExternalAgentTurn] mark queued failed:', e),
            );
        }
        await ctx.scheduler.runAfter(
          backoffMs,
          internal.agents.external_agent.run_external_agent
            .runExternalAgentTurn,
          args,
        );
        return null;
      }
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
      // and finalizing would revoke the VK of a handed-off turn whose exec is
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
