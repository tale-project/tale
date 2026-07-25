/**
 * Wire shaping for one builder turn: a conversation in, an HTTP request out,
 * and a provider payload back into text.
 *
 * Kept separate from the call itself (`model_call.ts`) because this part is
 * pure data mapping and deserves to be tested without a network, a
 * credential, or a Node runtime. Two formats exist because provider
 * connectors declare exactly two: OpenAI-compatible chat completions and
 * Anthropic messages.
 *
 * Two shape rules matter and are easy to get wrong:
 *  - Anthropic takes the system prompt as a top-level parameter, not as a
 *    message, and rejects two messages of the same role in a row — a session
 *    restart seeds two user messages back to back, so they are merged here.
 *  - `max_tokens` is mandatory for Anthropic and merely wise for OpenAI: a
 *    builder reply carries a whole automation document and a truncated one
 *    costs a turn.
 */

import { asRecord } from '../../lib/automations_builder/results';
import type { BuilderMessage } from '../../lib/automations_builder/session';
import type { ApiFormat } from '../../lib/shared/schemas/providers';

export interface ChatWireRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChatWireReply {
  content: string;
  usage: { prompt: number; completion: number };
}

export interface ChatWireArgs {
  apiFormat: ApiFormat;
  /** The connector's API origin, with or without a trailing slash. */
  baseUrl: string;
  modelId: string;
  apiKey: string;
  messages: BuilderMessage[];
  temperature: number;
  maxTokens: number;
  /** Provider attribution headers the platform sends where they apply. */
  extraHeaders?: Record<string, string>;
}

/** The Anthropic messages API is versioned by header, not by path. */
const ANTHROPIC_VERSION = '2023-06-01';

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

export function buildChatRequest(args: ChatWireArgs): ChatWireRequest {
  const base = stripTrailingSlash(args.baseUrl);
  const extra = args.extraHeaders ?? {};

  if (args.apiFormat === 'anthropic') {
    const system = args.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const turns = mergeAdjacentRoles(
      args.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
    );
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
        temperature: args.temperature,
        ...(system ? { system } : {}),
        messages: turns,
      }),
    };
  }

  return {
    url: `${base}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
      ...extra,
    },
    body: JSON.stringify({
      model: args.modelId,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      messages: args.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  };
}

/** Read a token count that a provider may or may not have sent. */
function tokenCount(
  usage: Record<string, unknown> | null,
  key: string,
): number {
  const value = usage?.[key];
  return typeof value === 'number' ? value : 0;
}

/** Join the text parts of a content value that may be a string or blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const block = asRecord(part);
      return block && typeof block.text === 'string' ? block.text : '';
    })
    .join('');
}

/**
 * Pull the reply text out of a provider payload. A payload with no text at
 * all is an error rather than an empty turn: the loop would otherwise spend a
 * turn nudging a model that never spoke.
 */
export function parseChatReply(
  apiFormat: ApiFormat,
  payload: unknown,
): ChatWireReply {
  const root = asRecord(payload);
  if (!root) throw new Error('the model returned a non-object payload');

  if (apiFormat === 'anthropic') {
    const usage = asRecord(root.usage);
    const content = textOf(root.content);
    if (!content) throw new Error('the model returned no text content');
    return {
      content,
      usage: {
        prompt: tokenCount(usage, 'input_tokens'),
        completion: tokenCount(usage, 'output_tokens'),
      },
    };
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  const content = textOf(message?.content);
  if (!content) throw new Error('the model returned no text content');
  const usage = asRecord(root.usage);
  return {
    content,
    usage: {
      prompt: tokenCount(usage, 'prompt_tokens'),
      completion: tokenCount(usage, 'completion_tokens'),
    },
  };
}
