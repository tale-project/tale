'use node';

/**
 * The turn entry point.
 *
 * This is the thin host around the pure pipeline in `lib/chat/turn.ts`: it
 * resolves the real dependencies — the model call, the thread store, the usage
 * ledger, the harness table — and hands them to `runTurn`, which owns the
 * ORDER of a turn (guardrails, context, stream, ledger). Nothing about that
 * order lives here; this file only supplies the ports.
 *
 * The model is ALWAYS explicit. The caller names a model id; the catalog entry
 * behind it is resolved for the organization, the credential is resolved
 * through `resolveProviderCredential`, and the wire is shaped for the
 * connector's declared dialect. There is no auto-selection and no routing.
 *
 * Only DIRECT execution is served here. A subscription credential, or a
 * request for sandbox execution, is refused with a reason rather than run
 * through a path that does not exist yet — the sandbox harness lane is a
 * separate subsystem, and answering "not available, here is why" is honest
 * where a silent empty turn is not.
 */

import { ConvexError, v } from 'convex/values';

import {
  MAX_HISTORY_BUDGET_TOKENS,
  resolveEffectiveWindow,
} from '../../lib/chat/budget';
import {
  resolveTurnSampling,
  type ReasoningEffort,
} from '../../lib/chat/effort';
import { runTurn } from '../../lib/chat/turn';
import type {
  ModelCall,
  ModelStreamChunk,
  TurnDeps,
  TurnOutcome,
  TurnRequest,
} from '../../lib/chat/turn';
import {
  messageText,
  type ChatMessage,
  type TurnUsage,
} from '../../lib/chat/types';
import {
  classifyChatErrorCode,
  encodeChatError,
} from '../../lib/shared/chat-errors';
import { providerAttributionHeaders } from '../../lib/shared/providers/attribution';
import {
  buildHarnessTable,
  type CredentialAuth,
} from '../../lib/shared/providers/resolve_execution';
import type {
  ApiFormat,
  ModelCatalogEntry,
  ProviderConnector,
} from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { buildChatRequest } from '../automations_builder/chat_wire';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { getConnectorCatalog } from '../lib/providers/catalog_fetch';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveConnectorsForOrgId } from '../lib/providers/org_connectors';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { reasoningEffortValidator } from './schema';
import { createConvexTurnStore, createConvexUsageLedger } from './turn_store';

const REQUEST_TIMEOUT_MS = 180_000;
/** Enough of an upstream error to act on, never enough to leak a body. */
const ERROR_EXCERPT = 300;

// ------------------------------------------------------------- model lookup

interface ResolvedModel {
  readonly entry: ModelCatalogEntry;
  readonly connector: ProviderConnector;
}

/** Find the catalog entry for an explicit model id in the org's connectors.
 * The connector that lists it is the one whose wire the turn will speak.
 * A provider hint (the composer's picked section) is tried first, so two
 * providers serving the same id resolve to the copy the user chose; an
 * unmatched hint falls back to the id-only walk rather than refusing. */
async function resolveModel(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  providerSlug?: string,
): Promise<ResolvedModel> {
  const connectors = await resolveConnectorsForOrgId(ctx, organizationId);
  const ordered =
    providerSlug === undefined
      ? connectors
      : [
          ...connectors.filter((connector) => connector.name === providerSlug),
          ...connectors.filter((connector) => connector.name !== providerSlug),
        ];
  for (const connector of ordered) {
    const catalog = await getConnectorCatalog(connector);
    const entry = catalog.find((candidate) => candidate.id === modelId);
    if (entry) return { entry, connector };
  }
  throw new ConvexError({
    code: 'CHAT_MODEL_UNKNOWN',
    message: `No model "${modelId}" is available in this organization. Pick a model the organization has configured.`,
  });
}

// ------------------------------------------------------------- the model call

interface DirectWire {
  readonly apiFormat: ApiFormat;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly attribution: Record<string, string>;
}

/** Resolve the credential and endpoint for a direct call, refusing anything a
 * direct chat turn cannot serve. Mirrors the one resolution every direct model
 * call shares: a subscription credential is bound to a vendor harness and
 * cannot answer a chat endpoint. */
async function resolveDirectWire(
  ctx: ActionCtx,
  organizationId: string,
  connector: ProviderConnector,
): Promise<DirectWire> {
  const credential = await resolveProviderCredential(ctx, {
    organizationId,
    providerSlug: connector.name,
  });
  if (credential.authMethod !== 'api-key' && credential.authMethod !== 'env') {
    throw new ConvexError({
      code: 'CHAT_CREDENTIAL_UNSUPPORTED',
      message: `The default "${connector.name}" credential is a ${credential.authMethod} credential, which is bound to a vendor harness and only runs in a sandbox. Configure an API-key or environment-variable credential to chat with this model directly.`,
    });
  }
  const baseUrl = credential.endpointUrl ?? connector.baseUrl;
  if (!baseUrl) {
    throw new ConvexError({
      code: 'CHAT_PROVIDER_ENDPOINT_MISSING',
      message: `Provider "${connector.name}" has no API endpoint configured.`,
    });
  }
  return {
    apiFormat: connector.apiFormat,
    baseUrl,
    apiKey: credential.secret,
    attribution: providerAttributionHeaders({
      providerName: connector.name,
      baseUrl,
    }),
  };
}

/** Map the turn's messages onto the two roles a provider wire understands,
 * flattening each message's parts to their text surface. Tool and system
 * turns in the history read as their text; the assembled system prompt is
 * prepended so the connector's dialect shaping (system hoist for Anthropic)
 * applies to it too. */
function toWireMessages(
  system: string,
  messages: readonly ChatMessage[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const wire: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }> = [];
  if (system.trim().length > 0) wire.push({ role: 'system', content: system });
  for (const message of messages) {
    const role =
      message.role === 'assistant'
        ? 'assistant'
        : message.role === 'system'
          ? 'system'
          : 'user';
    wire.push({ role, content: messageText(message) });
  }
  return wire;
}

/** Read a numeric token count a provider may or may not have sent. */
function tokenCount(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

/** Pull the incremental text and any usage out of one streamed event, per the
 * connector's dialect. Returns empty text for the many control events (role
 * announcements, pings) that carry no content. */
function readEvent(
  apiFormat: ApiFormat,
  event: Record<string, unknown>,
  runningUsage: { input: number; output: number },
): { text: string; reasoning?: string; usage?: TurnUsage } {
  if (apiFormat === 'anthropic') {
    const type = event.type;
    if (type === 'message_start') {
      const message = asRecord(event.message);
      const usage = asRecord(message?.usage);
      if (usage) runningUsage.input = tokenCount(usage, 'input_tokens');
      return { text: '' };
    }
    if (type === 'content_block_delta') {
      const delta = asRecord(event.delta);
      if (delta?.type === 'thinking_delta') {
        const thinking =
          typeof delta.thinking === 'string' ? delta.thinking : '';
        return { text: '', ...(thinking ? { reasoning: thinking } : {}) };
      }
      const text = typeof delta?.text === 'string' ? delta.text : '';
      return { text };
    }
    if (type === 'message_delta') {
      const usage = asRecord(event.usage);
      if (usage) runningUsage.output = tokenCount(usage, 'output_tokens');
      return {
        text: '',
        usage: totals(runningUsage),
      };
    }
    return { text: '' };
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = asRecord(asRecord(choices[0])?.delta);
  const text = typeof delta?.content === 'string' ? delta.content : '';
  const reasoningDelta =
    typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta?.reasoning === 'string'
        ? delta.reasoning
        : '';
  const usage = asRecord(event.usage);
  if (usage) {
    runningUsage.input = tokenCount(usage, 'prompt_tokens');
    runningUsage.output = tokenCount(usage, 'completion_tokens');
    return {
      text,
      ...(reasoningDelta ? { reasoning: reasoningDelta } : {}),
      usage: totals(runningUsage),
    };
  }
  return { text, ...(reasoningDelta ? { reasoning: reasoningDelta } : {}) };
}

function totals(running: { input: number; output: number }): TurnUsage {
  return {
    inputTokens: running.input,
    outputTokens: running.output,
    totalTokens: running.input + running.output,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Read a provider's Server-Sent Events stream line by line, yielding each
 * `data:` payload as a chunk of cleared text (and the final usage when it
 * arrives). */
async function* streamSse(
  response: Response,
  apiFormat: ApiFormat,
): AsyncGenerator<ModelStreamChunk> {
  const body = response.body;
  if (!body) throw new Error('the model returned no response body to stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const running = { input: 0, output: 0 };
  let buffer = '';
  let lastUsage: TurnUsage | undefined;

  // oxlint-disable-next-line no-constant-condition -- reader.read() ends the loop
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data.length === 0 || data === '[DONE]') continue;
      let event: Record<string, unknown> | null;
      try {
        event = asRecord(JSON.parse(data));
      } catch {
        // A malformed keep-alive or partial frame is not fatal to a stream;
        // skip it rather than abandoning a turn mid-answer.
        continue;
      }
      if (!event) continue;
      const { text, reasoning, usage } = readEvent(apiFormat, event, running);
      if (usage) lastUsage = usage;
      if (text.length > 0 || reasoning !== undefined) {
        yield { text, ...(reasoning !== undefined ? { reasoning } : {}) };
      }
    }
  }
  if (lastUsage) yield { text: '', usage: lastUsage };
}

/** Build the real streaming model call for direct execution. The wire target
 * is resolved once and reused across the turn's chunks. */
export function createDirectModelCall(
  ctx: ActionCtx,
  organizationId: string,
  connector: ProviderConnector,
): ModelCall {
  let wire: DirectWire | null = null;
  return async function* directModelCall(
    request,
  ): AsyncGenerator<ModelStreamChunk> {
    if (request.execution.mode !== 'direct') {
      throw new ConvexError({
        code: 'CHAT_EXECUTION_UNAVAILABLE',
        message:
          'Sandbox execution is not available for chat turns yet — only direct model calls run here.',
      });
    }
    wire ??= await resolveDirectWire(ctx, organizationId, connector);

    // The sampling arrives fully resolved from the pipeline (`lib/chat/
    // effort.ts`): maxTokens as the reply ceiling, temperature only when the
    // turn may carry one (a thinking-enabled request must not), and the
    // reasoning control for the dialect shaping to spell.
    const base = buildChatRequest({
      apiFormat: wire.apiFormat,
      baseUrl: wire.baseUrl,
      modelId: request.model,
      apiKey: wire.apiKey,
      messages: toWireMessages(request.system, request.messages),
      ...(request.sampling.temperature !== undefined
        ? { temperature: request.sampling.temperature }
        : {}),
      maxTokens: request.sampling.maxTokens,
      ...(request.sampling.reasoning !== undefined
        ? { reasoning: request.sampling.reasoning }
        : {}),
      extraHeaders: wire.attribution,
    });
    // Reuse the dialect shaping, then flip streaming on. OpenAI-compatible
    // endpoints must be asked for a usage frame explicitly.
    const parsed: unknown = JSON.parse(base.body);
    const body = JSON.stringify({
      ...(isRecord(parsed) ? parsed : {}),
      stream: true,
      ...(wire.apiFormat === 'anthropic'
        ? {}
        : { stream_options: { include_usage: true } }),
    });

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await fetch(base.url, {
        method: 'POST',
        headers: base.headers,
        body,
        signal,
      });
    } catch (error) {
      throw new Error(
        `The model provider was unreachable: ${sanitizeError(error, ERROR_EXCERPT)}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // The HTTP status rides on the error so the chat-error classifier can
      // bucket it precisely (401/402/429…) instead of regexing the text.
      throw Object.assign(
        new Error(
          `The model provider answered ${response.status}: ${sanitizeError(detail, ERROR_EXCERPT)}`,
        ),
        { status: response.status },
      );
    }
    yield* streamSse(response, wire.apiFormat);
  };
}

// ----------------------------------------------------------------- the turn

export interface ExecuteTurnArgs {
  readonly organizationId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly userText: string;
  readonly modelId: string;
  readonly providerSlug?: string;
  /** The user's reasoning-effort pick; absent samples the default. */
  readonly reasoningEffort?: ReasoningEffort;
  readonly sandbox: boolean;
  readonly agentSlug?: string;
  readonly locale: string;
  /** Re-run the thread's trailing user message (a regenerate): `userText` is
   * that message's text and the pipeline must not append it again. */
  readonly resend?: boolean;
}

/** Overridable ports, for tests only — production resolves the real ones. The
 * same seam `lib/chat/backends.ts` uses to swap the connector dispatcher. */
export interface ExecuteTurnOverrides {
  readonly model?: ModelCall;
  readonly deps?: Partial<TurnDeps>;
}

/** Turns never carry more equipped skills than this — the picker is a
 * per-conversation assembly, not a library dump. */
const EQUIPPED_SKILLS_MAX = 8;

/**
 * Load the equipped skills' instructions for the DIRECT lane — the
 * counterpart of the sandbox lane's staged bundles. Visibility and the chat
 * usage-mode gate run inside `readSkill`; a skill that fails to load is
 * skipped, never a blocked turn.
 */
async function loadEquippedSkills(
  ctx: ActionCtx,
  organizationId: string,
  userId: string,
  slugs: readonly string[],
): Promise<Array<{ slug: string; instructions: string }>> {
  if (slugs.length === 0) return [];
  try {
    const orgSlug = await orgSlugFromId(ctx, organizationId);
    const viewer = await ctx.runQuery(
      internal.skills.viewer_context.getUserSkillViewerContext,
      { organizationId, userId },
    );
    if (viewer === null) return [];
    const out: Array<{ slug: string; instructions: string }> = [];
    for (const slug of slugs.slice(0, EQUIPPED_SKILLS_MAX)) {
      const doc = await ctx.runAction(internal.skills.file_actions.readSkill, {
        orgSlug,
        slug,
        viewer: {
          kind: 'user',
          userId,
          teamIds: viewer.teamIds,
          isOrgAdmin: viewer.isOrgAdmin,
        },
        surface: 'chat',
      });
      if (doc !== null && doc.body.length > 0) {
        out.push({ slug, instructions: doc.body });
      }
    }
    return out;
  } catch (error) {
    console.warn('[chat] equipped skills could not load', error);
    return [];
  }
}

/**
 * Run one turn end to end: load the thread's history, resolve the model and
 * ports, and hand everything to the pure pipeline. Kept as a plain async
 * function so a test can drive it with a fake model call and a supplied action
 * context — the whole turn runs against the real tables without a Node
 * runtime or a network.
 */
export async function executeTurn(
  ctx: ActionCtx,
  args: ExecuteTurnArgs,
  overrides: ExecuteTurnOverrides = {},
): Promise<TurnOutcome> {
  const resolved = await resolveModel(
    ctx,
    args.organizationId,
    args.modelId,
    args.providerSlug,
  );

  // Resolve the effort → sampling and the effective window FIRST: the
  // history read is bounded by the same budget the context assembly fits
  // into, so a long thread never materializes whole. The internal read also
  // frees the scheduled API-key lane from session auth the public query
  // demands.
  const sampling = resolveTurnSampling(resolved.entry, args.reasoningEffort);
  const governanceCap = await ctx.runQuery(
    internal.governance.queries.getContextCapInternal,
    { organizationId: args.organizationId, userId: args.userId },
  );
  const windowTokens = resolveEffectiveWindow({
    contextWindow: resolved.entry.contextWindow,
    governanceMaxContext: governanceCap,
  });
  const historyTokenBudget = Math.min(
    Math.max(0, windowTokens - sampling.maxTokens),
    MAX_HISTORY_BUDGET_TOKENS,
  );
  const {
    messages: stored,
    omittedCount,
    equippedSkills: equippedSlugs,
  } = await ctx.runQuery(internal.chat.messages.listRecentForTurnInternal, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    // Twice the token budget at ~4 chars/token: enough slack that the
    // token-exact fit happens in assembly, not here.
    maxChars: historyTokenBudget * 4 * 2,
    maxRows: 500,
  });
  // A resend re-runs the trailing user message: its text becomes the turn's
  // input, it leaves the history (the context assembly re-appends the input
  // as the newest turn), and the pipeline skips persisting it again.
  const trailing = stored.at(-1);
  if (args.resend === true && (!trailing || trailing.role !== 'user')) {
    return {
      status: 'refused',
      steps: [],
      step: 'input-guardrails',
      reason:
        'Nothing to regenerate — the conversation does not end with your message.',
    };
  }
  const userText =
    args.resend === true && trailing !== undefined
      ? messageText({ role: 'user', parts: trailing.parts })
      : args.userText;
  const historyRows = args.resend === true ? stored.slice(0, -1) : stored;
  const history: ChatMessage[] = historyRows.map((message) => ({
    role: message.role,
    parts: message.parts,
  }));

  const model =
    overrides.model ??
    createDirectModelCall(ctx, args.organizationId, resolved.connector);

  const deps: TurnDeps = {
    harnesses: buildHarnessTable(loadHarnesses()),
    model,
    store: createConvexTurnStore(ctx),
    usage: createConvexUsageLedger(ctx, { pricing: resolved.entry.pricing }),
    ...overrides.deps,
  };

  const equippedSkills = await loadEquippedSkills(
    ctx,
    args.organizationId,
    args.userId,
    equippedSlugs,
  );

  const request: TurnRequest = {
    organizationId: args.organizationId,
    userId: args.userId,
    threadId: args.threadId,
    userText,
    history,
    ...(equippedSkills.length > 0 ? { equippedSkills } : {}),
    locale: args.locale,
    model: resolved.entry,
    ...(args.reasoningEffort !== undefined
      ? { reasoningEffort: args.reasoningEffort }
      : {}),
    budget: {
      maxTokens: windowTokens,
      reserveOutputTokens: sampling.maxTokens,
    },
    ...(omittedCount > 0 ? { historyOmittedCount: omittedCount } : {}),
    // Direct chat only serves platform-managed credentials; a subscription
    // credential is refused earlier, before the wire is built.
    credential: { authMethod: 'api-key' } satisfies CredentialAuth,
    executionMode: args.sandbox ? 'sandbox' : 'direct',
    ...(args.resend === true ? { appendUserMessage: false } : {}),
  };

  return runTurn(request, deps);
}

/**
 * Start a turn for the authenticated caller. Runs the turn to completion and
 * returns a compact acknowledgement — the conversation itself streams into the
 * `messages` and `generations` tables, which the client already subscribes to.
 *
 * The handler's return type is annotated explicitly: the turn's outcome type
 * is broad, and letting it flow into the generated API surface unannotated
 * would degrade the chat API's types.
 */
export const startTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    modelId: v.string(),
    providerSlug: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    sandbox: v.boolean(),
    agentSlug: v.optional(v.string()),
    locale: v.optional(v.string()),
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
    // A thread is user-private: only its owner may run turns into it. Without
    // this, org membership alone let any member write user+assistant messages
    // into another member's thread (listMessages returns [] for a foreign
    // thread, but the append path only checked org). The external lane already
    // gates on the same owned-thread query.
    const owned = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (owned === null) {
      return { status: 'refused', reason: 'This conversation does not exist.' };
    }
    // At most one turn per thread — refuse a concurrent send rather than let two
    // turns interleave and delete each other's generation row mid-stream.
    const busy = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (busy) {
      return {
        status: 'refused',
        reason: 'This conversation is already generating a response.',
      };
    }
    const outcome = await executeTurn(ctx, {
      organizationId: args.organizationId,
      userId: auth.userId,
      threadId: args.threadId,
      userText: args.userText,
      modelId: args.modelId,
      ...(args.providerSlug !== undefined && {
        providerSlug: args.providerSlug,
      }),
      ...(args.reasoningEffort !== undefined && {
        reasoningEffort: args.reasoningEffort,
      }),
      sandbox: args.sandbox,
      agentSlug: args.agentSlug,
      locale: args.locale ?? 'en',
    });
    return outcome.status === 'completed'
      ? { status: 'completed' }
      : { status: 'refused', reason: outcome.reason };
  },
});

/**
 * Re-run the thread's trailing user prompt — the "Try again" of a
 * regenerate-branch, first-class rather than a synthetic edit. The branch the
 * client passes already ends with the user message (`branchForRegenerate`
 * copied it), so the turn resends that text without appending it again. Same
 * ownership and busy gates as `startTurn`.
 */
export const regenerateTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    modelId: v.string(),
    providerSlug: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    agentSlug: v.optional(v.string()),
    locale: v.optional(v.string()),
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
    const owned = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (owned === null) {
      return { status: 'refused', reason: 'This conversation does not exist.' };
    }
    const busy = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (busy) {
      return {
        status: 'refused',
        reason: 'This conversation is already generating a response.',
      };
    }
    const outcome = await executeTurn(ctx, {
      organizationId: args.organizationId,
      userId: auth.userId,
      threadId: args.threadId,
      userText: '',
      modelId: args.modelId,
      ...(args.providerSlug !== undefined && {
        providerSlug: args.providerSlug,
      }),
      ...(args.reasoningEffort !== undefined && {
        reasoningEffort: args.reasoningEffort,
      }),
      sandbox: false,
      agentSlug: args.agentSlug,
      locale: args.locale ?? 'en',
      resend: true,
    });
    return outcome.status === 'completed'
      ? { status: 'completed' }
      : { status: 'refused', reason: outcome.reason };
  },
});

/**
 * Start a turn for a caller the REST surface authenticated with an organization
 * API key.
 *
 * The identity arrives EXPLICITLY because an API key has no Convex identity for
 * `requireOrgMembershipById` to read. Everything else is the same turn: the
 * thread must belong to the `(organizationId, userId)` pair — checked here
 * again, against the same owned-thread query the session action uses, because
 * this runs detached from the request that scheduled it — and a thread already
 * generating refuses rather than interleaving two turns.
 *
 * It is scheduled, not awaited: `POST /api/v1/threads/:id/messages` answers 202
 * and the caller polls the generation. A failure BEFORE the pipeline starts (an
 * unknown model id) would otherwise leave no trace at all, so it is recorded as
 * an assistant message carrying the error — the same shape the pipeline itself
 * writes for a mid-stream failure, which is what makes the failure visible to a
 * client that only reads messages.
 */
export const startTurnForApiKey = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    modelId: v.string(),
    providerSlug: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(v.literal('completed'), v.literal('refused')),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: 'completed' | 'refused'; reason?: string }> => {
    const owned = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        threadId: args.threadId,
      },
    );
    if (owned === null) {
      return { status: 'refused', reason: 'This conversation does not exist.' };
    }
    const busy = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (busy) {
      return {
        status: 'refused',
        reason: 'This conversation is already generating a response.',
      };
    }

    let outcome: TurnOutcome;
    try {
      outcome = await executeTurn(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        threadId: args.threadId,
        userText: args.userText,
        modelId: args.modelId,
        ...(args.providerSlug !== undefined && {
          providerSlug: args.providerSlug,
        }),
        // Direct execution only: the sandbox lane is started by its own action.
        sandbox: false,
        ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
        locale: args.locale ?? 'en',
      });
    } catch (error) {
      const reason =
        error instanceof ConvexError && typeof error.data === 'object'
          ? (readErrorMessage(error.data) ?? error.message)
          : error instanceof Error
            ? error.message
            : 'The turn could not be started.';
      await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
        organizationId: args.organizationId,
        threadId: args.threadId,
        role: 'assistant',
        parts: [],
        model: args.modelId,
        error: encodeChatError({
          code: classifyChatErrorCode(error),
          model: args.modelId,
          raw: reason,
        }),
      });
      return { status: 'refused', reason };
    }
    return outcome.status === 'completed'
      ? { status: 'completed' }
      : { status: 'refused', reason: outcome.reason };
  },
});

/** The `message` a coded ConvexError carries, when it carries one. */
function readErrorMessage(data: unknown): string | undefined {
  return isRecord(data) && typeof data.message === 'string'
    ? data.message
    : undefined;
}
