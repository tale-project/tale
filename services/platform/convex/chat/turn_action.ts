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

import { randomUUID } from 'node:crypto';

import { ConvexError, v } from 'convex/values';

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
import { api, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { buildChatRequest } from '../automations_builder/chat_wire';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getConnectorCatalog } from '../lib/providers/catalog_fetch';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveConnectorsForOrgId } from '../lib/providers/org_connectors';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { createConvexTurnStore, createConvexUsageLedger } from './turn_store';

/** A reply ceiling for a chat turn when the model declares none. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 180_000;
/** Enough of an upstream error to act on, never enough to leak a body. */
const ERROR_EXCERPT = 300;

// ------------------------------------------------------------- model lookup

interface ResolvedModel {
  readonly entry: ModelCatalogEntry;
  readonly connector: ProviderConnector;
}

/** Find the catalog entry for an explicit model id in the org's connectors.
 * The connector that lists it is the one whose wire the turn will speak. */
async function resolveModel(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
): Promise<ResolvedModel> {
  const connectors = await resolveConnectorsForOrgId(ctx, organizationId);
  for (const connector of connectors) {
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
): { text: string; usage?: TurnUsage } {
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
  const usage = asRecord(event.usage);
  if (usage) {
    runningUsage.input = tokenCount(usage, 'prompt_tokens');
    runningUsage.output = tokenCount(usage, 'completion_tokens');
    return { text, usage: totals(runningUsage) };
  }
  return { text };
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
      const { text, usage } = readEvent(apiFormat, event, running);
      if (usage) lastUsage = usage;
      if (text.length > 0) yield { text };
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

    const base = buildChatRequest({
      apiFormat: wire.apiFormat,
      baseUrl: wire.baseUrl,
      modelId: request.model,
      apiKey: wire.apiKey,
      messages: toWireMessages(request.system, request.messages),
      temperature: 0.7,
      maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
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
      throw new Error(
        `The model provider answered ${response.status}: ${sanitizeError(detail, ERROR_EXCERPT)}`,
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
  readonly sandbox: boolean;
  readonly agentSlug?: string;
  readonly locale: string;
}

/** Overridable ports, for tests only — production resolves the real ones. The
 * same seam `lib/chat/backends.ts` uses to swap the integration dispatcher. */
export interface ExecuteTurnOverrides {
  readonly model?: ModelCall;
  readonly deps?: Partial<TurnDeps>;
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
  const resolved = await resolveModel(ctx, args.organizationId, args.modelId);

  const history: ChatMessage[] = (
    await ctx.runQuery(api.chat.messages.listMessages, {
      organizationId: args.organizationId,
      threadId: args.threadId,
    })
  ).map((message) => ({ role: message.role, parts: message.parts }));

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

  const request: TurnRequest = {
    organizationId: args.organizationId,
    userId: args.userId,
    threadId: args.threadId,
    streamId: randomUUID(),
    userText: args.userText,
    history,
    locale: args.locale,
    model: resolved.entry,
    // Direct chat only serves platform-managed credentials; a subscription
    // credential is refused earlier, before the wire is built.
    credential: { authMethod: 'api-key' } satisfies CredentialAuth,
    executionMode: args.sandbox ? 'sandbox' : 'direct',
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
      sandbox: args.sandbox,
      agentSlug: args.agentSlug,
      locale: args.locale ?? 'en',
    });
    return outcome.status === 'completed'
      ? { status: 'completed' }
      : { status: 'refused', reason: outcome.reason };
  },
});
