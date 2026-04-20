import { describe, expect, it } from 'vitest';

import { __test } from './http_actions';

const {
  parseWebhookPath,
  extractLastUserMessage,
  collectSystemPrompts,
  contentToString,
  TOKEN_REGEX,
  MAX_CLIENT_SYSTEM_CHARS,
} = __test;

const VALID_TOKEN = 'a'.repeat(64);

describe('parseWebhookPath', () => {
  it('parses the legacy webhook path', () => {
    const r = parseWebhookPath(`/api/agents/wh/${VALID_TOKEN}`);
    expect(r).toEqual({ token: VALID_TOKEN, mode: 'legacy' });
  });

  it('parses the OpenAI-compat sub-path', () => {
    const r = parseWebhookPath(
      `/api/agents/wh/${VALID_TOKEN}/chat/completions`,
    );
    expect(r).toEqual({ token: VALID_TOKEN, mode: 'openai' });
  });

  it('rejects unknown sub-paths with 404', () => {
    expect(
      parseWebhookPath(`/api/agents/wh/${VALID_TOKEN}/completions`),
    ).toEqual({ error: expect.any(String), status: 404 });
    expect(parseWebhookPath(`/api/agents/wh/${VALID_TOKEN}/chat`)).toEqual({
      error: expect.any(String),
      status: 404,
    });
    expect(
      parseWebhookPath(`/api/agents/wh/${VALID_TOKEN}/chat/completions/extra`),
    ).toEqual({ error: expect.any(String), status: 404 });
  });

  it('rejects malformed base paths with 400', () => {
    expect(parseWebhookPath('/something/else')).toEqual({
      error: expect.any(String),
      status: 400,
    });
    expect(parseWebhookPath('/api/agents')).toEqual({
      error: expect.any(String),
      status: 400,
    });
    expect(parseWebhookPath('/api/agents/wh')).toEqual({
      error: expect.any(String),
      status: 400,
    });
  });

  it('tolerates trailing slash on the legacy form', () => {
    const r = parseWebhookPath(`/api/agents/wh/${VALID_TOKEN}/`);
    expect(r).toEqual({ token: VALID_TOKEN, mode: 'legacy' });
  });

  it('extracts the token from the fixed position regardless of suffix length', () => {
    const r = parseWebhookPath(
      `/api/agents/wh/${VALID_TOKEN}/chat/completions`,
    );
    expect('token' in r && r.token).toBe(VALID_TOKEN);
  });
});

describe('TOKEN_REGEX', () => {
  it('matches 64 lowercase hex characters', () => {
    expect(TOKEN_REGEX.test('a'.repeat(64))).toBe(true);
    expect(TOKEN_REGEX.test('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('rejects wrong-length tokens', () => {
    expect(TOKEN_REGEX.test('a'.repeat(63))).toBe(false);
    expect(TOKEN_REGEX.test('a'.repeat(65))).toBe(false);
    expect(TOKEN_REGEX.test('')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(TOKEN_REGEX.test('g'.repeat(64))).toBe(false);
    expect(TOKEN_REGEX.test('A'.repeat(64))).toBe(false); // uppercase not allowed
    expect(TOKEN_REGEX.test(`chat/completions${'a'.repeat(48)}`)).toBe(false);
  });
});

describe('contentToString', () => {
  it('returns a string as-is', () => {
    expect(contentToString('hello')).toBe('hello');
    expect(contentToString('')).toBe('');
  });

  it('extracts text parts from an array', () => {
    expect(
      contentToString([
        { type: 'text', text: 'hello' },
        { type: 'text', text: ' world' },
      ]),
    ).toBe('hello world');
  });

  it('ignores non-text parts', () => {
    expect(
      contentToString([
        { type: 'text', text: 'see this:' },
        { type: 'image_url', image_url: { url: 'http://x' } },
        { type: 'text', text: ' done' },
      ]),
    ).toBe('see this: done');
  });

  it('returns empty string for null, undefined, number, object', () => {
    expect(contentToString(null)).toBe('');
    expect(contentToString(undefined)).toBe('');
    expect(contentToString(42)).toBe('');
    expect(contentToString({ foo: 1 })).toBe('');
  });

  it('drops text parts with non-string text field', () => {
    expect(
      contentToString([
        { type: 'text', text: 'good' },
        { type: 'text', text: 42 },
      ]),
    ).toBe('good');
  });
});

describe('extractLastUserMessage', () => {
  it('returns the only user message', () => {
    expect(extractLastUserMessage([{ role: 'user', content: 'hello' }])).toBe(
      'hello',
    );
  });

  it('returns the last user message when system+user pair (Meetily shape)', () => {
    expect(
      extractLastUserMessage([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'please summarise' },
      ]),
    ).toBe('please summarise');
  });

  it('skips assistant turns when finding the last user message', () => {
    expect(
      extractLastUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'last' },
      ]),
    ).toBe('last');
  });

  it('returns null when no user role is present', () => {
    expect(
      extractLastUserMessage([{ role: 'system', content: 'x' }]),
    ).toBeNull();
    expect(extractLastUserMessage([])).toBeNull();
  });

  it('flattens array-form content on the user turn', () => {
    expect(
      extractLastUserMessage([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'image_url', image_url: { url: 'http://x' } },
            { type: 'text', text: 'world' },
          ],
        },
      ]),
    ).toBe('hello world');
  });

  it('returns empty string for null content on the user turn', () => {
    expect(extractLastUserMessage([{ role: 'user', content: null }])).toBe('');
  });
});

describe('collectSystemPrompts', () => {
  it('returns empty string when no system messages are present', () => {
    expect(collectSystemPrompts([{ role: 'user', content: 'x' }])).toBe('');
  });

  it('collects a single system message', () => {
    expect(
      collectSystemPrompts([
        { role: 'system', content: 'You are a pirate.' },
        { role: 'user', content: 'hi' },
      ]),
    ).toBe('You are a pirate.');
  });

  it('joins multiple system messages with a blank line, preserving order', () => {
    expect(
      collectSystemPrompts([
        { role: 'system', content: 'A' },
        { role: 'user', content: 'ignore me' },
        { role: 'system', content: 'B' },
      ]),
    ).toBe('A\n\nB');
  });

  it('trims and skips whitespace-only system messages', () => {
    expect(
      collectSystemPrompts([
        { role: 'system', content: '   ' },
        { role: 'system', content: '  real content  ' },
      ]),
    ).toBe('real content');
  });

  it('handles array-form content in system messages', () => {
    expect(
      collectSystemPrompts([
        {
          role: 'system',
          content: [
            { type: 'text', text: 'part one ' },
            { type: 'text', text: 'part two' },
          ],
        },
      ]),
    ).toBe('part one part two');
  });
});

describe('MAX_CLIENT_SYSTEM_CHARS', () => {
  it('is a sensible upper bound (~12.5k tokens)', () => {
    expect(MAX_CLIENT_SYSTEM_CHARS).toBeGreaterThan(10_000);
    expect(MAX_CLIENT_SYSTEM_CHARS).toBeLessThanOrEqual(100_000);
  });
});
