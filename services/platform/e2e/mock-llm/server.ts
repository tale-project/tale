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
 * Started by `playwright.config.ts`; never part of the production stack.
 */

import { CANNED_REPLY } from './canned';

const port = Number(process.env.E2E_MOCK_LLM_PORT ?? '4141');

// Canned content for structured-output requests (`response_format` of any
// `json*` type): callers that parse the content as JSON (router, title
// generation) get a harmless empty object instead of a parse error.
const CANNED_JSON_REPLY = '{}';

interface ChatCompletionRequest {
  model?: string;
  stream?: boolean;
  response_format?: { type?: string };
}

function isChatCompletionRequest(
  value: unknown,
): value is ChatCompletionRequest {
  return typeof value === 'object' && value !== null;
}

function pickContent(body: ChatCompletionRequest): string {
  const formatType = body.response_format?.type ?? '';
  return formatType.startsWith('json') ? CANNED_JSON_REPLY : CANNED_REPLY;
}

function completionId(): string {
  return `chatcmpl-e2e-${Date.now().toString(36)}`;
}

function jsonCompletion(body: ChatCompletionRequest): Response {
  const content = pickContent(body);
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

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamedCompletion(body: ChatCompletionRequest): Response {
  const content = pickContent(body);
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? 'e2e-chat-model';
  // Split into word-sized deltas so the UI exercises its real streaming path.
  const deltas = content.match(/\S+\s*/g) ?? [content];

  const base = { id, object: 'chat.completion.chunk', created, model };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send(
        sseChunk({
          ...base,
          choices: [
            { index: 0, delta: { role: 'assistant' }, finish_reason: null },
          ],
        }),
      );
      for (const delta of deltas) {
        send(
          sseChunk({
            ...base,
            choices: [
              { index: 0, delta: { content: delta }, finish_reason: null },
            ],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      send(
        sseChunk({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 16, completion_tokens: 16, total_tokens: 32 },
        }),
      );
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
  port,
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
      let parsed: unknown;
      try {
        parsed = await request.json();
      } catch (error) {
        console.warn('[mock-llm] non-JSON request body:', error);
        return new Response('invalid JSON body', { status: 400 });
      }
      const body = isChatCompletionRequest(parsed) ? parsed : {};
      console.log(
        `[mock-llm] POST ${url.pathname} (stream=${body.stream === true}, model=${body.model ?? 'unknown'})`,
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
