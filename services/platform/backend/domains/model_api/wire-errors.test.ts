/**
 * The REST door's own refusals on a model endpoint — answered before the
 * model route runs, in the door's flat `{error, code}` envelope — reach the
 * caller in the wire's error shape, status, code and headers kept; the
 * `x-api-key` refusal on the Anthropic endpoint says how Claude Code and the
 * Anthropic SDKs send a key as a bearer token. Other paths are untouched.
 */

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { apiKeyHeaderGuard } from '../../lib/http-hygiene.ts';
import { modelApiKeyHeaderHint, modelApiWireErrors } from './wire-errors.ts';

function app() {
  const hono = new Hono();
  hono.use('/api/v1/openai/*', modelApiWireErrors());
  hono.use('/api/v1/anthropic/*', modelApiWireErrors());
  hono.use(
    apiKeyHeaderGuard(['x-api-key'], { hintFor: modelApiKeyHeaderHint }),
  );
  hono.get('/api/v1/openai/models', (c) =>
    c.json(
      {
        error: 'Missing or invalid Authorization header',
        code: 'UNAUTHORIZED',
      },
      401,
      { 'www-authenticate': 'Bearer' },
    ),
  );
  hono.post('/api/v1/anthropic/v1/messages', (c) =>
    c.json(
      {
        error: 'Too many requests — retry after 500 ms',
        code: 'RATE_LIMITED',
        requestId: 'req-1',
      },
      429,
      { 'retry-after': '1' },
    ),
  );
  hono.post('/api/v1/openai/chat/completions', (c) =>
    c.json({ error: { message: 'already shaped', code: 'X' } }, 400),
  );
  hono.get('/api/v1/openai/ok', (c) => c.json({ object: 'list', data: [] }));
  hono.get('/api/v1/me', (c) =>
    c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401),
  );
  return hono;
}

describe('modelApiWireErrors', () => {
  it('reshapes the door’s refusal on the OpenAI wire, keeping status and headers', async () => {
    const res = await app().request('http://localhost/api/v1/openai/models');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({
      error: {
        message: 'Missing or invalid Authorization header',
        type: 'authentication_error',
        param: null,
        code: 'UNAUTHORIZED',
      },
    });
  });

  it('reshapes it on the Anthropic wire, with the request id the envelope carried', async () => {
    const res = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages',
      { method: 'POST' },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(res.headers.get('request-id')).toBe('req-1');
    expect(await res.json()).toEqual({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Too many requests — retry after 500 ms',
        code: 'RATE_LIMITED',
      },
      request_id: 'req-1',
    });
  });

  it('leaves a body already in the wire’s shape, and a success, alone', async () => {
    const shaped = await app().request(
      'http://localhost/api/v1/openai/chat/completions',
      { method: 'POST' },
    );
    expect(await shaped.json()).toEqual({
      error: { message: 'already shaped', code: 'X' },
    });
    const ok = await app().request('http://localhost/api/v1/openai/ok');
    expect(await ok.json()).toEqual({ object: 'list', data: [] });
  });

  it('leaves every other REST path in the flat envelope', async () => {
    const res = await app().request('http://localhost/api/v1/me');
    expect(await res.json()).toEqual({
      error: 'Invalid API key',
      code: 'UNAUTHORIZED',
    });
  });
});

describe('the x-api-key refusal on the model endpoints', () => {
  it('tells an Anthropic client to send the key as an auth token, in the Anthropic shape', async () => {
    const res = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages',
      { method: 'POST', headers: { 'x-api-key': 'tale_key' } },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    const body = (await res.json()) as {
      type: string;
      error: { type: string; message: string; code: string };
    };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Authorization: Bearer <key>');
    expect(body.error.message).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  it('adds nothing to the refusal on any other path', async () => {
    const res = await app().request('http://localhost/api/v1/me', {
      headers: { 'x-api-key': 'tale_key' },
    });
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'The "x-api-key" header is not accepted — send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
    );
  });
});
