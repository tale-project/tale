/**
 * Deterministic OpenAI-compatible `POST /v1/chat/completions` handler.
 *
 * This is the ONE route the mock gateway does NOT serve from an OpenAPI spec:
 * Prism can neither stream Server-Sent Events nor branch a response body on the
 * request's *content*, both of which the chat path requires. So the chat
 * endpoint is owned by this override while every
 * other AI endpoint (`/v1/embeddings`, `/v1/images/generations`,
 * `/v1/audio/*`) flows through Prism examples.
 *
 * Behaviour:
 *   - `stream: true`  → SSE deltas; otherwise a single JSON completion.
 *   - `response_format` of any `json*` type → `{}` (router / title generation
 *     parse the content as JSON and must never choke).
 *   - A user message containing a `MOCK_TRIGGERS` substring switches into the
 *     matching scenario (reasoning / next-steps / human-input tool / error).
 *
 * The exact `delta` wire fields (`content`, `reasoning_content`, `tool_calls`)
 * match what `@ai-sdk/openai-compatible` reads in
 * `convex/providers/resolve_model.ts`.
 */

import {
  CANNED_ERROR_MESSAGE,
  CANNED_HUMAN_INPUT_ACK,
  CANNED_HUMAN_INPUT_FIELD_LABEL,
  CANNED_HUMAN_INPUT_QUESTION,
  CANNED_NEXT_STEPS_TEXT,
  CANNED_REASONING,
  CANNED_REASONING_ANSWER,
  CANNED_REPLY,
  MOCK_TRIGGERS,
} from './canned';
import { matchDocsReply } from './docs-replies';

/** Canned content for structured-output requests (`response_format` json*). */
const CANNED_JSON_REPLY = '{}';

/** The `request_human_input` tool-call arguments (must satisfy its zod schema). */
const HUMAN_INPUT_TOOL_NAME = 'request_human_input';
const HUMAN_INPUT_ARGS = JSON.stringify({
  question: CANNED_HUMAN_INPUT_QUESTION,
  fields: [
    { type: 'text', label: CANNED_HUMAN_INPUT_FIELD_LABEL, required: true },
  ],
});

/** One parsed chat message — only the fields the scenario logic needs. */
interface ParsedMessage {
  role: string;
  text: string;
  hasToolCalls: boolean;
}

interface ChatCompletionRequest {
  model?: string;
  stream?: boolean;
  response_format?: { type?: string };
  messages?: ParsedMessage[];
}

/**
 * Recursive JSON value — the only thing `request.json()` can yield. Narrowing
 * from this (instead of `unknown`) keeps the parse path type-safe.
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten an OpenAI message `content` (string or content-part array) to text. */
function messageText(content: JsonValue | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isJsonObject(part) && typeof part.text === 'string')
          return part.text;
        return '';
      })
      .join(' ');
  }
  return '';
}

function toMessages(value: JsonValue): ParsedMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ParsedMessage[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) continue;
    messages.push({
      role: typeof item.role === 'string' ? item.role : '',
      text: messageText(item.content),
      hasToolCalls:
        Array.isArray(item.tool_calls) && item.tool_calls.length > 0,
    });
  }
  return messages;
}

/**
 * Project a parsed JSON body onto the handful of fields the mock cares about.
 * Anything missing or mistyped is dropped, so callers always get a well-typed
 * `ChatCompletionRequest`.
 */
function toChatCompletionRequest(value: JsonValue): ChatCompletionRequest {
  if (!isJsonObject(value)) return {};
  const request: ChatCompletionRequest = {};
  if (typeof value.model === 'string') request.model = value.model;
  if (typeof value.stream === 'boolean') request.stream = value.stream;
  const responseFormat = value.response_format;
  if (isJsonObject(responseFormat) && typeof responseFormat.type === 'string') {
    request.response_format = { type: responseFormat.type };
  }
  if (value.messages !== undefined)
    request.messages = toMessages(value.messages);
  return request;
}

type Scenario =
  | 'canned'
  | 'docs'
  | 'reasoning'
  | 'nextSteps'
  | 'humanInputTool'
  | 'humanInputAck'
  | 'error';

function userTexts(messages: ParsedMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.toLowerCase());
}

/** Last user message, lowercased — the docs-reply match key. */
function lastUserText(body: ChatCompletionRequest): string {
  const users = userTexts(body.messages ?? []);
  return users[users.length - 1] ?? '';
}

/**
 * True once the conversation already carries the human-input tool call / result
 * (or the injected `<human_response>` context) — i.e. the post-approval resume
 * turn, where the mock must answer in plain text instead of re-emitting the
 * tool call (which would loop).
 */
function isHumanInputResume(messages: ParsedMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' ||
      message.hasToolCalls ||
      message.text.includes('human_response'),
  );
}

function pickScenario(body: ChatCompletionRequest): Scenario {
  // JSON-format calls (router / title generation) keep the canned `{}` path.
  if ((body.response_format?.type ?? '').startsWith('json')) return 'canned';
  const messages = body.messages ?? [];
  const users = userTexts(messages);
  if (users.some((text) => text.includes(MOCK_TRIGGERS.humanInput))) {
    return isHumanInputResume(messages) ? 'humanInputAck' : 'humanInputTool';
  }
  const last = users[users.length - 1] ?? '';
  if (last.includes(MOCK_TRIGGERS.error)) return 'error';
  if (last.includes(MOCK_TRIGGERS.reasoning)) return 'reasoning';
  if (last.includes(MOCK_TRIGGERS.nextSteps)) return 'nextSteps';
  // Docs-pipeline phrases come last so an e2e trigger always wins; anything
  // unmatched stays on the spec-pinned canned path.
  if (matchDocsReply(last)) return 'docs';
  return 'canned';
}

/** The plain-text content a (non-tool) scenario streams as `delta.content`. */
function scenarioContent(
  scenario: Scenario,
  body: ChatCompletionRequest,
): string {
  switch (scenario) {
    case 'docs':
      return matchDocsReply(lastUserText(body))?.reply ?? CANNED_REPLY;
    case 'reasoning':
      return CANNED_REASONING_ANSWER;
    case 'nextSteps':
      return CANNED_NEXT_STEPS_TEXT;
    case 'humanInputAck':
      return CANNED_HUMAN_INPUT_ACK;
    default: {
      const formatType = body.response_format?.type ?? '';
      return formatType.startsWith('json') ? CANNED_JSON_REPLY : CANNED_REPLY;
    }
  }
}

function completionId(): string {
  return `chatcmpl-e2e-${Date.now().toString(36)}`;
}

function jsonCompletion(body: ChatCompletionRequest): Response {
  const formatType = body.response_format?.type ?? '';
  // Honour ONLY the docs scenario on the non-streamed path — the seeded demo
  // chats issue plain (non-streamed) generation calls, and a docs phrase that
  // silently fell back to the canned reply would ship a fake-looking shot. The
  // streaming-chat e2e scenarios (nextSteps/reasoning/humanInput) must NOT leak
  // here: thread-title generation is a non-streamed `generateText` call whose
  // prompt is the user's first message, so routing it to `nextSteps` would
  // surface the raw `[[NEXT_STEPS]]` marker as the thread title.
  const content = formatType.startsWith('json')
    ? CANNED_JSON_REPLY
    : pickScenario(body) === 'docs'
      ? scenarioContent('docs', body)
      : CANNED_REPLY;
  return Response.json({
    id: completionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'e2e-chat-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 16, completion_tokens: 16, total_tokens: 32 },
  });
}

interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason: 'stop' | 'tool_calls' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function sseChunk(payload: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const USAGE = { prompt_tokens: 16, completion_tokens: 16, total_tokens: 32 };

// Split into word-sized deltas so the UI exercises its real streaming path.
function toDeltas(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function streamedCompletion(body: ChatCompletionRequest): Response {
  const scenario = pickScenario(body);
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? 'e2e-chat-model';
  const base = { id, object: 'chat.completion.chunk', created, model };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const sendDelta = (
        delta: ChatCompletionChunk['choices'][number]['delta'],
        finish: 'stop' | 'tool_calls' | null,
        usage?: ChatCompletionChunk['usage'],
      ) =>
        send(
          sseChunk({
            ...base,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(usage ? { usage } : {}),
          }),
        );
      const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

      // Every stream opens with the assistant role delta.
      sendDelta({ role: 'assistant' }, null);

      if (scenario === 'humanInputTool') {
        // Tool-call: name MUST be on the first tool_calls delta; arguments are
        // streamed and must parse as JSON by the end. finish_reason=tool_calls.
        sendDelta(
          {
            tool_calls: [
              {
                index: 0,
                id: `call_e2e_${Date.now().toString(36)}`,
                type: 'function',
                function: { name: HUMAN_INPUT_TOOL_NAME, arguments: '' },
              },
            ],
          },
          null,
        );
        await pause();
        sendDelta(
          {
            tool_calls: [
              { index: 0, function: { arguments: HUMAN_INPUT_ARGS } },
            ],
          },
          null,
        );
        sendDelta({}, 'tool_calls', USAGE);
        send('data: [DONE]\n\n');
        controller.close();
        return;
      }

      // Reasoning streams `reasoning_content` first; the SDK closes the
      // reasoning block automatically on the first `content` delta. Docs
      // replies opt into the same path via their `reasoning` field.
      const reasoningText =
        scenario === 'reasoning'
          ? CANNED_REASONING
          : scenario === 'docs'
            ? (matchDocsReply(lastUserText(body))?.reasoning ?? null)
            : null;
      if (reasoningText !== null) {
        for (const delta of toDeltas(reasoningText)) {
          sendDelta({ reasoning_content: delta }, null);
          await pause();
        }
      }

      for (const delta of toDeltas(scenarioContent(scenario, body))) {
        sendDelta({ content: delta }, null);
        await pause();
      }
      sendDelta({}, 'stop', USAGE);
      send('data: [DONE]\n\n');
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

/** True for the `POST .../chat/completions` route this override owns. */
export function isChatCompletionsRoute(
  method: string,
  pathname: string,
): boolean {
  return method === 'POST' && pathname.endsWith('/chat/completions');
}

/**
 * Handle a chat-completions request. Returns the deterministic SSE stream, a
 * single JSON completion, or (error scenario) a 500.
 */
export async function handleChatCompletions(
  request: Request,
): Promise<Response> {
  // Parse via text + `JSON.parse` (which yields `any`, freely assignable to our
  // `JsonValue` union) so every downstream read stays type-safe without an
  // unsafe narrowing assertion on `Request.json()`'s `unknown`.
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await request.text());
  } catch (error) {
    console.warn('[mocks] non-JSON chat body:', error);
    return new Response('invalid JSON body', { status: 400 });
  }
  const body = toChatCompletionRequest(parsed);
  const scenario = pickScenario(body);
  console.log(
    `[mocks] chat/completions (stream=${body.stream === true}, model=${body.model ?? 'unknown'}, scenario=${scenario})`,
  );
  // Error scenario: fail the generation call with a 500 so the chat surfaces
  // its provider-failure UI. JSON router/title calls never reach here as
  // 'error' (pickScenario short-circuits them to 'canned'), so only the
  // assistant turn fails — routing still succeeds.
  if (scenario === 'error') {
    return Response.json(
      { error: { message: CANNED_ERROR_MESSAGE, type: 'server_error' } },
      { status: 500 },
    );
  }
  return body.stream === true ? streamedCompletion(body) : jsonCompletion(body);
}
