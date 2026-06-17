/**
 * Contract tests for the OpenAI-compatible AI provider mocks.
 *
 * Boots the real gateway in-process on an ephemeral port and asserts that every
 * AI endpoint returns a deterministic, spec-shaped response — the guarantee the
 * hermetic e2e/manual stack and the platform's provider code rely on. The chat
 * route is served by the streaming override; everything else by Prism examples.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { startGateway, type GatewayHandle } from '../gateway';
import { CANNED_ERROR_MESSAGE, CANNED_REPLY } from '../overrides/canned';
import { readJson } from './json';

let gw: GatewayHandle;
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${gw.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  gw = await startGateway(0);
});
afterAll(() => gw.stop());

describe('gateway health + routing', () => {
  test('GET /health returns ok', async () => {
    const res = await fetch(`${gw.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('unknown route → 404', async () => {
    const res = await fetch(`${gw.baseUrl}/nope/nowhere`);
    expect(res.status).toBe(404);
  });
});

describe('chat/completions override', () => {
  test('default → canned reply (non-stream)', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'e2e-chat-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe(CANNED_REPLY);
  });

  test('json response_format → empty object', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'route this' }],
    });
    const body = await readJson(res);
    expect(body.choices[0].message.content).toBe('{}');
  });

  test('error trigger → HTTP 500', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      messages: [{ role: 'user', content: 'e2e:error now' }],
    });
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.error.message).toBe(CANNED_ERROR_MESSAGE);
  });

  test('streaming emits assistant role delta then [DONE]', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"role":"assistant"');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  test('reasoning trigger streams reasoning_content', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:reasoning please' }],
    });
    expect(await res.text()).toContain('reasoning_content');
  });

  test('human-input trigger emits a request_human_input tool call', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'e2e:humaninput go' }],
    });
    const text = await res.text();
    expect(text).toContain('request_human_input');
    expect(text).toContain('"finish_reason":"tool_calls"');
  });
});

describe('Prism-served AI endpoints (deterministic examples)', () => {
  test('POST /v1/embeddings returns a vector', async () => {
    const res = await post('/v1/embeddings', { model: 'x', input: 'hi' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data[0].embedding)).toBe(true);
    expect(body.data[0].embedding.length).toBeGreaterThan(0);
  });

  test('POST /v1/images/generations returns base64 image data', async () => {
    const res = await post('/v1/images/generations', {
      model: 'img',
      prompt: 'a cat',
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(typeof body.data[0].b64_json).toBe('string');
  });

  test('POST /v1/audio/transcriptions returns text + segments', async () => {
    const res = await post('/v1/audio/transcriptions', { model: 'whisper' });
    const body = await readJson(res);
    expect(typeof body.text).toBe('string');
    expect(Array.isArray(body.segments)).toBe(true);
  });

  test('POST /v1/audio/speech returns binary audio bytes', async () => {
    const res = await post('/v1/audio/speech', {
      model: 'tts',
      input: 'hello',
      voice: 'alloy',
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test('responses are deterministic across calls (byte-identical)', async () => {
    const once = await (
      await post('/v1/embeddings', { model: 'x', input: 'a' })
    ).text();
    const twice = await (
      await post('/v1/embeddings', { model: 'x', input: 'a' })
    ).text();
    expect(once).toBe(twice);
  });
});
