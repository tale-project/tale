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

import { CHAT_ASSISTANT } from '../../lib/chat/assistant';
import { buildAudioTranscriptAppendix } from '../../lib/chat/audio-transcript';
import {
  MAX_HISTORY_BUDGET_TOKENS,
  resolveEffectiveWindow,
} from '../../lib/chat/budget';
import {
  resolveTurnSampling,
  type ReasoningEffort,
} from '../../lib/chat/effort';
import { CHAT_TOOL_DOCS, type ToolCallRequest } from '../../lib/chat/tools';
import { runTurn } from '../../lib/chat/turn';
import type {
  ModelCall,
  ModelStreamChunk,
  TurnAttachment,
  TurnDeps,
  TurnOutcome,
  TurnRequest,
} from '../../lib/chat/turn';
import {
  messageText,
  type ChatMessage,
  type MessagePart,
  type TurnUsage,
} from '../../lib/chat/types';
import {
  explodeMessagesForWire,
  type ChatWireMessage,
  type WireImage,
} from '../../lib/chat/wire-parts';
import {
  classifyChatErrorCode,
  encodeChatError,
} from '../../lib/shared/chat-errors';
import {
  CHAT_MAX_FILE_COUNT,
  isAudioOrVideo,
  isImage,
} from '../../lib/shared/file-types';
import { providerAttributionHeaders } from '../../lib/shared/providers/attribution';
import {
  buildHarnessTable,
  type CredentialAuth,
} from '../../lib/shared/providers/resolve_execution';
import type {
  ApiFormat,
  ModelCatalogEntry,
  ProviderDefinition,
} from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { buildChatRequest } from '../automations_builder/chat_wire';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { readBlobBytes } from '../lib/storage/blob_access';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { createChatToolExecutor } from './assistant_tools';
import { reasoningEffortValidator } from './schema';
import { createConvexTurnStore, createConvexUsageLedger } from './turn_store';

const REQUEST_TIMEOUT_MS = 180_000;
/** Enough of an upstream error to act on, never enough to leak a body. */
const ERROR_EXCERPT = 300;

// ------------------------------------------------------------- model lookup

interface ResolvedModel {
  readonly entry: ModelCatalogEntry;
  readonly connector: ProviderDefinition;
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
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);
  const ordered =
    providerSlug === undefined
      ? connectors
      : [
          ...connectors.filter((connector) => connector.name === providerSlug),
          ...connectors.filter((connector) => connector.name !== providerSlug),
        ];
  for (const connector of ordered) {
    const catalog = await getProviderCatalog(connector);
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
  connector: ProviderDefinition,
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

/** Read a numeric token count a provider may or may not have sent. */
function tokenCount(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

/** Like {@link tokenCount}, but absence stays `undefined` — for the cache
 * and reasoning counts only some dialects report, where a made-up zero
 * would render as a fact in the message-info panel. */
function optionalTokenCount(
  usage: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = usage?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** One tool call as it accumulates across streamed events: both dialects
 * announce id/name once and then drip the arguments as JSON fragments. */
export interface ToolCallDraft {
  id: string;
  name: string;
  argumentsJson: string;
}

/** Mutable per-stream decode state: running usage plus the tool-call drafts,
 * keyed by the provider's block/call index. Cache and reasoning counts stay
 * absent until the dialect reports one — Anthropic sends
 * `cache_read_input_tokens` (thinking bills inside `output_tokens`, so no
 * reasoning count); OpenAI-compatible usage frames carry both details
 * objects. */
export interface StreamDecodeState {
  readonly running: {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
  };
  readonly drafts: Map<number, ToolCallDraft>;
}

/** Pull the incremental text, any usage, and any tool-call fragments out of
 * one streamed event, per the connector's dialect. Returns empty text for
 * the many control events (role announcements, pings) that carry no
 * content; tool fragments accumulate on `state.drafts` and surface as one
 * chunk when the stream ends. Exported for its unit tests — fragment
 * accumulation across events is exactly the kind of seam a live stream hides. */
export function readEvent(
  apiFormat: ApiFormat,
  event: Record<string, unknown>,
  state: StreamDecodeState,
): { text: string; reasoning?: string; usage?: TurnUsage } {
  const runningUsage = state.running;
  if (apiFormat === 'anthropic') {
    const type = event.type;
    if (type === 'message_start') {
      const message = asRecord(event.message);
      const usage = asRecord(message?.usage);
      if (usage) {
        runningUsage.input = tokenCount(usage, 'input_tokens');
        const cached = optionalTokenCount(usage, 'cache_read_input_tokens');
        if (cached !== undefined) runningUsage.cached = cached;
      }
      return { text: '' };
    }
    if (type === 'content_block_start') {
      const block = asRecord(event.content_block);
      const index = typeof event.index === 'number' ? event.index : null;
      if (
        block?.type === 'tool_use' &&
        index !== null &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        state.drafts.set(index, {
          id: block.id,
          name: block.name,
          argumentsJson: '',
        });
      }
      return { text: '' };
    }
    if (type === 'content_block_delta') {
      const delta = asRecord(event.delta);
      if (delta?.type === 'thinking_delta') {
        const thinking =
          typeof delta.thinking === 'string' ? delta.thinking : '';
        return { text: '', ...(thinking ? { reasoning: thinking } : {}) };
      }
      if (delta?.type === 'input_json_delta') {
        const index = typeof event.index === 'number' ? event.index : null;
        const fragment =
          typeof delta.partial_json === 'string' ? delta.partial_json : '';
        const draft = index !== null ? state.drafts.get(index) : undefined;
        if (draft) draft.argumentsJson += fragment;
        return { text: '' };
      }
      const text = typeof delta?.text === 'string' ? delta.text : '';
      return { text };
    }
    if (type === 'message_delta') {
      const usage = asRecord(event.usage);
      if (usage) {
        runningUsage.output = tokenCount(usage, 'output_tokens');
        // Some Anthropic-compatible servers repeat the cache read count on
        // the closing delta rather than on message_start.
        const cached = optionalTokenCount(usage, 'cache_read_input_tokens');
        if (cached !== undefined) runningUsage.cached = cached;
      }
      return {
        text: '',
        usage: totals(runningUsage),
      };
    }
    return { text: '' };
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = asRecord(asRecord(choices[0])?.delta);
  const toolCallDeltas = Array.isArray(delta?.tool_calls)
    ? delta.tool_calls
    : [];
  for (const raw of toolCallDeltas) {
    const fragment = asRecord(raw);
    if (!fragment) continue;
    const index = typeof fragment.index === 'number' ? fragment.index : 0;
    const draft = state.drafts.get(index) ?? {
      id: '',
      name: '',
      argumentsJson: '',
    };
    if (typeof fragment.id === 'string' && fragment.id.length > 0) {
      draft.id = fragment.id;
    }
    const fn = asRecord(fragment.function);
    if (fn) {
      if (typeof fn.name === 'string' && fn.name.length > 0) {
        draft.name = draft.name.length > 0 ? draft.name : fn.name;
      }
      if (typeof fn.arguments === 'string') {
        draft.argumentsJson += fn.arguments;
      }
    }
    state.drafts.set(index, draft);
  }
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
    const cached = optionalTokenCount(
      asRecord(usage.prompt_tokens_details),
      'cached_tokens',
    );
    if (cached !== undefined) runningUsage.cached = cached;
    const reasoning = optionalTokenCount(
      asRecord(usage.completion_tokens_details),
      'reasoning_tokens',
    );
    if (reasoning !== undefined) runningUsage.reasoning = reasoning;
    return {
      text,
      ...(reasoningDelta ? { reasoning: reasoningDelta } : {}),
      usage: totals(runningUsage),
    };
  }
  return { text, ...(reasoningDelta ? { reasoning: reasoningDelta } : {}) };
}

/** Settle the accumulated tool-call drafts into parsed requests, in the
 * provider's index order. Arguments that fail to parse become `{}` with the
 * raw string kept, so the executor can answer with a correctable error. */
export function settleToolCalls(
  drafts: Map<number, ToolCallDraft>,
): ToolCallRequest[] {
  const ordered = [...drafts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, draft]) => draft)
    .filter((draft) => draft.name.length > 0);
  return ordered.map((draft, position) => {
    const id = draft.id.length > 0 ? draft.id : `call_${position}`;
    if (draft.argumentsJson.trim().length === 0) {
      return { id, name: draft.name, input: {} };
    }
    try {
      return { id, name: draft.name, input: JSON.parse(draft.argumentsJson) };
    } catch {
      // Not fatal: the executor reads `rawInput` and answers with a
      // structured invalid-arguments result the model can correct.
      return {
        id,
        name: draft.name,
        input: {},
        rawInput: draft.argumentsJson,
      };
    }
  });
}

function totals(running: StreamDecodeState['running']): TurnUsage {
  return {
    inputTokens: running.input,
    outputTokens: running.output,
    totalTokens: running.input + running.output,
    ...(running.cached !== undefined
      ? { cachedInputTokens: running.cached }
      : {}),
    ...(running.reasoning !== undefined
      ? { reasoningTokens: running.reasoning }
      : {}),
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
  const state: StreamDecodeState = {
    running: { input: 0, output: 0 },
    drafts: new Map(),
  };
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
      const { text, reasoning, usage } = readEvent(apiFormat, event, state);
      if (usage) lastUsage = usage;
      if (text.length > 0 || reasoning !== undefined) {
        yield { text, ...(reasoning !== undefined ? { reasoning } : {}) };
      }
    }
  }
  // The stream's settle chunk: the final usage and any tool calls the model
  // ended on, decoded from the accumulated fragments.
  const toolCalls = settleToolCalls(state.drafts);
  if (lastUsage !== undefined || toolCalls.length > 0) {
    yield {
      text: '',
      ...(lastUsage !== undefined ? { usage: lastUsage } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

/** Ceiling for one inlined image. The composer compresses images toward
 * 1 MB before upload; anything past this bound reads as its text surface
 * instead of becoming a request body the provider would reject. */
export const INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** The text surface an image attachment falls back to when it cannot ride
 * the wire as pixels — the same spelling `messageText` uses everywhere. */
function attachmentSurface(name: string): string {
  return `[attachment: ${name}]`;
}

function appendWireContent(message: ChatWireMessage, text: string): void {
  message.content =
    message.content.length > 0 ? `${message.content}\n\n${text}` : text;
}

/** Read one attachment's bytes and encode them for the wire, or `null` when
 * they cannot ride (unresolvable org, missing blob, over the inline bound) —
 * the caller then falls back to the text surface. Never throws: a broken
 * attachment must degrade the message, not end the turn. */
async function loadWireImage(
  ctx: ActionCtx,
  organizationId: string,
  ref: { fileId: string; name: string; mediaType: string },
): Promise<WireImage | null> {
  const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
  if (orgSlug === null) {
    console.warn(
      `[chat] org ${organizationId} unresolvable; attachment "${ref.name}" not inlined`,
    );
    return null;
  }
  try {
    const bytes = await readBlobBytes(ctx, orgSlug, ref.fileId);
    if (bytes.byteLength > INLINE_IMAGE_MAX_BYTES) {
      console.warn(
        `[chat] attachment "${ref.name}" is ${bytes.byteLength} bytes — over the ${INLINE_IMAGE_MAX_BYTES}-byte inline bound; sending its text surface instead`,
      );
      return null;
    }
    return {
      mediaType: ref.mediaType,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  } catch (error) {
    console.warn(
      `[chat] attachment "${ref.name}" could not be read for the wire: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return null;
  }
}

/**
 * Settle every lifted attachment ref on the exploded wire: a vision model
 * gets the image inlined as bytes (fetched once per turn per file — the
 * cache spans tool rounds); everything else — non-vision model, missing
 * blob, oversize image — falls back to the attachment's text surface so the
 * model still knows a file was there.
 */
export async function settleWireAttachments(
  ctx: ActionCtx,
  organizationId: string,
  messages: ChatWireMessage[],
  options: { vision: boolean; cache: Map<string, WireImage | null> },
): Promise<void> {
  for (const message of messages) {
    const refs = message.attachmentRefs;
    if (refs === undefined || refs.length === 0) continue;
    const images: WireImage[] = [];
    for (const ref of refs) {
      if (!options.vision) {
        appendWireContent(message, attachmentSurface(ref.name));
        continue;
      }
      let image = options.cache.get(ref.fileId);
      if (image === undefined) {
        image = await loadWireImage(ctx, organizationId, ref);
        options.cache.set(ref.fileId, image);
      }
      if (image === null) {
        appendWireContent(message, attachmentSurface(ref.name));
        continue;
      }
      images.push(image);
    }
    if (images.length > 0) message.images = images;
  }
}

/** Build the real streaming model call for direct execution. The wire target
 * is resolved once and reused across the turn's chunks. */
export function createDirectModelCall(
  ctx: ActionCtx,
  organizationId: string,
  connector: ProviderDefinition,
): ModelCall {
  let wire: DirectWire | null = null;
  /** Attachment bytes resolved this turn, by blob ref — a tool loop replays
   * the same user images every round and must not refetch them. */
  const imageCache = new Map<string, WireImage | null>();
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
    // Provider files may name a private-http endpoint (self-hosted model
    // server, e2e mock gateway) — the schema admits the shape, and THIS is
    // the request boundary that decides reachability: metadata endpoints are
    // refused always, private hosts unless the operator opted in with
    // TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1.
    checkProviderHostPolicy(wire.baseUrl);

    // Explode the parts, then settle attachments: image refs become inline
    // bytes for a vision model, text surfaces for everything else.
    const messages = explodeMessagesForWire(request.system, request.messages);
    await settleWireAttachments(ctx, organizationId, messages, {
      vision: request.vision === true,
      cache: imageCache,
    });

    // The sampling arrives fully resolved from the pipeline (`lib/chat/
    // effort.ts`): maxTokens as the reply ceiling, temperature only when the
    // turn may carry one (a thinking-enabled request must not), and the
    // reasoning control for the dialect shaping to spell.
    const base = buildChatRequest({
      apiFormat: wire.apiFormat,
      baseUrl: wire.baseUrl,
      modelId: request.model,
      apiKey: wire.apiKey,
      messages,
      ...(request.tools !== undefined && request.tools.length > 0
        ? { tools: request.tools }
        : {}),
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
  /** Uploaded files riding the message — image and audio/video blob
   * references the caller staged through the composer. Validated here
   * (count, type, org ownership) before anything reads their bytes.
   * Images ride the vision wire; audio/video become transcript text. */
  readonly attachments?: readonly TurnAttachment[];
  readonly modelId: string;
  readonly providerSlug?: string;
  /** The user's reasoning-effort pick; absent samples the default. */
  readonly reasoningEffort?: ReasoningEffort;
  readonly sandbox: boolean;
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

/**
 * The attachment gate: images (vision wire) and audio/video (transcription
 * → text), the composer's count cap re-enforced server-side, and — the part
 * that matters — every blob reference must belong to THIS organization and
 * not be trashed. Without the ownership walk a crafted call could name any
 * blob on the deployment and exfiltrate it through the model's eyes.
 * Documents are refused — they belong in Knowledge.
 */
async function validateTurnAttachments(
  ctx: ActionCtx,
  organizationId: string,
  attachments: readonly TurnAttachment[],
): Promise<string | null> {
  if (attachments.length > CHAT_MAX_FILE_COUNT) {
    return `A message can carry at most ${CHAT_MAX_FILE_COUNT} attachments.`;
  }
  const unsupported = attachments.find(
    (attachment) =>
      !isImage(attachment.fileType) && !isAudioOrVideo(attachment.fileType),
  );
  if (unsupported !== undefined) {
    return `Only image and audio/video attachments are supported in chat — remove "${unsupported.fileName}".`;
  }
  const owned = new Set(
    await ctx.runQuery(
      internal.file_metadata.internal_queries.filterStorageIdsInOrg,
      {
        organizationId,
        storageIds: attachments.map((attachment) => attachment.fileId),
      },
    ),
  );
  const foreign = attachments.find(
    (attachment) => !owned.has(attachment.fileId),
  );
  if (foreign !== undefined) {
    return `Attachment "${foreign.fileName}" was not found. Remove it and try again.`;
  }
  return null;
}

/**
 * Append each audio/video attachment's transcript (or a failure marker) to
 * the user text. The model never receives raw media bytes — the product
 * contract is "transcribe, then text". Images are left alone for the vision
 * wire. Called only on a fresh send; a regenerate already carries the
 * enriched text from the stored user turn.
 */
async function appendAudioTranscripts(
  ctx: ActionCtx,
  attachments: readonly TurnAttachment[],
  userText: string,
): Promise<string> {
  const media = attachments.filter((attachment) =>
    isAudioOrVideo(attachment.fileType),
  );
  if (media.length === 0) return userText;

  const entries = await Promise.all(
    media.map(async (attachment) => {
      const meta = await ctx.runQuery(
        internal.file_metadata.internal_queries.getByStorageId,
        { storageId: attachment.fileId },
      );
      return {
        fileName: attachment.fileName,
        status: meta?.transcriptionStatus,
        transcript: meta?.transcript,
        durationSec: meta?.transcriptionDurationSec,
        error: meta?.transcriptionError,
      };
    }),
  );
  return userText + buildAudioTranscriptAppendix(entries);
}

/** Rebuild the turn-attachment list from a stored user message's parts — how
 * a regenerate re-runs an image-carrying message without dropping its
 * images. A blob deleted since the original send degrades at the wire (text
 * surface), never here. */
function attachmentsFromParts(parts: readonly MessagePart[]): TurnAttachment[] {
  const attachments: TurnAttachment[] = [];
  for (const part of parts) {
    if (part.type === 'attachment' && part.fileId !== undefined) {
      attachments.push({
        fileId: part.fileId,
        fileName: part.name,
        fileType: part.mediaType,
        fileSize: part.sizeBytes ?? 0,
      });
    }
  }
  return attachments;
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
  // The model-access policy holds at the boundary, not just in the picker:
  // the composer already hides disallowed models, but a crafted call (or a
  // stale saved selection) must be refused here with the policy's own
  // wording, before any model resolution or history read.
  const access = await ctx.runQuery(
    internal.governance.queries.checkModelAccessInternal,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      modelId: args.modelId,
    },
  );
  if (!access.allowed) {
    return {
      status: 'refused',
      steps: [],
      step: 'input-guardrails',
      reason:
        access.reason ??
        `Model "${args.modelId}" is not available for your account.`,
    };
  }

  // Attachments are refused BEFORE any model resolution or history read: a
  // foreign blob reference must never get as far as a byte fetch.
  if (args.attachments !== undefined && args.attachments.length > 0) {
    const attachmentProblem = await validateTurnAttachments(
      ctx,
      args.organizationId,
      args.attachments,
    );
    if (attachmentProblem !== null) {
      return {
        status: 'refused',
        steps: [],
        step: 'input-guardrails',
        reason: attachmentProblem,
      };
    }
  }

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
  const { messages: stored, omittedCount } = await ctx.runQuery(
    internal.chat.messages.listRecentForTurnInternal,
    {
      organizationId: args.organizationId,
      threadId: args.threadId,
      // Twice the token budget at ~4 chars/token: enough slack that the
      // token-exact fit happens in assembly, not here.
      maxChars: historyTokenBudget * 4 * 2,
      maxRows: 500,
    },
  );
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
  // A resend rebuilds the trailing message from its parts: the TEXT parts
  // become the input (an attachment's `[attachment: …]` surface must not
  // leak into the resent prose), and the attachment parts ride again as the
  // turn's attachments — a regenerate must not silently drop the images.
  const trailingParts: readonly MessagePart[] =
    args.resend === true && trailing !== undefined ? trailing.parts : [];
  const baseUserText =
    args.resend === true && trailing !== undefined
      ? messageText({
          role: 'user',
          parts: trailingParts.filter((part) => part.type === 'text'),
        })
      : args.userText;
  const attachments =
    args.resend === true
      ? attachmentsFromParts(trailingParts)
      : (args.attachments ?? []);
  // Fresh sends inject audio/video transcripts into the user text. A
  // regenerate already carries that enrichment on the stored text parts —
  // re-appending would double the transcript.
  const userText =
    args.resend === true
      ? baseUserText
      : await appendAudioTranscripts(ctx, attachments, baseUserText);
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
    // The chat assistant's fixed three-tool loadout. A test that wants a
    // tool-free turn overrides `tools` with undefined.
    tools: createChatToolExecutor(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
    }),
    ...overrides.deps,
  };

  const request: TurnRequest = {
    organizationId: args.organizationId,
    userId: args.userId,
    threadId: args.threadId,
    userText,
    ...(attachments.length > 0 ? { attachments } : {}),
    history,
    // The one persona the chat page talks to — hardcoded, never a config
    // file — and the docs block for its fixed tool loadout.
    agent: CHAT_ASSISTANT,
    toolDocs: CHAT_TOOL_DOCS,
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
    attachments: v.optional(
      v.array(
        v.object({
          fileId: blobRefValidator,
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    modelId: v.string(),
    providerSlug: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    sandbox: v.boolean(),
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
      ...(args.attachments !== undefined && args.attachments.length > 0
        ? { attachments: args.attachments }
        : {}),
      modelId: args.modelId,
      ...(args.providerSlug !== undefined && {
        providerSlug: args.providerSlug,
      }),
      ...(args.reasoningEffort !== undefined && {
        reasoningEffort: args.reasoningEffort,
      }),
      sandbox: args.sandbox,
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
