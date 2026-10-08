/**
 * The OpenAI Chat Completions dialect: `POST /v1/chat/completions`.
 *
 * Request reading follows what the platform's chat wire sends (string or
 * content-part messages, `tool` results paired by `tool_call_id`,
 * `max_tokens` or `max_completion_tokens`, `reasoning_effort`,
 * `stream_options.include_usage`); the stream follows what its decoder
 * reads: a role chunk, `reasoning_content` deltas, `content` deltas,
 * `tool_calls` fragments, a finish chunk, the usage chunk with
 * `choices: []`, and `[DONE]`. Frames are assembled from a fixed prefix and
 * suffix around one escaped string, so a chunk costs one small
 * `JSON.stringify` rather than serializing a whole object.
 */

import type { ServerResponse } from 'node:http';

import { serveChat, type ChatRenderer } from './chat.ts';
import type { MockContext } from './context.ts';
import type { Pacer } from './pacer.ts';
import { PrefixHasher } from './prompt-cache.ts';
import { randomId, type Random } from './random.ts';
import type {
  ChatTurnInput,
  FinishReason,
  ReplyPlan,
  ResponseFormat,
  ToolChoice,
} from './reply.ts';
import { chunkByTokens, chunkShare, estimateTokens } from './tokens.ts';
import type { OfferedTool } from './tool-args.ts';

/** Tokens of framing every message costs (role, separators). */
const MESSAGE_OVERHEAD_TOKENS = 3;
/** Tokens priming the assistant's reply. */
const REPLY_PRIMING_TOKENS = 3;
/** What one image costs (a 1024px image at high detail). */
const IMAGE_TOKENS = 765;
/** What one audio or file part costs, roughly. */
const ATTACHMENT_TOKENS = 200;

const SYSTEM_FINGERPRINT = 'fp_tale_load';

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

/** A short stable stand-in for a (possibly megabytes long) data URL. */
function digestOfUrl(url: string): string {
  return url.length > 256 ? `${url.length}:${url.slice(-64)}` : url;
}

function readTools(value: unknown): OfferedTool[] {
  if (!Array.isArray(value)) return [];
  const tools: OfferedTool[] = [];
  for (const raw of value) {
    const entry = asRecord(raw);
    const fn = asRecord(entry?.function) ?? entry;
    if (fn && typeof fn.name === 'string' && fn.name.length > 0) {
      tools.push({ name: fn.name, parameters: asRecord(fn.parameters) ?? {} });
    }
  }
  return tools;
}

function readToolChoice(value: unknown): ToolChoice {
  if (value === 'none') return { kind: 'none' };
  if (value === 'required') return { kind: 'required' };
  const name = asRecord(asRecord(value)?.function)?.name;
  if (typeof name === 'string') return { kind: 'named', name };
  return { kind: 'auto' };
}

function readResponseFormat(value: unknown): ResponseFormat {
  const format = asRecord(value);
  if (format?.type === 'json_object') return { kind: 'json_object' };
  if (format?.type === 'json_schema') {
    return {
      kind: 'json_schema',
      schema: asRecord(format.json_schema)?.schema ?? {},
    };
  }
  return { kind: 'text' };
}

function readReasoningEffort(body: Record<string, unknown>): string | null {
  if (typeof body.reasoning_effort === 'string') return body.reasoning_effort;
  const reasoning = asRecord(body.reasoning);
  if (reasoning) {
    if (typeof reasoning.effort === 'string') return reasoning.effort;
    if (reasoning.enabled === false || reasoning.exclude === true) return null;
    return 'medium';
  }
  return body.include_reasoning === true ? 'medium' : null;
}

/**
 * Read a Chat Completions body into the dialect-free turn, or return the
 * reason it cannot be served.
 */
export function readOpenAiTurn(
  body: Record<string, unknown>,
): ChatTurnInput | string {
  const model = body.model;
  if (typeof model !== 'string' || model.length === 0) {
    return 'you must provide a model parameter';
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return "'messages' must be a non-empty array";
  }
  const tools = readTools(body.tools);
  const toolsJson = tools.length > 0 ? JSON.stringify(body.tools) : '';
  const hasher = new PrefixHasher(`${model}\u0000${toolsJson}`);
  let running = toolsJson.length > 0 ? estimateTokens(toolsJson) : 0;
  const prefixTokens: number[] = [];
  const system: string[] = [];
  const toolNames = new Map<string, string>();
  let lastUserText = '';
  let lastText = '';

  for (const raw of messages) {
    const message = asRecord(raw) ?? {};
    const role = typeof message.role === 'string' ? message.role : 'user';
    hasher.add(role);
    let tokens = MESSAGE_OVERHEAD_TOKENS;
    let text = '';
    const content = message.content;
    if (typeof content === 'string') {
      text = content;
      tokens += estimateTokens(content);
      hasher.add(content);
    } else if (Array.isArray(content)) {
      for (const rawPart of content) {
        const part = asRecord(rawPart);
        if (!part) continue;
        if (typeof part.text === 'string') {
          text = text.length > 0 ? `${text}\n${part.text}` : part.text;
          tokens += estimateTokens(part.text);
          hasher.add(part.text);
        } else if (part.type === 'image_url') {
          const url = asRecord(part.image_url)?.url;
          tokens += IMAGE_TOKENS;
          hasher.add(typeof url === 'string' ? digestOfUrl(url) : 'image');
        } else {
          tokens += ATTACHMENT_TOKENS;
          hasher.add(String(part.type));
        }
      }
    }
    if (Array.isArray(message.tool_calls)) {
      for (const rawCall of message.tool_calls) {
        const call = asRecord(rawCall);
        const fn = asRecord(call?.function);
        const name = typeof fn?.name === 'string' ? fn.name : '';
        const args = typeof fn?.arguments === 'string' ? fn.arguments : '';
        if (typeof call?.id === 'string') toolNames.set(call.id, name);
        tokens += MESSAGE_OVERHEAD_TOKENS + estimateTokens(name + args);
        hasher.add(name);
        hasher.add(args);
      }
    }
    if (role === 'system' || role === 'developer') system.push(text);
    if (role === 'user' && text.trim().length > 0) lastUserText = text;
    lastText = text;
    running += tokens;
    prefixTokens.push(running);
    hasher.commit();
  }

  const last = asRecord(messages.at(-1));
  const toolResult =
    last?.role === 'tool'
      ? {
          toolName:
            (typeof last.tool_call_id === 'string'
              ? toolNames.get(last.tool_call_id)
              : undefined) || 'tool',
          content: lastText,
        }
      : null;

  return {
    dialect: 'openai',
    model,
    stream: body.stream === true,
    maxTokens:
      positiveInt(body.max_completion_tokens) ?? positiveInt(body.max_tokens),
    systemText: system.join('\n\n'),
    lastUserText,
    toolResult,
    tools,
    toolChoice: readToolChoice(body.tool_choice),
    reasoningEffort: readReasoningEffort(body),
    reasoningBudget: undefined,
    responseFormat: readResponseFormat(body.response_format),
    promptCaching: true,
    promptTokens: running + REPLY_PRIMING_TOKENS,
    prefixHashes: hasher.hashes,
    prefixTokens,
  };
}

/** The usage object, as Chat Completions reports it. */
export function openAiUsage(plan: ReplyPlan): Record<string, unknown> {
  return {
    prompt_tokens: plan.promptTokens,
    completion_tokens: plan.completionTokens,
    total_tokens: plan.promptTokens + plan.completionTokens,
    prompt_tokens_details: {
      cached_tokens: plan.cachedTokens,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: plan.reasoningTokens,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  };
}

function openAiRenderer(
  random: Random,
  model: string,
  includeUsage: boolean,
  chunkTokens: number,
): ChatRenderer {
  const id = `chatcmpl-${randomId(random, 29)}`;
  const created = Math.floor(Date.now() / 1000);
  const envelope = `{"id":"${id}","object":"chat.completion.chunk","created":${created},"model":${JSON.stringify(model)},"system_fingerprint":"${SYSTEM_FINGERPRINT}"`;
  const head = `data: ${envelope},"choices":[{"index":0,"delta":`;
  const usageNull = includeUsage ? ',"usage":null' : '';
  const tail = `,"logprobs":null,"finish_reason":null}]${usageNull}}\n\n`;
  const frame = (delta: string): string => head + delta + tail;
  const finishFrame = (finish: FinishReason): string =>
    `${head}{},"logprobs":null,"finish_reason":"${finish}"}]${usageNull}}\n\n`;

  let reasoningChunks: string[] = [];
  let contentChunks: string[] = [];
  let argumentChunks: string[] = [];
  const prepare = (plan: ReplyPlan): void => {
    reasoningChunks = chunkByTokens(plan.reasoning, chunkTokens);
    contentChunks = chunkByTokens(plan.content, chunkTokens);
    argumentChunks =
      plan.toolCall === null
        ? []
        : chunkByTokens(plan.toolCall.argumentsJson, chunkTokens);
  };

  return {
    dialect: 'openai',
    headers: { 'x-request-id': `req_${randomId(random, 24)}` },
    errorFrame: `data: ${JSON.stringify({
      error: {
        message:
          'The server had an error while processing your request. Sorry about that!',
        type: 'server_error',
        code: 'server_error',
      },
    })}\n\n`,
    totalChunks(plan) {
      prepare(plan);
      return (
        reasoningChunks.length + contentChunks.length + argumentChunks.length
      );
    },
    async stream(pacer: Pacer, stream, plan) {
      if (
        !(await pacer.control(
          frame('{"role":"assistant","content":"","refusal":null}'),
        ))
      ) {
        return;
      }
      if (!(await pacer.begin())) return;
      for (let i = 0; i < reasoningChunks.length; i++) {
        const piece = reasoningChunks[i] ?? '';
        const delta = `{"reasoning_content":${JSON.stringify(piece)}}`;
        const tokens = chunkShare(
          i,
          reasoningChunks.length,
          plan.reasoningTokens,
          chunkTokens,
        );
        if (!(await pacer.chunk(frame(delta), tokens, true))) return;
      }
      for (let i = 0; i < contentChunks.length; i++) {
        const piece = contentChunks[i] ?? '';
        const delta = `{"content":${JSON.stringify(piece)}}`;
        const tokens = chunkShare(
          i,
          contentChunks.length,
          plan.contentTokens,
          chunkTokens,
        );
        if (!(await pacer.chunk(frame(delta), tokens))) return;
      }
      const call = plan.toolCall;
      if (call !== null) {
        const header = `{"tool_calls":[{"index":0,"id":"${call.id}","type":"function","function":{"name":${JSON.stringify(call.name)},"arguments":""}}]}`;
        if (!(await pacer.control(frame(header)))) return;
        for (let i = 0; i < argumentChunks.length; i++) {
          const piece = argumentChunks[i] ?? '';
          const delta = `{"tool_calls":[{"index":0,"function":{"arguments":${JSON.stringify(piece)}}}]}`;
          const tokens = chunkShare(
            i,
            argumentChunks.length,
            call.argumentsTokens,
            chunkTokens,
          );
          if (!(await pacer.chunk(frame(delta), tokens))) return;
        }
      }
      if (!(await stream.write(finishFrame(plan.finish)))) return;
      if (includeUsage) {
        const usage = `data: ${envelope},"choices":[],"usage":${JSON.stringify(openAiUsage(plan))}}\n\n`;
        if (!(await stream.write(usage))) return;
      }
      stream.end('data: [DONE]\n\n');
    },
    buffered(plan) {
      const call = plan.toolCall;
      return {
        id,
        object: 'chat.completion',
        created,
        model,
        system_fingerprint: SYSTEM_FINGERPRINT,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                call !== null && plan.content === '' ? null : plan.content,
              refusal: null,
              ...(plan.reasoning.length > 0
                ? { reasoning_content: plan.reasoning }
                : {}),
              ...(call !== null
                ? {
                    tool_calls: [
                      {
                        id: call.id,
                        type: 'function',
                        function: {
                          name: call.name,
                          arguments: call.argumentsJson,
                        },
                      },
                    ],
                  }
                : {}),
            },
            logprobs: null,
            finish_reason: plan.finish,
          },
        ],
        usage: openAiUsage(plan),
      };
    },
  };
}

/** Serve one `POST /v1/chat/completions`; `body` is the parsed JSON. */
export async function handleChatCompletions(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
  arrivedAt: number,
  badRequest: (message: string) => void,
): Promise<void> {
  const input = readOpenAiTurn(body);
  if (typeof input === 'string') {
    badRequest(input);
    return;
  }
  const includeUsage = asRecord(body.stream_options)?.include_usage === true;
  const renderer = openAiRenderer(
    ctx.requestRandom(),
    input.model,
    includeUsage,
    ctx.options.chunkTokens,
  );
  await serveChat(ctx, res, input, renderer, arrivedAt);
}
