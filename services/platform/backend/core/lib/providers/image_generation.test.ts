/**
 * One image call through the platform's audited outbound client: the
 * provider's refusal comes back as its own (redacted) sentence, a transport
 * failure as a plain account that names no host, and the ledger figure is
 * the provider's reported charge or the catalog price of the tokens it
 * reported — for a reply without a usable image too, since the provider
 * billed it. `safeFetch` is stubbed — no paid call is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import {
  generateOneImage,
  ImageProviderError,
  prepareImageRequest,
} from './image_generation';
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
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

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

function send(model: ResolvedImageModel) {
  return generateOneImage(model, prepareImageRequest(model, ARGS));
}

async function failureOf(model: ResolvedImageModel): Promise<unknown> {
  return send(model).catch((caught: unknown) => caught);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('prepareImageRequest', () => {
  it('builds the model’s request with the platform’s attribution', () => {
    const request = prepareImageRequest(OPENROUTER_MODEL, ARGS);
    expect(request.url).toBe('https://openrouter.ai/api/v1/images');
    expect(request.headers).toMatchObject({
      authorization: 'Bearer sk-or-secret',
      'X-Title': 'Tale',
    });
  });
});

describe('generateOneImage', () => {
  it('books OpenRouter’s reported charge, in cents', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, {
        data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
        usage: { cost: 0.039 },
      }),
    );
    const result = await send(OPENROUTER_MODEL);
    expect(result).toEqual({
      images: [{ bytes: PNG, mediaType: 'image/png' }],
      costCents: 3.9,
    });
    const [url, options] = mockedFetch.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer sk-or-secret', 'X-Title': 'Tale' },
    });
  });

  it('sends one prepared request as often as it is asked to', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    const request = prepareImageRequest(OPENROUTER_MODEL, ARGS);
    await generateOneImage(OPENROUTER_MODEL, request);
    await generateOneImage(OPENROUTER_MODEL, request);
    const bodies = mockedFetch.mock.calls.map(([, options]) => options?.body);
    expect(bodies).toHaveLength(2);
    // The very body the request was built with — encoded once.
    expect(bodies[0]).toBe(request.body);
    expect(bodies[1]).toBe(request.body);
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
    const result = await send(OPENAI_MODEL);
    // 50 × $5 + 1000 × $10 + 4160 × $40 per million tokens, in cents.
    expect(result.costCents).toBeCloseTo(17.665, 4);
  });

  it('books nothing it cannot price, rather than a guess', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    const result = await send({ ...OPENAI_MODEL, pricing: undefined });
    expect(result.costCents).toBe(0);
  });

  it('relays the provider’s refusal sentence, redacted, never the key — and charges nothing for it', async () => {
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
    const error = await failureOf(OPENAI_MODEL);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(String(error)).toContain('OpenAI refused the image request (400)');
    expect(String(error)).toContain('rejected by the safety system');
    expect(String(error)).not.toContain('sk-oa-secret');
    expect((error as ImageProviderError).charge).toBeUndefined();
  });

  it('treats an error body on a 200 as a refusal, carrying what it cost', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, {
        error: { code: 502, message: 'Upstream model failed' },
        usage: { cost: 0.01 },
      }),
    );
    const error = await failureOf(OPENROUTER_MODEL);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(String(error)).toMatch(/Upstream model failed/);
    expect((error as ImageProviderError).charge).toEqual({ costCents: 1 });
  });

  it('books a reply it cannot store at the price the reply reports', async () => {
    mockedFetch.mockResolvedValue(
      reply(200, {
        data: [{ b64_json: Buffer.from(SVG).toString('base64') }],
        usage: {
          input_tokens: 50,
          input_tokens_details: { text_tokens: 50, image_tokens: 0 },
          output_tokens: 1000,
        },
      }),
    );
    const error = await failureOf(OPENAI_MODEL);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(String(error)).toMatch(/returned no usable image/);
    // 50 × $5 + 1000 × $40 per million tokens, in cents.
    expect((error as ImageProviderError).charge?.costCents).toBeCloseTo(
      4.025,
      4,
    );
  });

  it('counts a non-JSON success as a billed request with no known cost', async () => {
    mockedFetch.mockResolvedValue(reply(200, '<html>gateway</html>'));
    const error = await failureOf(OPENROUTER_MODEL);
    expect(String(error)).toMatch(/not JSON/);
    expect((error as ImageProviderError).charge).toEqual({ costCents: 0 });
  });

  it('tells a transport failure plainly and keeps the network detail in the log', async () => {
    mockedFetch.mockRejectedValue(
      new SafeFetchError(
        'private_ip',
        'Host images.internal resolves to private address 10.0.4.7',
      ),
    );
    const error = await failureOf(OPENROUTER_MODEL);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(String(error)).toContain('OpenRouter could not be reached');
    expect(String(error)).not.toContain('10.0.4.7');
    expect(String(error)).not.toContain('images.internal');
    expect((error as ImageProviderError).charge).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('10.0.4.7'),
    );
  });

  it('says how long a timed-out call waited', async () => {
    mockedFetch.mockRejectedValue(
      new SafeFetchError('timeout', 'Request timed out after 180000ms'),
    );
    await expect(send(OPENROUTER_MODEL)).rejects.toThrow(
      'OpenRouter did not answer within 3 minutes',
    );
  });
});
