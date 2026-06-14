#!/usr/bin/env bun
/**
 * Mock OpenAI-compatible LLM server for the Playwright E2E suite.
 *
 * Implements just enough of the OpenAI Chat Completions API for the platform's
 * `@ai-sdk/openai-compatible` client (`convex/providers/resolve_model.ts`):
 *
 *   - `POST /v1/chat/completions` — streams the canned reply as SSE when the
 *     request sets `stream: true`, otherwise returns a single JSON completion.
 *     Requests with a `response_format` of any `json*` type get `{}` so JSON
 *     parsers (router / title generation) never choke.
 *   - `GET /health` — readiness probe for Playwright's `webServer` config.
 *
 * Scenario branching (additive, keyword-gated): the streaming path inspects the
 * last user message and, when it contains a `MOCK_TRIGGERS` substring, emits a
 * richer stream — `reasoning_content` deltas, a `[[NEXT_STEPS]]` structured
 * block, or a `request_human_input` tool call — so the E2E suite can cover
 * reasoning, structured output and tool/approval flows deterministically.
 * Messages with NO trigger keyword get the plain canned reply byte-for-byte, so
 * every default-path chat spec is unaffected. The exact `delta` wire fields
 * (`content`, `reasoning_content`, `tool_calls`) match what the AI SDK's
 * openai-compatible parser reads.
 *
 * Started by `playwright.config.ts`; never part of the production stack.
 */

import {
  CANNED_HUMAN_INPUT_ACK,
  CANNED_HUMAN_INPUT_FIELD_LABEL,
  CANNED_HUMAN_INPUT_QUESTION,
  CANNED_NEXT_STEPS_TEXT,
  CANNED_REASONING,
  CANNED_REASONING_ANSWER,
  CANNED_REPLY,
  MOCK_TRIGGERS,
} from './canned';

// Fixed port — the single source of truth. The provider fixture's `baseUrl`
// (`e2e/fixtures/config/default/providers/e2e-mock.json`) is loaded verbatim
// into Convex and cannot interpolate env, so the mock must always listen here
// for provider calls to reach it. Keep `MOCK_LLM_PORT` and that fixture in sync.
const MOCK_LLM_PORT = 4141;

// Canned content for structured-output requests (`response_format` of any
// `json*` type): callers that parse the content as JSON (router, title
// generation) get a harmless empty object instead of a parse error.
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
 * from this (instead of `unknown`) keeps the parse path type-safe per the
 * repo's no-`unknown` rule.
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
 * `ChatCompletionRequest` (matching the prior lenient behaviour).
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
  | 'reasoning'
  | 'nextSteps'
  | 'humanInputTool'
  | 'humanInputAck';

function userTexts(messages: ParsedMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.toLowerCase());
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
  if (last.includes(MOCK_TRIGGERS.reasoning)) return 'reasoning';
  if (last.includes(MOCK_TRIGGERS.nextSteps)) return 'nextSteps';
  return 'canned';
}

/** The plain-text content a (non-tool) scenario streams as `delta.content`. */
function scenarioContent(
  scenario: Scenario,
  body: ChatCompletionRequest,
): string {
  switch (scenario) {
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
  const content = formatType.startsWith('json')
    ? CANNED_JSON_REPLY
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

      // Reasoning scenario streams `reasoning_content` first; the SDK closes the
      // reasoning block automatically on the first `content` delta.
      if (scenario === 'reasoning') {
        for (const delta of toDeltas(CANNED_REASONING)) {
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

const server = Bun.serve({
  port: MOCK_LLM_PORT,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok');
    }

    if (
      request.method === 'POST' &&
      url.pathname.endsWith('/chat/completions')
    ) {
      // `Request.json()` is typed `Promise<any>` by bun-types; the explicit
      // `JsonValue` annotation pins it to our JSON union so every read below is
      // type-safe without `any`/`unknown`.
      let parsed: JsonValue;
      try {
        parsed = await request.json();
      } catch (error) {
        console.warn('[mock-llm] non-JSON request body:', error);
        return new Response('invalid JSON body', { status: 400 });
      }
      const body = toChatCompletionRequest(parsed);
      console.log(
        `[mock-llm] POST ${url.pathname} (stream=${body.stream === true}, model=${body.model ?? 'unknown'}, scenario=${pickScenario(body)})`,
      );
      return body.stream === true
        ? streamedCompletion(body)
        : jsonCompletion(body);
    }

    console.warn(`[mock-llm] unhandled ${request.method} ${url.pathname}`);
    return new Response('not found', { status: 404 });
  },
});

console.log(`[mock-llm] listening on http://127.0.0.1:${server.port}`);
