/**
 * Shared chat wire shaping: a conversation in, an HTTP request out,
 * and a provider payload back into text.
 *
 * Kept separate from the call itself (`model_call.ts`) because this part is
 * pure data mapping and deserves to be tested without a network, a
 * credential, or a Node runtime. Two formats exist because provider
 * connectors declare exactly two: OpenAI-compatible chat completions and
 * Anthropic messages. An OpenAI-compatible connector speaks a third body for
 * a model whose catalog entry says its function tools work only on the
 * Responses API (`toolCallingApi: responses`).
 *
 * Two shape rules matter and are easy to get wrong:
 *  - Anthropic takes the system prompt as a top-level parameter, not as a
 *    message (the Responses API too, as `instructions`). Consecutive
 *    Anthropic messages of the same role are merged here.
 *  - `max_tokens` is mandatory for Anthropic and caps the reply on OpenAI.
 */

import type {
  ApiFormat,
  ModelCatalogEntry,
  WireDialect,
} from '@tale/shared/schemas/providers';

import type { TurnSampling } from '../../../lib/chat/effort';
import type { WireTool } from '../../../lib/chat/tools';
import type { ChatWireMessage } from '../../../lib/chat/wire-parts';
import { isRecord } from '../../../lib/utils/type-utils';

export interface ChatWireRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChatWireReply {
  content: string;
  usage: { prompt: number; completion: number; reported?: boolean };
}

/**
 * A well-formed reply that carries no text — a thinking-by-default model
 * that spent its whole output cap reasoning, say. Distinct from a malformed
 * payload: the call happened and was billed, so the counts ride the error
 * for the caller to book, and a caller that can use nothing else still
 * learns what it paid. The message is the one every consumer already
 * matches on.
 */
export class EmptyReplyError extends Error {
  readonly usage: ChatWireReply['usage'];
  constructor(usage: ChatWireReply['usage']) {
    super('the model returned no text content');
    this.name = 'EmptyReplyError';
    this.usage = usage;
  }
}

export type {
  ChatWireMessage,
  WireToolCall,
  WireToolResult,
} from '../../../lib/chat/wire-parts';

export interface ChatWireArgs {
  apiFormat: ApiFormat;
  /**
   * The connector's declared dialect refinement (see `wireDialectSchema`).
   * `openai-modern` (api.openai.com, Azure v1) spells the output cap
   * `max_completion_tokens` and sends a custom temperature only for models
   * KNOWN not to reason. Absent keeps the classic OpenAI-compatible body
   * byte-identical to what it always was.
   */
  wireDialect?: WireDialect;
  /**
   * Whether the model declares a reasoning capability in its catalog entry —
   * absent when no catalog entry exists (credential-allowlist connectors like
   * Azure, or a free-typed model id). Two surfaces read it, and both treat
   * unknown as reasoning: the `openai-modern` dialect, where reasoning models
   * reject any non-default temperature, and the Anthropic wire, where every
   * model after Claude Opus 4.6 does (and an older one does while it thinks).
   */
  reasoningModel?: boolean;
  /**
   * The model's tool API, from its catalog entry. `responses` builds the
   * OpenAI Responses API body (`POST <base>/responses`) instead of Chat
   * Completions — the one wire on which such a model's function tools work.
   * Only an OpenAI-compatible connector can spell it. Absent keeps the
   * connector's own format.
   */
  toolCallingApi?: ModelCatalogEntry['toolCallingApi'];
  /** The connector's API origin, with or without a trailing slash. */
  baseUrl: string;
  modelId: string;
  apiKey: string;
  messages: ChatWireMessage[];
  /** The tool definitions to offer. Absent omits the parameter entirely, so
   * a tool-free body is byte-identical to what it was before tools existed
   * (the prompt-cache prefix must not move). */
  tools?: readonly WireTool[];
  /** Absent OMITS the parameter from the body — a thinking-enabled request
   * must not carry a custom temperature. */
  temperature?: number;
  maxTokens: number;
  /**
   * The turn's reasoning control, when one was resolved. EVERY body spells
   * an effort level — `reasoning_effort` on Chat Completions,
   * `reasoning.effort` on the Responses API, `output_config.effort` on the
   * Anthropic wire — each folding the step to its own vocabulary. A
   * thinking-token budget is an Anthropic-wire control alone; an OpenAI body
   * cannot spell it and drops it loudly.
   */
  reasoning?: TurnSampling['reasoning'];
  /** Provider attribution headers the platform sends where they apply. */
  extraHeaders?: Record<string, string>;
}

/** The Anthropic messages API is versioned by header, not by path. */
const ANTHROPIC_VERSION = '2023-06-01';

/** The effort values a resolved turn can carry — the user's five steps plus
 * the catalog's off literals. */
type EffortValue = Extract<
  NonNullable<TurnSampling['reasoning']>,
  { kind: 'effort' }
>['value'];

/**
 * The effort step as each surface spells it — the fold the resolver
 * deliberately does NOT apply, so neither endpoint is capped by the other's
 * vocabulary.
 *
 * OpenAI-compatible endpoints take three levels, so the top three steps all
 * land on `high`; the `off` literals a catalog may declare (`none`,
 * `minimal`) pass straight through, which is the whole point of declaring
 * them. Anthropic's `output_config.effort` takes all five, spelling the
 * fourth `xhigh` — but has no off literal at all, so an `off` declaration on
 * an Anthropic-wire model resolves to `undefined` and the parameter is left
 * off the body rather than guessed at. The Responses API takes all five too
 * (`xhigh`, `max`: the vendor's pages for the models that need this wire
 * list both) and passes the off literals through.
 */
const OPENAI_EFFORT_LEVELS = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'high',
  max: 'high',
} as const satisfies Record<EffortValue, string>;

const RESPONSES_EFFORT_LEVELS = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'xhigh',
  max: 'max',
} as const satisfies Record<EffortValue, string>;

const ANTHROPIC_EFFORT_LEVELS = {
  none: undefined,
  minimal: undefined,
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'xhigh',
  max: 'max',
} as const satisfies Record<EffortValue, string | undefined>;

/**
 * The reasoning parameter for one body, or `{}` when this dialect cannot
 * spell the resolved knob.
 *
 * A drop is a MISCONFIGURATION, never a routine outcome: the catalog entry
 * declares a knob the connector's wire has no parameter for, so the user's
 * pick reaches the endpoint as nothing at all. The shipped catalogs are held
 * to the pairing by a guard over the shipped tree
 * (`lib/providers/load_system_config.test.ts`); a custom org catalog is not,
 * so a drop says so on the console rather than degrading in silence — which
 * is exactly how both shipped mismatches went unnoticed.
 */
function reasoningParameter(
  body: ApiFormat | 'responses',
  reasoning: TurnSampling['reasoning'],
  modelId: string,
): Record<string, unknown> {
  if (reasoning === undefined) return {};
  if (body === 'anthropic') {
    if (reasoning.kind === 'thinking') {
      return {
        thinking: { type: 'enabled', budget_tokens: reasoning.budgetTokens },
      };
    }
    const effort = ANTHROPIC_EFFORT_LEVELS[reasoning.value];
    if (effort === undefined) {
      console.warn(
        `[chat-wire] model "${modelId}" resolved reasoning to "${reasoning.value}", which the Anthropic messages wire has no effort level for — the turn runs at the endpoint's own default`,
      );
      return {};
    }
    return { output_config: { effort } };
  }
  if (reasoning.kind === 'thinking') {
    console.warn(
      `[chat-wire] model "${modelId}" declares the budget-tokens knob, which an OpenAI-compatible wire cannot spell — the turn runs at the endpoint's own default; the catalog entry should declare the effort knob for this connector`,
    );
    return {};
  }
  if (body === 'responses') {
    return { reasoning: { effort: RESPONSES_EFFORT_LEVELS[reasoning.value] } };
  }
  return { reasoning_effort: OPENAI_EFFORT_LEVELS[reasoning.value] };
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Fold consecutive same-role turns into one, preserving order and text. */
function mergeAdjacentRoles(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }
    merged.push({ ...message });
  }
  return merged;
}

/** True when the request carries any tool material — definitions on offer or
 * tool turns in the transcript. A tool-free request keeps the exact body
 * shape it had before tools existed (string contents), so prompt caches and
 * golden tests never move. */
function carriesToolMaterial(args: ChatWireArgs): boolean {
  if (args.tools !== undefined && args.tools.length > 0) return true;
  return args.messages.some(
    (message) =>
      (message.toolCalls !== undefined && message.toolCalls.length > 0) ||
      (message.toolResults !== undefined && message.toolResults.length > 0),
  );
}

/** True when any user turn carries a resolved image — images only exist in
 * BLOCK form on both dialects, so their presence switches the body shape the
 * same way tool material does. A message with only unresolved
 * `attachmentRefs` does NOT count: the host either resolved them into
 * `images` or already textualized them. */
function carriesImages(args: ChatWireArgs): boolean {
  return args.messages.some(
    (message) => message.images !== undefined && message.images.length > 0,
  );
}

/** An Anthropic content block — text, an image, a tool call, or a result. */
type AnthropicBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
    };

/** Anthropic turns in BLOCK form, for a transcript that carries tool calls.
 * Tool results ride in USER turns (that is the dialect), and adjacent
 * same-role turns merge by concatenating their blocks. */
function anthropicBlockTurns(
  messages: ChatWireMessage[],
): Array<{ role: 'user' | 'assistant'; content: AnthropicBlock[] }> {
  const turns: Array<{
    role: 'user' | 'assistant';
    content: AnthropicBlock[];
  }> = [];
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const previous = turns.at(-1);
    if (previous && previous.role === role) {
      previous.content.push(...blocks);
      return;
    }
    turns.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      push(
        'user',
        (message.toolResults ?? []).map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.callId,
          content: result.content,
        })),
      );
      continue;
    }
    const blocks: AnthropicBlock[] = [];
    if (message.content.length > 0) {
      blocks.push({ type: 'text', text: message.content });
    }
    for (const image of message.images ?? []) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.dataBase64,
        },
      });
    }
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        });
      }
    }
    push(message.role === 'assistant' ? 'assistant' : 'user', blocks);
  }
  return turns;
}

/** The transcript as Responses API `input` items. System turns are left to
 * `instructions`. A user turn is a message (its images `input_image` parts),
 * an assistant turn its text as a message followed by one `function_call`
 * item per call, and each tool result a `function_call_output` item, paired
 * by `call_id`. No item carries a stored id: the request is `store: false`,
 * so each round sends the whole transcript, as Chat Completions does. */
function responsesInput(
  messages: ChatWireMessage[],
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      for (const result of message.toolResults ?? []) {
        input.push({
          type: 'function_call_output',
          call_id: result.callId,
          output: result.content,
        });
      }
      continue;
    }
    if (message.role === 'user') {
      // Images force the content-parts array; a text-only turn keeps the
      // plain string, as on Chat Completions.
      const images = message.images ?? [];
      input.push({
        role: 'user',
        content:
          images.length > 0
            ? [
                ...(message.content.length > 0
                  ? [{ type: 'input_text', text: message.content }]
                  : []),
                ...images.map((image) => ({
                  type: 'input_image',
                  image_url: `data:${image.mediaType};base64,${image.dataBase64}`,
                })),
              ]
            : message.content,
      });
      continue;
    }
    if (message.content.length > 0) {
      input.push({ role: 'assistant', content: message.content });
    }
    for (const call of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input ?? {}),
      });
    }
  }
  return input;
}

/**
 * The OpenAI Responses API request, for a model whose function tools work
 * only there. The system prompt rides `instructions`; the output cap is
 * `max_output_tokens`, the surface's only spelling; a custom temperature
 * rides only a model KNOWN not to reason, as on the `openai-modern` dialect.
 * Function tools are declared flat and NOT strict: the Responses API
 * validates strictly unless told otherwise, and the chat's tool schemas were
 * written for Chat Completions, which does not. `store: false` keeps the
 * conversation off the vendor's side.
 */
function buildResponsesRequest(
  args: ChatWireArgs,
  base: string,
  extra: Record<string, string>,
): ChatWireRequest {
  const instructions = args.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const sendTemperature =
    args.temperature !== undefined && args.reasoningModel === false;
  return {
    url: `${base}/responses`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
      ...extra,
    },
    body: JSON.stringify({
      model: args.modelId,
      ...(instructions ? { instructions } : {}),
      max_output_tokens: args.maxTokens,
      ...(sendTemperature ? { temperature: args.temperature } : {}),
      ...reasoningParameter('responses', args.reasoning, args.modelId),
      ...(args.tools !== undefined && args.tools.length > 0
        ? {
            tools: args.tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false,
            })),
          }
        : {}),
      input: responsesInput(args.messages),
      store: false,
    }),
  };
}

export function buildChatRequest(args: ChatWireArgs): ChatWireRequest {
  const base = stripTrailingSlash(args.baseUrl);
  const extra = args.extraHeaders ?? {};
  // Tool material and images each force BLOCK form; a body carrying neither
  // keeps the exact string-content shape it had before either existed, so
  // prompt caches and golden tests never move.
  const toolMode = carriesToolMaterial(args) || carriesImages(args);

  if (args.toolCallingApi === 'responses') {
    // The Responses API is an OpenAI surface; an Anthropic-format connector
    // has nothing to send such a model's tools on. The chat host refuses
    // that pairing before the turn starts — this is the last line.
    if (args.apiFormat !== 'openai') {
      throw new Error(
        `model "${args.modelId}" needs the Responses API for its tools, which an ${args.apiFormat} connector cannot speak`,
      );
    }
    return buildResponsesRequest(args, base, extra);
  }

  if (args.apiFormat === 'anthropic') {
    const system = args.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const turns = toolMode
      ? anthropicBlockTurns(args.messages)
      : mergeAdjacentRoles(
          args.messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              role: message.role === 'assistant' ? 'assistant' : 'user',
              content: message.content,
            })),
        );
    // Models released after Claude Opus 4.6 refuse every temperature but the
    // default (400: "Models released after Claude Opus 4.6 do not support
    // setting temperature"), and the older ones refuse it while thinking is
    // on. The catalog's reasoning declaration is the wire's only handle on
    // the generation, so the platform's default temperature rides only a
    // model KNOWN not to reason — unknown counts as reasoning, exactly as on
    // the openai-modern dialect.
    const sendTemperature =
      args.temperature !== undefined && args.reasoningModel === false;
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        ...extra,
      },
      body: JSON.stringify({
        model: args.modelId,
        max_tokens: args.maxTokens,
        ...(sendTemperature ? { temperature: args.temperature } : {}),
        ...reasoningParameter('anthropic', args.reasoning, args.modelId),
        ...(system ? { system } : {}),
        ...(args.tools !== undefined && args.tools.length > 0
          ? {
              tools: args.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        messages: turns,
      }),
    };
  }

  const openAiMessages: Array<Record<string, unknown>> = [];
  for (const message of args.messages) {
    if (message.role === 'tool') {
      // One wire message per result: the dialect pairs each `tool_call_id`
      // with its own `role: 'tool'` turn.
      for (const result of message.toolResults ?? []) {
        openAiMessages.push({
          role: 'tool',
          tool_call_id: result.callId,
          content: result.content,
        });
      }
      continue;
    }
    const calls = message.role === 'assistant' ? (message.toolCalls ?? []) : [];
    // Images force the content-parts array; a text-only message keeps the
    // plain string so image-free bodies stay byte-identical.
    const images = message.images ?? [];
    const content =
      images.length > 0
        ? [
            ...(message.content.length > 0
              ? [{ type: 'text', text: message.content }]
              : []),
            ...images.map((image) => ({
              type: 'image_url',
              image_url: {
                url: `data:${image.mediaType};base64,${image.dataBase64}`,
              },
            })),
          ]
        : message.content;
    openAiMessages.push({
      role: message.role,
      content,
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.input ?? {}),
              },
            })),
          }
        : {}),
    });
  }

  // The modern surface (api.openai.com, Azure v1) renamed the cap and made
  // reasoning models reject a custom temperature; the classic body must stay
  // byte-identical for every connector that does not declare the dialect.
  const modern = args.wireDialect === 'openai-modern';
  const sendTemperature =
    args.temperature !== undefined &&
    (!modern || args.reasoningModel === false);
  return {
    url: `${base}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
      ...extra,
    },
    body: JSON.stringify({
      model: args.modelId,
      ...(modern
        ? { max_completion_tokens: args.maxTokens }
        : { max_tokens: args.maxTokens }),
      ...(sendTemperature ? { temperature: args.temperature } : {}),
      ...reasoningParameter('openai', args.reasoning, args.modelId),
      ...(args.tools !== undefined && args.tools.length > 0
        ? {
            tools: args.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      messages: openAiMessages,
    }),
  };
}

/** Read a token count that a provider may or may not have sent. */
function tokenCount(usage: unknown, key: string): number {
  const value = isRecord(usage) ? usage[key] : undefined;
  return typeof value === 'number' ? value : 0;
}

/** Missing/invalid counts must remain distinguishable from reported zero. */
function usageReported(usage: unknown, input: string, output: string): boolean {
  return (
    isRecord(usage) &&
    [usage[input], usage[output]].every(
      (value) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    )
  );
}

/** Join the text parts of a content value that may be a string or blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      return isRecord(part) && typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

/**
 * Pull the reply text out of a provider payload. A payload with no text at
 * all is an error rather than a usable text result. A WELL-FORMED message with no text
 * (a reasoning-only reply) throws {@link EmptyReplyError} with the usage it
 * cost; a payload with no message at all throws a plain error.
 */
export function parseChatReply(
  apiFormat: ApiFormat,
  payload: unknown,
): ChatWireReply {
  if (!isRecord(payload))
    throw new Error('the model returned a non-object payload');
  const root = payload;

  if (apiFormat === 'anthropic') {
    const usage = {
      prompt: tokenCount(root.usage, 'input_tokens'),
      completion: tokenCount(root.usage, 'output_tokens'),
      reported: usageReported(root.usage, 'input_tokens', 'output_tokens'),
    };
    const content = textOf(root.content);
    if (!content) {
      if (Array.isArray(root.content)) throw new EmptyReplyError(usage);
      throw new Error('the model returned no text content');
    }
    return { content, usage };
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = choices[0];
  const message =
    isRecord(first) && isRecord(first.message) ? first.message : null;
  const usage = {
    prompt: tokenCount(root.usage, 'prompt_tokens'),
    completion: tokenCount(root.usage, 'completion_tokens'),
    reported: usageReported(root.usage, 'prompt_tokens', 'completion_tokens'),
  };
  const content = textOf(message?.content);
  if (!content) {
    if (message) throw new EmptyReplyError(usage);
    throw new Error('the model returned no text content');
  }
  return { content, usage };
}
