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
import type { TurnSampling } from '../../lib/chat/effort';
import type { WireTool } from '../../lib/chat/tools';
import type { ChatWireMessage } from '../../lib/chat/wire-parts';
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

export type {
  ChatWireMessage,
  WireToolCall,
  WireToolResult,
} from '../../lib/chat/wire-parts';

export interface ChatWireArgs {
  apiFormat: ApiFormat;
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
   * The turn's reasoning control, when one was resolved. Each dialect spells
   * only its own knob: Anthropic takes a thinking budget, OpenAI-compatible
   * endpoints a named effort level; the other kind is ignored by that body.
   */
  reasoning?: TurnSampling['reasoning'];
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

/** An Anthropic content block — text, a tool call, or a tool result. */
type AnthropicBlock =
  | { type: 'text'; text: string }
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

export function buildChatRequest(args: ChatWireArgs): ChatWireRequest {
  const base = stripTrailingSlash(args.baseUrl);
  const extra = args.extraHeaders ?? {};
  const toolMode = carriesToolMaterial(args);

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
        ...(args.temperature !== undefined
          ? { temperature: args.temperature }
          : {}),
        ...(args.reasoning?.kind === 'thinking'
          ? {
              thinking: {
                type: 'enabled',
                budget_tokens: args.reasoning.budgetTokens,
              },
            }
          : {}),
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
    openAiMessages.push({
      role: message.role,
      content: message.content,
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
      ...(args.temperature !== undefined
        ? { temperature: args.temperature }
        : {}),
      ...(args.reasoning?.kind === 'effort'
        ? { reasoning_effort: args.reasoning.value }
        : {}),
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
