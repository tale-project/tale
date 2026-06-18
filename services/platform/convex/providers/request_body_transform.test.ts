import { describe, expect, it, vi } from 'vitest';

import {
  createWireTransformFetch,
  mergeRequestBodyMap,
  transformRequestBody,
  type WireTransformModelData,
} from './request_body_transform';

const reasoning = { knob: 'effort' as const };

describe('transformRequestBody', () => {
  it('returns an equivalent body and does not mutate the input when there is no config', () => {
    const body = { model: 'gpt-4o', max_tokens: 4096 };
    const out = transformRequestBody(body, {});
    expect(out).toEqual({ model: 'gpt-4o', max_tokens: 4096 });
    expect(out).not.toBe(body);
    expect(body).toEqual({ model: 'gpt-4o', max_tokens: 4096 });
  });

  it('renames a field via requestBodyMap.rename', () => {
    const out = transformRequestBody(
      { max_tokens: 4096, model: 'x' },
      { requestBodyMap: { rename: { max_tokens: 'max_completion_tokens' } } },
    );
    expect(out).toEqual({ max_completion_tokens: 4096, model: 'x' });
    expect(out).not.toHaveProperty('max_tokens');
  });

  it('removes fields via requestBodyMap.remove (after rename)', () => {
    const out = transformRequestBody(
      { max_tokens: 4096, frequency_penalty: 0.2 },
      {
        requestBodyMap: {
          rename: { max_tokens: 'max_completion_tokens' },
          remove: ['frequency_penalty'],
        },
      },
    );
    expect(out).toEqual({ max_completion_tokens: 4096 });
  });

  it('applies the reasoning default: max_tokens → max_completion_tokens', () => {
    const out = transformRequestBody({ max_tokens: 8192 }, { reasoning });
    expect(out).toEqual({ max_completion_tokens: 8192 });
  });

  it('does NOT rename for a non-reasoning model (gpt-4o is untouched)', () => {
    const out = transformRequestBody({ max_tokens: 8192 }, {});
    expect(out).toEqual({ max_tokens: 8192 });
  });

  it('lets an operator rename of max_tokens suppress the reasoning default', () => {
    // Operator maps max_tokens → something else; the auto-rename must not then
    // re-add max_completion_tokens from a now-absent max_tokens.
    const out = transformRequestBody(
      { max_tokens: 8192 },
      { reasoning, requestBodyMap: { rename: { max_tokens: 'maxTokens' } } },
    );
    expect(out).toEqual({ maxTokens: 8192 });
  });

  it('does not clobber an existing max_completion_tokens with the reasoning default', () => {
    const out = transformRequestBody(
      { max_tokens: 8192, max_completion_tokens: 100 },
      { reasoning },
    );
    expect(out).toEqual({ max_tokens: 8192, max_completion_tokens: 100 });
  });

  it('no-ops on a body without max_tokens (image-shaped request)', () => {
    const out = transformRequestBody(
      { model: 'dall-e-3', prompt: 'a cat', size: '1024x1024' },
      { reasoning },
    );
    expect(out).toEqual({
      model: 'dall-e-3',
      prompt: 'a cat',
      size: '1024x1024',
    });
  });
});

describe('mergeRequestBodyMap', () => {
  it('returns undefined when both sides are absent', () => {
    expect(mergeRequestBodyMap(undefined, undefined)).toBeUndefined();
  });

  it('merges rename sub-keys with the model level winning', () => {
    const merged = mergeRequestBodyMap(
      { rename: { max_tokens: 'max_completion_tokens', a: 'b' } },
      { rename: { a: 'c' } },
    );
    expect(merged).toEqual({
      rename: { max_tokens: 'max_completion_tokens', a: 'c' },
    });
  });

  it('replaces the remove array wholesale (model wins)', () => {
    const merged = mergeRequestBodyMap(
      { remove: ['x', 'y'] },
      { remove: ['z'] },
    );
    expect(merged).toEqual({ remove: ['z'] });
  });

  it('keeps the provider remove when the model omits it', () => {
    const merged = mergeRequestBodyMap(
      { remove: ['x'] },
      { rename: { a: 'b' } },
    );
    expect(merged).toEqual({ remove: ['x'], rename: { a: 'b' } });
  });
});

describe('createWireTransformFetch', () => {
  function captureFetch() {
    const calls: { input: unknown; init?: RequestInit }[] = [];
    const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response('{}');
    });
    return { fn, calls };
  }

  it('transforms a string JSON body and forwards the result to the inner fetch', async () => {
    const { fn, calls } = captureFetch();
    const modelData: WireTransformModelData = { reasoning };
    const wire = createWireTransformFetch(modelData, fn as never);
    await wire('https://x/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ max_tokens: 1024 }),
    });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      max_completion_tokens: 1024,
    });
  });

  it('passes non-string bodies through untouched (multipart/FormData)', async () => {
    const { fn, calls } = captureFetch();
    const wire = createWireTransformFetch(
      { requestBodyMap: { rename: { a: 'b' } } },
      fn as never,
    );
    const form = new FormData();
    await wire('https://x/v1/audio/transcriptions', {
      method: 'POST',
      body: form,
    });
    expect(calls[0].init?.body).toBe(form);
  });

  it('passes a non-JSON string body through untouched', async () => {
    const { fn, calls } = captureFetch();
    const wire = createWireTransformFetch({ reasoning }, fn as never);
    await wire('https://x', { method: 'POST', body: 'not json' });
    expect(calls[0].init?.body).toBe('not json');
  });

  it('returns the inner fetch unchanged when there is no transform work', () => {
    const { fn } = captureFetch();
    const wire = createWireTransformFetch({}, fn as never);
    expect(wire).toBe(fn);
  });
});
