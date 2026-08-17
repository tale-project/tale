import { describe, expect, it } from 'vitest';

import { encodeChatError } from '@/lib/shared/chat-errors';

import { sanitizeChatError } from './sanitize-chat-error';

/** The shape api.openai.com actually answers with — pretty-printed, multi-line.
 * The regression this file guards: first-lining this body used to reduce the
 * whole diagnostic to `{`. */
const OPENAI_400_BODY = [
  'The model provider answered 400: {',
  '    "error": {',
  `        "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",`,
  '        "type": "invalid_request_error",',
  '        "param": "max_tokens",',
  '        "code": "unsupported_parameter"',
  '    }',
  '}',
].join('\n');

describe('sanitizeChatError raw surfaces', () => {
  it('keeps a pretty-printed provider body whole for the disclosure', () => {
    const sanitized = sanitizeChatError(
      encodeChatError({
        code: 'unsupported_parameter',
        provider: 'openai',
        model: 'gpt-5.5',
        raw: OPENAI_400_BODY,
      }),
    );
    expect(sanitized.code).toBe('unsupported_parameter');
    expect(sanitized.rawMessage).toBe(OPENAI_400_BODY);
    expect(sanitized.rawSummary).toBe('The model provider answered 400: {');
  });

  it('classifies the body itself when the envelope carries no code', () => {
    const sanitized = sanitizeChatError(OPENAI_400_BODY);
    expect(sanitized.code).toBe('unsupported_parameter');
    expect(sanitized.rawMessage).toContain("'max_completion_tokens' instead");
  });

  it('keeps provider text containing URLs and route paths', () => {
    const raw =
      'The model provider answered 402: {"error":{"message":"Add credits at https://openrouter.ai/credits to continue using /v1/chat/completions"}}';
    const sanitized = sanitizeChatError(raw);
    // The toast line must still refuse it (URL), the disclosure must not.
    expect(sanitized.rawSummary).toBeUndefined();
    expect(sanitized.rawMessage).toBe(raw);
  });

  it('strips stack frames and internal paths but keeps the message lines', () => {
    const raw = [
      'The model returned a non-object payload',
      '    at parseChatReply (chat_wire.ts:364:19)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      'caused by a truncated body in node_modules/undici/lib/response.js',
    ].join('\n');
    const sanitized = sanitizeChatError(raw);
    expect(sanitized.rawMessage).toBe(
      'The model returned a non-object payload',
    );
    expect(sanitized.rawSummary).toBe(
      'The model returned a non-object payload',
    );
  });

  it('keeps prose that merely starts with "at"', () => {
    const raw = 'at most 10 images are allowed per request';
    expect(sanitizeChatError(raw).rawMessage).toBe(raw);
  });

  it('keeps an oversize single-line body in the disclosure, not the toast', () => {
    const raw = `The model provider answered 400: {"error":{"message":"${'x'.repeat(400)}"}}`;
    const sanitized = sanitizeChatError(raw);
    expect(sanitized.rawSummary).toBeUndefined();
    expect(sanitized.rawMessage).toBe(raw);
  });

  it('truncates a runaway body instead of dropping it', () => {
    const sanitized = sanitizeChatError(`prefix ${'y'.repeat(10_000)}`);
    expect(sanitized.rawMessage).toHaveLength(4001);
    expect(sanitized.rawMessage?.endsWith('…')).toBe(true);
  });

  it('yields no raw surfaces when only stack frames remain', () => {
    const sanitized = sanitizeChatError(
      '    at run (node_modules/ai/dist/index.js:10:2)',
    );
    expect(sanitized.rawSummary).toBeUndefined();
    expect(sanitized.rawMessage).toBeUndefined();
  });
});
