/**
 * One image call through the platform's audited outbound client: the
 * provider's refusal comes back as its own (redacted) sentence, and the
 * ledger figure is the provider's reported charge or the catalog price of
 * the tokens it reported. `safeFetch` is stubbed — no paid call is made.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import { generateOneImage, ImageProviderError } from './image_generation';
import type { ResolvedImageModel } from './resolve_image_model';

vi.mock('../../../../lib/net/safe-fetch', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../../lib/net/safe-fetch')>();
  return { ...original, safeFetch: vi.fn() };
});

const mockedFetch = vi.mocked(safeFetch);

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

function reply(status: number, body: unknown) {
  return {
    status,
    statusText: '',
    headers: new Headers(),
    body: typeof body === 'string' ? body : JSON.stringify(body),
    finalUrl: 'https://provider.example/images',
  };
}

const OPENROUTER_MODEL: ResolvedImageModel = {
  providerSlug: 'openrouter',
  providerDisplayName: 'OpenRouter',
  modelId: 'google/gemini-2.5-flash-image',
  source: 'preferred',
  wire: 'openrouter-images',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-secret',
  attribution: { 'HTTP-Referer': 'https://tale.dev', 'X-Title': 'Tale' },
  acceptsImageInput: true,
};

const OPENAI_MODEL: ResolvedImageModel = {
  providerSlug: 'openai',
  providerDisplayName: 'OpenAI',
  modelId: 'gpt-image-1',
  source: 'pinned',
  wire: 'openai-images',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-oa-secret',
  attribution: {},
  acceptsImageInput: true,
  pricing: {
    inputCentsPerMillion: 500,
    outputCentsPerMillion: 4000,
    imageInputCentsPerMillion: 1000,
  },
};

const ARGS = {
  prompt: 'A lighthouse',
  size: 'square',
  references: [],
} as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateOneImage', () => {
  it('books OpenRouter’s reported charge, in cents', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, {
        data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
        usage: { cost: 0.039 },
      }),
    );
    const result = await generateOneImage(OPENROUTER_MODEL, ARGS);
    expect(result).toEqual({
      images: [{ bytes: PNG, mediaType: 'image/png' }],
      costCents: 3.9,
      inputTokens: 0,
      outputTokens: 0,
    });
    const [url, options] = mockedFetch.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer sk-or-secret', 'X-Title': 'Tale' },
    });
  });

  it('prices OpenAI’s reported tokens from the catalog', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, {
        data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
        usage: {
          input_tokens: 1050,
          input_tokens_details: { text_tokens: 50, image_tokens: 1000 },
          output_tokens: 4160,
        },
      }),
    );
    const result = await generateOneImage(OPENAI_MODEL, ARGS);
    // 50 × $5 + 1000 × $10 + 4160 × $40 per million tokens, in cents.
    expect(result.costCents).toBeCloseTo(17.665, 4);
    expect(result.inputTokens).toBe(1050);
    expect(result.outputTokens).toBe(4160);
  });

  it('books nothing it cannot price, rather than a guess', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    const result = await generateOneImage(
      { ...OPENAI_MODEL, pricing: undefined },
      ARGS,
    );
    expect(result.costCents).toBe(0);
  });

  it('relays the provider’s refusal sentence, redacted, never the key', async () => {
    mockedFetch.mockResolvedValue(
      reply(400, {
        error: {
          message:
            'Your request was rejected by the safety system (key sk-oa-secret).',
          type: 'image_generation_user_error',
          code: 'moderation_blocked',
        },
      }),
    );
    const error = await generateOneImage(OPENAI_MODEL, ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(String(error)).toContain('OpenAI refused the image request (400)');
    expect(String(error)).toContain('rejected by the safety system');
    expect(String(error)).not.toContain('sk-oa-secret');
  });

  it('treats an error body on a 200 as a refusal', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, { error: { code: 502, message: 'Upstream model failed' } }),
    );
    await expect(generateOneImage(OPENROUTER_MODEL, ARGS)).rejects.toThrow(
      /Upstream model failed/,
    );
  });

  it('names an unreachable provider without the transport detail leaking a key', async () => {
    mockedFetch.mockRejectedValue(
      new SafeFetchError('timeout', 'Request timed out after 180000ms'),
    );
    await expect(generateOneImage(OPENROUTER_MODEL, ARGS)).rejects.toThrow(
      /OpenRouter could not be reached \(timeout\)/,
    );
  });

  it('answers a non-JSON success as a provider failure', async () => {
    mockedFetch.mockResolvedValue(reply(200, '<html>gateway</html>'));
    await expect(generateOneImage(OPENROUTER_MODEL, ARGS)).rejects.toThrow(
      /not JSON/,
    );
  });
});
