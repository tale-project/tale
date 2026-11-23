import { describe, expect, it } from 'vitest';

import {
  errorBody,
  errorResponse,
  presentedCredential,
  routeOf,
} from './wires.ts';

describe('the routes the relay serves', () => {
  it('serves the four wires at the paths the gateway served them', () => {
    expect(routeOf('POST', '/anthropic/v1/messages')).toEqual({
      kind: 'generate',
      wire: 'anthropic',
    });
    expect(routeOf('POST', '/openai/v1/chat/completions')).toEqual({
      kind: 'generate',
      wire: 'openai-chat',
    });
    expect(routeOf('POST', '/openai/v1/responses')).toEqual({
      kind: 'generate',
      wire: 'openai-responses',
    });
    expect(
      routeOf(
        'POST',
        '/genai/v1beta/models/anthropic/claude-sonnet-5-5:streamGenerateContent',
      ),
    ).toEqual({
      kind: 'generate',
      wire: 'genai',
      path: { model: 'anthropic/claude-sonnet-5-5', stream: true },
    });
    expect(
      routeOf('POST', '/genai/v1/models/gemini%2Fgemini-3-pro:generateContent'),
    ).toEqual({
      kind: 'generate',
      wire: 'genai',
      path: { model: 'gemini/gemini-3-pro', stream: false },
    });
  });

  it('counts tokens, lists models and answers its health check', () => {
    expect(routeOf('POST', '/anthropic/v1/messages/count_tokens')).toEqual({
      kind: 'count-tokens',
      wire: 'anthropic',
    });
    expect(
      routeOf('POST', '/genai/v1beta/models/gemini/gemini-3-pro:countTokens'),
    ).toEqual({
      kind: 'count-tokens',
      wire: 'genai',
      path: { model: 'gemini/gemini-3-pro' },
    });
    expect(routeOf('GET', '/openai/v1/models')).toEqual({ kind: 'models' });
    expect(routeOf('GET', '/health')).toEqual({ kind: 'health' });
  });

  it('serves nothing else: it is no general proxy', () => {
    expect(routeOf('GET', '/anthropic/v1/messages')).toBeNull();
    expect(routeOf('POST', '/api/v1/chat')).toBeNull();
    expect(routeOf('POST', '/openai/v1/embeddings')).toBeNull();
    expect(routeOf('DELETE', '/openai/v1/responses')).toBeNull();
    expect(routeOf('POST', '/genai/v1beta/models/x:embedContent')).toBeNull();
    expect(
      routeOf('POST', '/genai/v1beta/models/%E0%A4%A:generateContent'),
    ).toBeNull();
  });
});

describe('the credential a request presents', () => {
  const none = new URLSearchParams();

  it('reads a bearer token, an x-api-key, an x-goog-api-key or a ?key=', () => {
    expect(
      presentedCredential(new Headers({ authorization: 'Bearer tok-1' }), none),
    ).toBe('tok-1');
    expect(
      presentedCredential(new Headers({ 'x-api-key': 'tok-2' }), none),
    ).toBe('tok-2');
    expect(
      presentedCredential(new Headers({ 'x-goog-api-key': 'tok-3' }), none),
    ).toBe('tok-3');
    expect(
      presentedCredential(
        new Headers(),
        new URLSearchParams('key=tok-4&alt=sse'),
      ),
    ).toBe('tok-4');
  });

  it('takes no other authorization scheme, and nothing from an empty request', () => {
    expect(
      presentedCredential(
        new Headers({ authorization: 'Basic dXNlcjpwdw==' }),
        none,
      ),
    ).toBeNull();
    expect(presentedCredential(new Headers(), none)).toBeNull();
  });
});

describe('a refusal, in each wire’s own error shape', () => {
  it('says a spent allowance with 402 on every wire', async () => {
    expect(errorBody('anthropic', 'budget', 'spent')).toEqual({
      type: 'error',
      error: { type: 'billing_error', message: 'spent' },
    });
    expect(errorBody('openai-chat', 'budget', 'spent')).toEqual({
      error: {
        message: 'spent',
        type: 'insufficient_quota',
        param: null,
        code: null,
      },
    });
    expect(errorBody('genai', 'budget', 'spent')).toEqual({
      error: { code: 402, message: 'spent', status: 'RESOURCE_EXHAUSTED' },
    });
    const response = errorResponse('openai-responses', 'budget', 'spent');
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { message: 'spent' },
    });
  });
});
