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
 *   - A task-triage `score` prompt → its scripted, schema-conforming object
 *     (`docs-replies.ts`), so the workflow's `generateObject` call parses and
 *     the run completes. This must be checked BEFORE the `json*` rule below,
 *     whose `{}` fails that schema and fails every run.
 *   - `response_format` of any other `json*` type → `{}` (router / title
 *     generation parse the content as JSON and must never choke).
 *   - A user message containing a `MOCK_TRIGGERS` substring switches into the
 *     matching scenario (reasoning / next-steps / human-input tool / error).
 *
 * The exact `delta` wire fields (`content`, `reasoning_content`, `tool_calls`)
 * match what `@ai-sdk/openai-compatible` reads in
 * `convex/providers/resolve_model.ts`.
 */

import {
  CANNED_ERROR_MESSAGE,
  CANNED_FILE_WRITE_ACK,
  CANNED_FILE_WRITE_FILES,
  CANNED_HUMAN_INPUT_ACK,
  CANNED_HUMAN_INPUT_FIELD_LABEL,
  CANNED_HUMAN_INPUT_QUESTION,
  CANNED_NEXT_STEPS_TEXT,
  CANNED_PLAN_ACK,
  CANNED_PLAN_TODOS,
  CANNED_REASONING,
  CANNED_REASONING_ANSWER,
  CANNED_REPLY,
  MOCK_TRIGGERS,
} from './canned';
import {
  matchDocsReply,
  matchDocsTriageScore,
  type DocsReplyTool,
} from './docs-replies';

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

/** `file_write` tool call — one per canned file (must satisfy its zod schema). */
const FILE_WRITE_TOOL_NAME = 'file_write';
const FILE_WRITE_TOOL_CALLS: ToolCallDelta[] = CANNED_FILE_WRITE_FILES.map(
  (file, index) => ({
    index,
    id: `call_e2e_fw_${index}`,
    type: 'function' as const,
    function: {
      name: FILE_WRITE_TOOL_NAME,
      arguments: JSON.stringify({ path: file.path, content: file.content }),
    },
  }),
);

/** `update_todos` tool call — seed the plan, first todo in progress. */
const UPDATE_TODOS_TOOL_NAME = 'update_todos';
const PLAN_TOOL_ARGS = JSON.stringify({
  opId: 'e2e-plan-seed-0001',
  operations: [
    ...CANNED_PLAN_TODOS.map((todo) => ({
      type: 'add' as const,
      id: todo.id,
      content: todo.content,
    })),
    {
      type: 'update' as const,
      id: CANNED_PLAN_TODOS[0].id,
      status: 'in_progress' as const,
    },
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
  | 'title'
  | 'docs'
  | 'docsTool'
  | 'taskTriage'
  | 'reasoning'
  | 'nextSteps'
  | 'humanInputTool'
  | 'humanInputAck'
  | 'fileWriteTool'
  | 'fileWriteAck'
  | 'planTool'
  | 'planAck'
  | 'error';

function userTexts(messages: ParsedMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.toLowerCase());
}

/**
 * True for the thread-title generation call (`convex/chat/generate_title.ts`)
 * — identified by its system instructions. It must NEVER fall through to the
 * docs scan: its user message IS the chat's first message, so a docs phrase
 * would match and the scripted REPLY would become the thread's title.
 */
function isTitleGenerationCall(body: ChatCompletionRequest): boolean {
  return (body.messages ?? []).some(
    (message) =>
      message.role === 'system' &&
      message.text.toLowerCase().includes('you are a title generator'),
  );
}

/**
 * A deterministic title for the mock: the first words of the user's message
 * verbatim (capped, no trailing cut-off punctuation). Keeping the PROMPT's
 * leading characters intact is load-bearing for the docs seed: `ensureChats`
 * re-identifies a seeded thread in the history list by the first 40 chars of
 * its prompt.
 */
function mockTitleFor(body: ChatCompletionRequest): string {
  const users = (body.messages ?? []).filter((m) => m.role === 'user');
  const text = users[users.length - 1]?.text.trim() ?? '';
  if (text.length === 0) return 'New chat';
  return text.slice(0, 60).replace(/[\s.,;:!?-]+$/, '');
}

/**
 * The docs entry for this conversation: every message text scanned
 * NEWEST-FIRST — system messages included, because a resume can arrive as a
 * REBUILT conversation where the on-camera prompt that owns the script
 * survives only inside a system message's embedded history block. Docs
 * phrases are distinctive full clauses, so scanning system text cannot
 * shadow the e2e paths.
 */
function matchDocsReplyInConversation(
  body: ChatCompletionRequest,
): ReturnType<typeof matchDocsReply> {
  const messages = body.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const matched = matchDocsReply(
      messages[i]?.text.toLowerCase() ?? '',
      body.model,
    );
    if (matched) return matched;
  }
  return null;
}

/**
 * True once the conversation already carries a tool call / result (or the
 * injected `<human_response>` context) — i.e. a post-tool resume turn, where a
 * tool scenario must answer in plain text instead of re-emitting its tool call
 * (which would loop). Shared by every tool scenario (human-input, file-write,
 * plan): the trigger keyword lives in the pinned user message, so scenario
 * identity is chosen by the keyword and only the tool-vs-ack phase toggles here.
 */
function isToolResume(messages: ParsedMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' ||
      message.hasToolCalls ||
      message.text.includes('human_response'),
  );
}

/**
 * The scripted structured output when this request is the task-triage
 * workflow's `score` step (its prompt carries the candidate-list marker AND a
 * seeded task title), else null. Checked across every user message because the
 * step sends its prompt as the sole user turn.
 */
function triageScore(body: ChatCompletionRequest): string | null {
  for (const text of userTexts(body.messages ?? [])) {
    const score = matchDocsTriageScore(text);
    if (score !== null) return score;
  }
  return null;
}

function pickScenario(body: ChatCompletionRequest): Scenario {
  const messages = body.messages ?? [];
  // The triage step is itself a `json_schema` call, so it MUST win over the
  // blanket `{}` below — that empty object fails its schema and fails the run.
  if (triageScore(body) !== null) return 'taskTriage';
  // Thread-title generation is a plain-text call whose user message is the
  // chat's first message — decide it BEFORE the docs scan (see
  // isTitleGenerationCall) or scripted replies become thread titles.
  if (isTitleGenerationCall(body)) return 'title';
  // JSON-format calls (the automation router) keep the canned `{}` path.
  if ((body.response_format?.type ?? '').startsWith('json')) return 'canned';
  const users = userTexts(messages);
  const resume = isToolResume(messages);
  if (users.some((text) => text.includes(MOCK_TRIGGERS.humanInput))) {
    return resume ? 'humanInputAck' : 'humanInputTool';
  }
  if (users.some((text) => text.includes(MOCK_TRIGGERS.fileWrite))) {
    return resume ? 'fileWriteAck' : 'fileWriteTool';
  }
  if (users.some((text) => text.includes(MOCK_TRIGGERS.plan))) {
    return resume ? 'planAck' : 'planTool';
  }
  const last = users[users.length - 1] ?? '';
  if (last.includes(MOCK_TRIGGERS.error)) return 'error';
  if (last.includes(MOCK_TRIGGERS.reasoning)) return 'reasoning';
  if (last.includes(MOCK_TRIGGERS.nextSteps)) return 'nextSteps';
  // Docs-pipeline phrases come last so an e2e trigger always wins; anything
  // unmatched stays on the spec-pinned canned path. A tool-scripted entry
  // emits its tool call on the first turn and its `reply` on the resume turn
  // (whose LAST user message is the human-response wrapper — hence the
  // newest-first conversation scan).
  const docsReply = matchDocsReplyInConversation(body);
  if (docsReply) return docsReply.tool && !resume ? 'docsTool' : 'docs';
  return 'canned';
}

/** The streamed tool-call delta(s) for a docs entry's scripted tool. */
function docsToolCallDeltas(tool: DocsReplyTool): ToolCallDelta[] {
  if (tool.name === 'file_write') {
    return tool.files.map((file, index) => ({
      index,
      id: `call_docs_fw_${index}`,
      type: 'function' as const,
      function: {
        name: FILE_WRITE_TOOL_NAME,
        arguments: JSON.stringify({ path: file.path, content: file.content }),
      },
    }));
  }
  return [
    {
      index: 0,
      id: 'call_docs_hi_0',
      type: 'function' as const,
      function: {
        name: HUMAN_INPUT_TOOL_NAME,
        arguments: JSON.stringify({
          question: tool.question,
          fields: tool.fields,
        }),
      },
    },
  ];
}

/** The plain-text content a (non-tool) scenario streams as `delta.content`. */
function scenarioContent(
  scenario: Scenario,
  body: ChatCompletionRequest,
): string {
  switch (scenario) {
    case 'title':
      return mockTitleFor(body);
    case 'docs':
    case 'docsTool':
      return matchDocsReplyInConversation(body)?.reply ?? CANNED_REPLY;
    case 'taskTriage':
      return triageScore(body) ?? CANNED_JSON_REPLY;
    case 'reasoning':
      return CANNED_REASONING_ANSWER;
    case 'nextSteps':
      return CANNED_NEXT_STEPS_TEXT;
    case 'humanInputAck':
      return CANNED_HUMAN_INPUT_ACK;
    case 'fileWriteAck':
      return CANNED_FILE_WRITE_ACK;
    case 'planAck':
      return CANNED_PLAN_ACK;
    default: {
      const formatType = body.response_format?.type ?? '';
      return formatType.startsWith('json') ? CANNED_JSON_REPLY : CANNED_REPLY;
    }
  }
}

function completionId(): string {
  return `chatcmpl-e2e-${Date.now().toString(36)}`;
}

/**
 * The content of a single (non-streamed) completion. Only the two docs-pipeline
 * scenarios may reach it:
 *
 *  - `taskTriage` — the workflow `score` step is a non-streamed structured call,
 *    and it is a `json*` request, so its script MUST be honoured ahead of the
 *    `{}` below (which fails the step's schema and fails the whole run).
 *  - `docs` — the seeded demo chats issue plain (non-streamed) generation calls,
 *    and a docs phrase that silently fell back to the canned reply would ship a
 *    fake-looking shot.
 *
 * The streaming-chat e2e scenarios (nextSteps/reasoning/humanInput) must NOT
 * leak here: thread-title generation is a non-streamed `generateText` call whose
 * prompt is the user's first message, so routing it to `nextSteps` would surface
 * the raw `[[NEXT_STEPS]]` marker as the thread title.
 */
function jsonCompletionContent(body: ChatCompletionRequest): string {
  const scenario = pickScenario(body);
  if (scenario === 'taskTriage') return scenarioContent(scenario, body);
  if (scenario === 'title') return scenarioContent(scenario, body);
  if ((body.response_format?.type ?? '').startsWith('json'))
    return CANNED_JSON_REPLY;
  // A tool-scripted docs entry still answers text-only here.
  if (scenario === 'docs' || scenario === 'docsTool')
    return scenarioContent(scenario, body);
  return CANNED_REPLY;
}

function jsonCompletion(body: ChatCompletionRequest): Response {
  const content = jsonCompletionContent(body);
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
      // Delta cadence. The docs VIDEO pipeline slows it via
      // TALE_MOCK_STREAM_PACE_MS on the gateway process so a streamed answer
      // reads naturally on camera; unset, streams stay fast for e2e/screenshots.
      const paceMs = Number(process.env.TALE_MOCK_STREAM_PACE_MS ?? '') || 10;
      const pause = () => new Promise((resolve) => setTimeout(resolve, paceMs));

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

      // A docs entry's scripted tool turn: reasoning first (thinking before
      // acting reads naturally on camera), then the tool call(s). The agent
      // executes them and loops back; the resume turn streams the `reply`.
      const docsTool =
        scenario === 'docsTool' ? matchDocsReplyInConversation(body) : null;
      if (docsTool?.tool) {
        if (docsTool.reasoning) {
          for (const delta of toDeltas(docsTool.reasoning)) {
            sendDelta({ reasoning_content: delta }, null);
            await pause();
          }
        }
        // A short visible sentence before the call — the natural model
        // shape, and what keeps a PAUSING tool turn from being judged an
        // empty generation (see DocsReply.toolIntro).
        if (docsTool.toolIntro) {
          for (const delta of toDeltas(docsTool.toolIntro)) {
            sendDelta({ content: delta }, null);
            await pause();
          }
        }
        for (const call of docsToolCallDeltas(docsTool.tool)) {
          sendDelta({ tool_calls: [call] }, null);
          await pause();
        }
        sendDelta({}, 'tool_calls', USAGE);
        send('data: [DONE]\n\n');
        controller.close();
        return;
      }

      if (scenario === 'fileWriteTool' || scenario === 'planTool') {
        // Batch tool call(s): every `file_write` executes server-side (no
        // sandbox), landing files the Canvas/Workspace panes render; the single
        // `update_todos` seeds the Plan pane. Names ride the first delta per
        // index; arguments are pre-serialized and valid. finish=tool_calls, so
        // the agent runs the tools and loops back for the plain-text ack turn.
        const toolCalls =
          scenario === 'fileWriteTool'
            ? FILE_WRITE_TOOL_CALLS
            : [
                {
                  index: 0,
                  id: `call_e2e_plan_${Date.now().toString(36)}`,
                  type: 'function' as const,
                  function: {
                    name: UPDATE_TODOS_TOOL_NAME,
                    arguments: PLAN_TOOL_ARGS,
                  },
                },
              ];
        for (const call of toolCalls) {
          sendDelta({ tool_calls: [call] }, null);
          await pause();
        }
        sendDelta({}, 'tool_calls', USAGE);
        send('data: [DONE]\n\n');
        controller.close();
        return;
      }

      // Reasoning streams `reasoning_content` first; the SDK closes the
      // reasoning block automatically on the first `content` delta. Docs
      // replies opt into the same path via their `reasoning` field — except
      // on a tool entry's ack turn, whose thinking already ran on the tool
      // turn; repeating it would render a second "Thinking" block.
      const docsMatch =
        scenario === 'docs' ? matchDocsReplyInConversation(body) : null;
      const reasoningText =
        scenario === 'reasoning'
          ? CANNED_REASONING
          : docsMatch && !docsMatch.tool
            ? (docsMatch.reasoning ?? null)
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
  if (process.env.TALE_MOCK_TRACE_MESSAGES === '1') {
    for (const message of body.messages ?? []) {
      console.log(
        `    · ${message.role}${message.hasToolCalls ? '+tools' : ''}: ${message.text.slice(0, 90).replace(/\n/g, ' ')}`,
      );
    }
  }
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
