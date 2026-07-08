'use node';

/**
 * Dev-only "direct HTTP" TTFT probe.
 *
 * Streams a message straight to the org's chat model through the SAME wrapped
 * model the chat pipeline uses (`createLanguageModel` via `resolveLanguageModel*`)
 * — but WITHOUT the @convex-dev/agent persistence / delta / scheduler layers.
 * It times the raw model response so a developer can compare:
 *
 *   pipeline `timeFromSendMs` / `timeToFirstReasoningMs`  (from message metadata)
 *   vs  direct  ttfb / first-reasoning / first-content     (from this probe)
 *
 * The delta is our backend overhead.
 *
 * `withTools` (default on when `agentSlug` is given) reproduces the agent's tool
 * set + the pipeline's STATIC system prefill (agent instructions + the always-on
 * untrusted-content rules + language directive, via the same buildSystemPrompt
 * the pipeline uses) so the prefill — and therefore the model's
 * time-to-first-reasoning — tracks the pipeline. It deliberately omits the
 * per-turn DYNAMIC blocks (personalization/memories, thread context, project
 * instructions): a post-hoc probe can't faithfully reconstruct that
 * point-in-time state, so the probe's prefill is a LOWER BOUND on the pipeline's
 * and `Direct` should read as a floor, not an exact replay. WITHOUT tools it's
 * the bare model+network floor.
 * Tool `execute` handlers are STRIPPED before sending: the schemas still count
 * toward prefill, but the model can never actually run a tool — a probe must
 * have zero side effects. We also abort at the first tool-call.
 *
 * Cost: this issues a REAL (billed) provider call and bypasses usageLedger /
 * budget enforcement. It aborts the moment first content (or a tool decision)
 * arrives so it never pays for a full completion, but it is not free — hence
 * the dev/admin gate.
 */

import { streamText, type ToolSet } from 'ai';
import { ConvexError, v } from 'convex/values';

import { action, type ActionCtx } from '../_generated/server';
import { loadConvexToolsAsObject } from '../agent_tools/load_convex_tools_as_object';
import { TOOL_NAMES, type ToolName } from '../agent_tools/tool_registry';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentFilePathFromRelative,
  type AgentJsonConfig,
} from '../agents/file_utils';
import { resolveAgentRelativePath } from '../agents/internal_actions';
import { isDeploymentEditor } from '../deployment/editors';
import { buildSystemPrompt } from '../lib/agent_response/build_system_prompt';
import type { UserPersonalization } from '../lib/agent_response/build_user_personalization';
import { readJsonFile } from '../lib/file_io';
import { buildCallProviderOptions } from '../lib/provider_options';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { resolveLanguageModelById } from '../providers/resolve_model';

/** Hard ceiling so a hung provider can't pin a node-action slot. */
const PROBE_TIMEOUT_MS = 30_000;
/** Don't send unbounded prompts to the provider. */
const MAX_PROMPT_CHARS = 8_000;

/**
 * Empty personalization for the probe's system prompt: it carries only the
 * STATIC prefill the pipeline always sends (untrusted-content rules + language
 * directive, via buildSystemPrompt) plus the agent's instructions — never a
 * user's point-in-time memories. The dynamic per-turn blocks (personalization,
 * thread context, project instructions) are intentionally omitted because a
 * post-hoc probe can't faithfully reconstruct them, so the probe's prefill is a
 * documented lower bound on the pipeline's (surfaced in the dialog copy).
 */
const EMPTY_PERSONALIZATION: UserPersonalization = {
  text: '',
  fingerprint: '',
  injectedMemoryIds: [],
  tokens: 0,
};

/**
 * Resolve a chat model for the probe, tolerant of the fact that `metadata.model`
 * is the provider's *response* id — which can carry a date/version suffix (e.g.
 * `deepseek/deepseek-v4-flash-20260423`) that the provider config does NOT
 * register (it lists the undated `deepseek/deepseek-v4-flash`). Tries the exact
 * id, then the undated form, then falls back to the org's chat-tagged model so a
 * dev probe never dead-ends on an unresolvable recorded id. The returned
 * `modelData.modelId` reflects what was actually measured.
 */
async function resolveProbeModel(
  ctx: ActionCtx,
  organizationId: string,
  modelId?: string,
) {
  if (modelId) {
    const candidates = [modelId, modelId.replace(/-\d{6,8}$/, '')].filter(
      (id, i, arr) => id.length > 0 && arr.indexOf(id) === i,
    );
    for (const id of candidates) {
      try {
        return await resolveLanguageModelById(ctx, {
          modelId: id,
          organizationId,
        });
      } catch (err) {
        console.warn(
          `[direct_ttft] model "${id}" not resolvable; trying next candidate`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return resolveLanguageModelWithFallback(ctx, { tag: 'chat', organizationId });
}

/**
 * Assemble the agent's tool set + system instructions to reproduce the
 * pipeline's prefill. Mirrors the pipeline's tool filter (rag_search/web gated
 * by mode; propose_memory dropped — personalization is off for a probe). Tool
 * `execute` handlers are stripped so the model can request a tool (prefill
 * parity) but the SDK can NEVER run one. Throws for image-generation agents
 * (they bypass streamText). Degrades to no-tools on a config read miss.
 */
async function assembleAgentTools(
  ctx: ActionCtx,
  organizationId: string,
  agentSlug: string,
): Promise<{ tools?: ToolSet; system?: string; toolCount: number }> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);
  // Folder-aware (chat/, github/, …) slug→path, flat fallback for system
  // agents / freshly-written files — matches the runtime config loaders.
  const rel = await resolveAgentRelativePath(orgSlug, agentSlug);
  const filePath = rel
    ? resolveAgentFilePathFromRelative(orgSlug, rel)
    : resolveAgentFilePath(orgSlug, agentSlug);
  const result = await readJsonFile<AgentJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseAgentJson,
  );
  if (!result.ok) {
    console.warn(
      `[direct_ttft] agent config "${agentSlug}" unreadable; probing without tools: ${result.message}`,
    );
    return { toolCount: 0 };
  }
  const cfg = result.data;
  if (cfg.primaryBehavior === 'image-generation') {
    throw new ConvexError({ code: 'NON_CHAT_AGENT' });
  }

  const km = cfg.knowledgeMode ?? 'off';
  const wm = cfg.webSearchMode ?? 'off';
  const names = (cfg.toolNames ?? []).filter((n): n is ToolName => {
    if (!(TOOL_NAMES as readonly string[]).includes(n)) return false;
    if (n === 'propose_memory') return false;
    if (n === 'rag_search' && km !== 'tool' && km !== 'both') return false;
    if (n === 'web' && wm !== 'tool' && wm !== 'both') return false;
    return true;
  });

  const loaded = loadConvexToolsAsObject(names);
  const stripped: Record<string, unknown> = {};
  for (const [name, toolDef] of Object.entries(loaded)) {
    if (toolDef && typeof toolDef === 'object') {
      // Drop `execute` so schemas reach the model (prefill) but the SDK can't
      // run the tool — a probe must be side-effect free.
      const schemaOnly: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(toolDef)) {
        if (key !== 'execute') schemaOnly[key] = value;
      }
      stripped[name] = schemaOnly;
    } else {
      stripped[name] = toolDef;
    }
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema-only tool objects structurally satisfy ToolSet; the registry produces AI SDK tools and we only removed `execute`
  const tools = stripped as ToolSet;
  // Reproduce the pipeline's STATIC system prefill through the same helper the
  // pipeline uses (so they can't drift): agent instructions + the always-present
  // base (untrusted-content rules + language directive). Per-turn dynamic blocks
  // stay empty (see EMPTY_PERSONALIZATION) — the probe's prefill is a lower bound.
  const system =
    buildSystemPrompt(
      cfg.systemInstructions || undefined,
      EMPTY_PERSONALIZATION,
      undefined,
      undefined,
      undefined,
    ) || undefined;
  return {
    tools: Object.keys(stripped).length > 0 ? tools : undefined,
    system,
    toolCount: Object.keys(stripped).length,
  };
}

export const measureDirectTtft = action({
  args: {
    organizationId: v.string(),
    message: v.string(),
    // Measure the SAME model a given message used (pass `metadata.model`).
    // Falls back to the org's chat-tagged model when omitted.
    modelId: v.optional(v.string()),
    // Reproduce this agent's tools + system instructions (pass
    // `metadata.agentSlug`) so the prefill matches the pipeline.
    agentSlug: v.optional(v.string()),
    // Include the agent's tools/system. Defaults ON when `agentSlug` is given;
    // set false to measure the bare model floor for comparison.
    withTools: v.optional(v.boolean()),
  },
  returns: v.object({
    modelId: v.string(),
    provider: v.string(),
    ttfbMs: v.optional(v.number()),
    firstReasoningMs: v.optional(v.number()),
    firstContentMs: v.optional(v.number()),
    totalMs: v.number(),
    promptChars: v.number(),
    toolCount: v.number(),
    systemChars: v.number(),
    aborted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Fail-closed dev/admin gate. Reuses the deployment-editor allowlist
    // (`TALE_DEPLOYMENT_CONFIG_ADMINS`); an empty/unset allowlist => nobody.
    // Enforced HERE (the UI button's visibility query is advisory only).
    const user = await getAuthUserIdentity(ctx);
    if (!isDeploymentEditor(user?.email)) {
      throw new ConvexError({ code: 'FORBIDDEN' });
    }

    const prompt = args.message.slice(0, MAX_PROMPT_CHARS);

    const { languageModel, modelData } = await resolveProbeModel(
      ctx,
      args.organizationId,
      args.modelId,
    );

    const probeAgentSlug =
      args.withTools !== false ? args.agentSlug : undefined;
    const { tools, system, toolCount } = probeAgentSlug
      ? await assembleAgentTools(ctx, args.organizationId, probeAgentSlug)
      : { tools: undefined, system: undefined, toolCount: 0 };

    const providerOptions = buildCallProviderOptions(modelData);
    const abort = new AbortController();
    const t0 = Date.now();
    let ttfbMs: number | undefined;
    let firstReasoningMs: number | undefined;
    let firstContentMs: number | undefined;
    let aborted = false;

    const timeout = setTimeout(() => {
      aborted = true;
      abort.abort();
    }, PROBE_TIMEOUT_MS);

    try {
      const result = streamText({
        model: languageModel,
        prompt,
        abortSignal: abort.signal,
        ...(system ? { system } : {}),
        ...(tools ? { tools } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      });

      // Drive the stream until the model's first post-reasoning output — answer
      // text OR a tool decision (with tools present it may call instead of
      // answer) — then abort so we don't pay for the whole completion. Reasoning
      // always streams first, so first-reasoning is captured either way.
      for await (const part of result.fullStream) {
        const now = Date.now();
        if (ttfbMs === undefined) ttfbMs = now - t0;
        if (part.type === 'reasoning-delta' && firstReasoningMs === undefined) {
          firstReasoningMs = now - t0;
        }
        if (part.type === 'text-delta' && firstContentMs === undefined) {
          firstContentMs = now - t0;
        }
        if (part.type === 'error') {
          // Surface provider/stream errors — but never echo the raw provider
          // body (it can carry the apiKey); cap to a short sanitized string.
          const msg =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          throw new ConvexError({
            code: 'PROBE_FAILED',
            message: msg.slice(0, 200),
          });
        }
        // First answer token or any tool-related part = the model has finished
        // its initial reasoning and produced output. Stop here.
        if (firstContentMs !== undefined || part.type.startsWith('tool-')) {
          aborted = true;
          abort.abort();
          break;
        }
      }
    } catch (err) {
      // Aborting after we captured timings surfaces as an AbortError — expected.
      // Anything else is a real failure; re-throw sanitized (no apiKey leak).
      if (!aborted) {
        if (err instanceof ConvexError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new ConvexError({
          code: 'PROBE_FAILED',
          message: msg.slice(0, 200),
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    return {
      modelId: modelData.modelId,
      provider: modelData.providerName,
      ttfbMs,
      firstReasoningMs,
      firstContentMs,
      totalMs: Date.now() - t0,
      promptChars: prompt.length,
      toolCount,
      systemChars: system?.length ?? 0,
      aborted,
    };
  },
});
