/**
 * The Anthropic Messages dialect: `POST /v1/messages` (also reachable as
 * `/messages`, so a base URL with or without `/v1` works).
 *
 * The stream is the Messages API's event sequence: `message_start` (its
 * usage carries the prompt, so a cancelled turn still books it), `ping`,
 * one content block per kind — `thinking` (with its signature) when the
 * request enabled thinking, `text`, `tool_use` with `input_json_delta`
 * fragments — then `message_delta` with the stop reason and output tokens,
 * and `message_stop`. Prompt caching is reported only when the request
 * marks a `cache_control` breakpoint, as Anthropic caches nothing unasked.
 */

import type { ServerResponse } from 'node:http';

import { serveChat, type ChatRenderer } from './chat.ts';
import type { MockContext } from './context.ts';
import type { ResponseStream } from './http.ts';
import type { Pacer } from './pacer.ts';
import { PrefixHasher } from './prompt-cache.ts';
import { randomId, type Random } from './random.ts';
import type {
  ChatTurnInput,
  FinishReason,
  ReplyPlan,
  ToolChoice,
} from './reply.ts';
import { chunkByTokens, chunkShare, estimateTokens } from './tokens.ts';
import type { OfferedTool } from './tool-args.ts';

const MESSAGE_OVERHEAD_TOKENS = 3;
/** What one image costs (about 1.15 megapixels). */
const IMAGE_TOKENS = 1600;
/** What one document block costs, roughly. */
const DOCUMENT_TOKENS = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/** The text of a content value: a string, or the text of its blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function readTools(value: unknown): OfferedTool[] {
  if (!Array.isArray(value)) return [];
  const tools: OfferedTool[] = [];
  for (const raw of value) {
    const tool = asRecord(raw);
    if (tool && typeof tool.name === 'string' && tool.name.length > 0) {
      tools.push({
        name: tool.name,
        parameters: asRecord(tool.input_schema) ?? {},
      });
    }
  }
  return tools;
}

function readToolChoice(value: unknown): ToolChoice {
  const choice = asRecord(value);
  switch (choice?.type) {
    case 'none':
      return { kind: 'none' };
    case 'any':
      return { kind: 'required' };
    case 'tool':
      return typeof choice.name === 'string'
        ? { kind: 'named', name: choice.name }
        : { kind: 'required' };
    default:
      return { kind: 'auto' };
  }
}

/**
 * Read a Messages body into the dialect-free turn, or return the reason it
 * cannot be served. `raw` is the body's text, searched for `cache_control`.
 */
function readAnthropicTurn(
  body: Record<string, unknown>,
  raw: string,
): ChatTurnInput | string {
  const model = body.model;
  if (typeof model !== 'string' || model.length === 0) {
    return 'model: Field required';
  }
  const maxTokens = positiveInt(body.max_tokens);
  if (maxTokens === undefined) return 'max_tokens: Field required';
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages: at least one message is required';
  }
  const tools = readTools(body.tools);
  const toolsJson = tools.length > 0 ? JSON.stringify(body.tools) : '';
  const systemText = textOf(body.system);
  const hasher = new PrefixHasher(
    `${model}\u0000${toolsJson}\u0000${systemText}`,
  );
  let running =
    (toolsJson.length > 0 ? estimateTokens(toolsJson) : 0) +
    estimateTokens(systemText);
  const prefixTokens: number[] = [];
  // Tools and the system prompt are a prefix of their own: a breakpoint on
  // the system block (the usual one) caches them for the very next request,
  // even when the conversation is a single message.
  if (running > 0) {
    prefixTokens.push(running);
    hasher.commit();
  }
  const toolNames = new Map<string, string>();
  let lastUserText = '';
  let toolResult: ChatTurnInput['toolResult'] = null;

  for (const rawMessage of messages) {
    const message = asRecord(rawMessage) ?? {};
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    hasher.add(role);
    let tokens = MESSAGE_OVERHEAD_TOKENS;
    let text = '';
    let result: ChatTurnInput['toolResult'] = null;
    const content = message.content;
    if (typeof content === 'string') {
      text = content;
      tokens += estimateTokens(content);
      hasher.add(content);
    } else if (Array.isArray(content)) {
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (!block) continue;
        switch (block.type) {
          case 'text': {
            const blockText = typeof block.text === 'string' ? block.text : '';
            text = text.length > 0 ? `${text}\n${blockText}` : blockText;
            tokens += estimateTokens(blockText);
            hasher.add(blockText);
            break;
          }
          case 'thinking': {
            const thinking =
              typeof block.thinking === 'string' ? block.thinking : '';
            tokens += estimateTokens(thinking);
            hasher.add(thinking);
            break;
          }
          case 'image': {
            const data = asRecord(block.source)?.data;
            tokens += IMAGE_TOKENS;
            hasher.add(
              typeof data === 'string'
                ? `${data.length}:${data.slice(-64)}`
                : 'image',
            );
            break;
          }
          case 'tool_use': {
            const name = typeof block.name === 'string' ? block.name : '';
            const input = JSON.stringify(block.input ?? {});
            if (typeof block.id === 'string') toolNames.set(block.id, name);
            tokens += estimateTokens(name + input);
            hasher.add(name);
            hasher.add(input);
            break;
          }
          case 'tool_result': {
            const resultText = textOf(block.content);
            tokens += estimateTokens(resultText);
            hasher.add(resultText);
            result = {
              toolName:
                (typeof block.tool_use_id === 'string'
                  ? toolNames.get(block.tool_use_id)
                  : undefined) || 'tool',
              content: resultText,
            };
            break;
          }
          default:
            tokens += DOCUMENT_TOKENS;
            hasher.add(String(block.type));
        }
      }
    }
    if (role === 'user' && text.trim().length > 0) lastUserText = text;
    toolResult = role === 'user' ? result : null;
    running += tokens;
    prefixTokens.push(running);
    hasher.commit();
  }

  const thinking = asRecord(body.thinking);
  const effort = asRecord(body.output_config)?.effort;
  const reasoningEffort =
    thinking?.type === 'enabled'
      ? 'medium'
      : thinking?.type === 'adaptive'
        ? typeof effort === 'string'
          ? effort
          : 'medium'
        : null;

  return {
    dialect: 'anthropic',
    model,
    stream: body.stream === true,
    maxTokens,
    systemText,
    lastUserText,
    toolResult,
    tools,
    toolChoice: readToolChoice(body.tool_choice),
    reasoningEffort,
    reasoningBudget: positiveInt(thinking?.budget_tokens),
    responseFormat: { kind: 'text' },
    promptCaching: raw.includes('"cache_control"'),
    promptTokens: running,
    prefixHashes: hasher.hashes,
    prefixTokens,
  };
}

function stopReason(finish: FinishReason): string {
  switch (finish) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

function usageOf(plan: ReplyPlan): Record<string, number> {
  return {
    input_tokens: plan.promptTokens - plan.cachedTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: plan.cachedTokens,
  };
}

function event(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function anthropicRenderer(
  random: Random,
  model: string,
  chunkTokens: number,
): ChatRenderer {
  const id = `msg_01${randomId(random, 22)}`;
  const signature = randomId(random, 88);
  let thinking: string[] = [];
  let text: string[] = [];
  let args: string[] = [];

  const blockFrame = (index: number, delta: string): string =>
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":${delta}}\n\n`;
  const stopFrame = (index: number): string =>
    event('content_block_stop', { type: 'content_block_stop', index });

  return {
    dialect: 'anthropic',
    headers: { 'request-id': `req_01${randomId(random, 22)}` },
    errorFrame: event('error', {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    }),
    totalChunks(plan) {
      thinking = chunkByTokens(plan.reasoning, chunkTokens);
      text = chunkByTokens(plan.content, chunkTokens);
      args =
        plan.toolCall === null
          ? []
          : chunkByTokens(plan.toolCall.argumentsJson, chunkTokens);
      return thinking.length + text.length + args.length;
    },
    async stream(pacer: Pacer, stream: ResponseStream, plan: ReplyPlan) {
      const start = event('message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { ...usageOf(plan), output_tokens: 1 },
        },
      });
      if (!(await pacer.control(start))) return;
      if (!(await pacer.control(event('ping', { type: 'ping' })))) return;
      if (!(await pacer.begin())) return;
      let index = 0;

      if (thinking.length > 0) {
        const open = event('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        });
        if (!(await pacer.control(open))) return;
        for (let i = 0; i < thinking.length; i++) {
          const delta = `{"type":"thinking_delta","thinking":${JSON.stringify(thinking[i] ?? '')}}`;
          const tokens = chunkShare(
            i,
            thinking.length,
            plan.reasoningTokens,
            chunkTokens,
          );
          if (!(await pacer.chunk(blockFrame(index, delta), tokens, true))) {
            return;
          }
        }
        const signed = blockFrame(
          index,
          `{"type":"signature_delta","signature":"${signature}"}`,
        );
        if (!(await pacer.control(signed))) return;
        if (!(await pacer.control(stopFrame(index)))) return;
        index += 1;
      }

      if (text.length > 0) {
        const open = event('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        });
        if (!(await pacer.control(open))) return;
        for (let i = 0; i < text.length; i++) {
          const delta = `{"type":"text_delta","text":${JSON.stringify(text[i] ?? '')}}`;
          const tokens = chunkShare(
            i,
            text.length,
            plan.contentTokens,
            chunkTokens,
          );
          if (!(await pacer.chunk(blockFrame(index, delta), tokens))) return;
        }
        if (!(await pacer.control(stopFrame(index)))) return;
        index += 1;
      }

      const call = plan.toolCall;
      if (call !== null) {
        const open = event('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: {},
          },
        });
        if (!(await pacer.control(open))) return;
        for (let i = 0; i < args.length; i++) {
          const delta = `{"type":"input_json_delta","partial_json":${JSON.stringify(args[i] ?? '')}}`;
          const tokens = chunkShare(
            i,
            args.length,
            call.argumentsTokens,
            chunkTokens,
          );
          if (!(await pacer.chunk(blockFrame(index, delta), tokens))) return;
        }
        if (!(await pacer.control(stopFrame(index)))) return;
      }

      const closing = event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason(plan.finish), stop_sequence: null },
        usage: { output_tokens: plan.completionTokens },
      });
      if (!(await stream.write(closing))) return;
      stream.end(event('message_stop', { type: 'message_stop' }));
    },
    buffered(plan) {
      const content: unknown[] = [];
      if (plan.reasoning.length > 0) {
        content.push({ type: 'thinking', thinking: plan.reasoning, signature });
      }
      if (plan.content.length > 0) {
        content.push({ type: 'text', text: plan.content });
      }
      const call = plan.toolCall;
      if (call !== null) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: JSON.parse(call.argumentsJson) as unknown,
        });
      }
      return {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: stopReason(plan.finish),
        stop_sequence: null,
        usage: { ...usageOf(plan), output_tokens: plan.completionTokens },
      };
    },
  };
}

/** Serve one `POST /v1/messages`; `body` is the parsed JSON, `raw` its text. */
export async function handleMessages(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
  raw: string,
  arrivedAt: number,
  badRequest: (message: string) => void,
): Promise<void> {
  const input = readAnthropicTurn(body, raw);
  if (typeof input === 'string') {
    badRequest(input);
    return;
  }
  const renderer = anthropicRenderer(
    ctx.requestRandom(),
    input.model,
    ctx.options.chunkTokens,
  );
  await serveChat(ctx, res, input, renderer, arrivedAt);
}

/** `POST /v1/messages/count_tokens`: the prompt count alone. */
export function countMessageTokens(
  body: Record<string, unknown>,
  raw: string,
): { input_tokens: number } | string {
  const input = readAnthropicTurn({ max_tokens: 1, ...body }, raw);
  return typeof input === 'string'
    ? input
    : { input_tokens: input.promptTokens };
}
