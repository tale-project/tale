/**
 * One image call through the platform's audited outbound client: the
 * provider's refusal comes back as its own (redacted) sentence, a transport
 * failure as a plain account that names no host, and the ledger figure is
 * the provider's reported charge or the catalog price of the tokens it
 * reported — for a reply without a usable image too, since the provider
 * billed it. A gateway that refuses its images API for a model is asked
 * over chat completions. `safeFetch` is stubbed — no paid call is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import {
  forgetServedImageWires,
  generateOneImage,
  ImageProviderError,
  prepareImageRequest,
  referenceImagesRefusal,
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
  organizationId: 'org_1',
  providerSlug: 'openrouter',
  providerDisplayName: 'OpenRouter',
  modelId: 'google/gemini-2.5-flash-image',
  source: 'preferred',
  wire: 'openrouter-images',
  writesText: true,
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-secret',
  attribution: { 'HTTP-Referer': 'https://tale.dev', 'X-Title': 'Tale' },
  acceptsImageInput: true,
};

const OPENAI_MODEL: ResolvedImageModel = {
  organizationId: 'org_1',
  providerSlug: 'openai',
  providerDisplayName: 'OpenAI',
  modelId: 'gpt-image-1',
  source: 'pinned',
  wire: 'openai-images',
  writesText: false,
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

/** A gateway's image model: its images API is the platform's guess, and
 * chat completions the fallback. */
const GATEWAY_MODEL: ResolvedImageModel = {
  organizationId: 'org_1',
  providerSlug: 'gateway',
  providerDisplayName: 'Gateway',
  modelId: 'openrouter/google/gemini-2.5-flash-image',
  source: 'pinned',
  wire: 'openai-images',
  fallbackWire: 'chat-images',
  writesText: true,
  baseUrl: 'https://gateway.example.com/v1',
  apiKey: 'sk-gw-secret',
  attribution: {},
  acceptsImageInput: true,
};

/** A 1 × 1 PNG: an image read out of a chat reply must have a header its
 * size is read from. */
const CHAT_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** A chat reply carrying one image, the way OpenRouter sends it. */
const CHAT_IMAGE = {
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        images: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${Buffer.from(CHAT_PNG).toString('base64')}`,
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 1290, cost: 0.039 },
};

/** Bifrost's answer to an images request for a model of a provider it
 * implements no images API for (2026-11-03). */
const UNSUPPORTED = {
  is_bifrost_error: true,
  error: {
    type: 'unsupported_operation',
    message: 'image_generation is not supported by openrouter provider',
  },
};

const ARGS = {
  prompt: 'A lighthouse',
  size: 'square',
  references: [],
} as const;

/** The URLs the calls so far were sent to. */
function sentUrls(): unknown[] {
  return mockedFetch.mock.calls.map(([url]) => url);
}

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
  forgetServedImageWires();
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

  it("asks the model's closest shape when its catalog lists the shapes it draws", () => {
    const request = prepareImageRequest(
      {
        ...OPENROUTER_MODEL,
        modelId: 'recraft/recraft-v4.1',
        aspectRatios: ['1:1', '4:3', '3:4'],
      },
      { ...ARGS, size: 'landscape' },
    );
    if (typeof request.body !== 'string') {
      throw new Error('expected a JSON request body');
    }
    expect(JSON.parse(request.body)).toMatchObject({ aspect_ratio: '4:3' });
  });
});

describe('referenceImagesRefusal', () => {
  it('says the most reference images a model takes, and nothing within it', () => {
    const gemini = {
      modelId: 'google/gemini-2.5-flash-image',
      maxReferenceImages: 3,
    };
    expect(referenceImagesRefusal(gemini, 3)).toBeUndefined();
    expect(referenceImagesRefusal(gemini, 4)).toContain(
      'takes at most 3 reference images',
    );
    expect(
      referenceImagesRefusal(
        { modelId: 'krea/krea-2-large', maxReferenceImages: 1 },
        2,
      ),
    ).toContain('at most 1 reference image in one call');
  });

  it("tells an edit model's call without a picture what it needs", () => {
    const edit = {
      modelId: 'krea/k3-edit',
      minReferenceImages: 1,
      maxReferenceImages: 8,
    };
    expect(referenceImagesRefusal(edit, 0)).toContain(
      'needs at least 1 reference image in every call',
    );
    expect(referenceImagesRefusal(edit, 1)).toBeUndefined();
    // Facts nobody published refuse nothing.
    expect(
      referenceImagesRefusal({ modelId: 'meta/muse-image' }, 9),
    ).toBeUndefined();
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

describe('generateOneImage — a gateway that serves a model over chat alone', () => {
  it('asks chat completions when the images API refuses the model, and there first from then on', async () => {
    mockedFetch
      .mockResolvedValueOnce(reply(400, UNSUPPORTED))
      .mockResolvedValueOnce(reply(200, CHAT_IMAGE));
    const result = await send(GATEWAY_MODEL);
    expect(result).toEqual({
      images: [
        { bytes: CHAT_PNG, mediaType: 'image/png', width: 1, height: 1 },
      ],
      costCents: 3.9,
    });
    expect(sentUrls()).toEqual([
      'https://gateway.example.com/v1/images/generations',
      'https://gateway.example.com/v1/chat/completions',
    ]);
    const chatBody = mockedFetch.mock.calls[1]?.[1]?.body;
    if (typeof chatBody !== 'string') {
      throw new Error('expected a JSON chat request body');
    }
    expect(JSON.parse(chatBody)).toMatchObject({
      model: 'openrouter/google/gemini-2.5-flash-image',
      modalities: ['image', 'text'],
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'image_generation is not supported by openrouter provider; asking chat completions',
      ),
    );

    mockedFetch.mockResolvedValueOnce(reply(200, CHAT_IMAGE));
    await send(GATEWAY_MODEL);
    expect(sentUrls()).toHaveLength(3);
    expect(sentUrls()[2]).toBe(
      'https://gateway.example.com/v1/chat/completions',
    );
  });

  it.each([403, 404, 405, 501])(
    'takes a %i as a gateway that cannot serve the images API for the model',
    async (status) => {
      mockedFetch
        .mockResolvedValueOnce(
          reply(status, {
            error: { message: 'Images API is not supported for this platform' },
          }),
        )
        .mockResolvedValueOnce(reply(200, CHAT_IMAGE));
      await expect(send(GATEWAY_MODEL)).resolves.toMatchObject({
        costCents: 3.9,
      });
      expect(sentUrls()).toHaveLength(2);
    },
  );

  it('asks nothing more of a limit, an outage or a billed answer', async () => {
    for (const answer of [
      reply(429, { error: { message: 'Rate limit exceeded' } }),
      reply(503, { error: { message: 'Upstream unavailable' } }),
      reply(200, { data: [] }),
    ]) {
      mockedFetch.mockReset();
      mockedFetch.mockResolvedValueOnce(answer);
      const error = await failureOf(GATEWAY_MODEL);
      expect(error).toBeInstanceOf(ImageProviderError);
      expect(sentUrls()).toEqual([
        'https://gateway.example.com/v1/images/generations',
      ]);
    }
  });

  it("keeps each organization's gateway memory its own", async () => {
    mockedFetch
      .mockResolvedValueOnce(reply(400, UNSUPPORTED))
      .mockResolvedValueOnce(reply(200, CHAT_IMAGE));
    await send(GATEWAY_MODEL);
    // Another organization's key may reach routes this one does not.
    mockedFetch.mockResolvedValueOnce(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    await send({ ...GATEWAY_MODEL, organizationId: 'org_2' });
    expect(sentUrls()[2]).toBe(
      'https://gateway.example.com/v1/images/generations',
    );
  });

  it('goes back to the images API once chat completions refuses the model', async () => {
    mockedFetch
      .mockResolvedValueOnce(reply(400, UNSUPPORTED))
      .mockResolvedValueOnce(reply(200, CHAT_IMAGE));
    await send(GATEWAY_MODEL);
    // The gateway changed: chat refuses, the images API serves.
    mockedFetch
      .mockResolvedValueOnce(
        reply(400, { error: { message: 'modalities not supported' } }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
        }),
      );
    await send(GATEWAY_MODEL);
    mockedFetch.mockResolvedValueOnce(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    await send(GATEWAY_MODEL);
    expect(sentUrls().slice(2)).toEqual([
      'https://gateway.example.com/v1/chat/completions',
      'https://gateway.example.com/v1/images/generations',
      'https://gateway.example.com/v1/images/generations',
    ]);
  });

  it('says what both APIs answered, and books what the second billed', async () => {
    mockedFetch
      .mockResolvedValueOnce(reply(400, UNSUPPORTED))
      .mockResolvedValueOnce(
        reply(200, {
          choices: [
            { message: { content: 'I can only describe a lighthouse.' } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 9, cost: 0.002 },
        }),
      );
    const error = await failureOf(GATEWAY_MODEL);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect((error as ImageProviderError).message).toBe(
      'Gateway refused the image request (400): image_generation is not supported by openrouter provider. Asked over chat completions instead: Gateway returned no usable image: the model answered in words without an image: "I can only describe a lighthouse."',
    );
    expect((error as ImageProviderError).charge).toEqual({ costCents: 0.2 });
    // Neither wire served, so the next call starts on the images API again.
    mockedFetch.mockResolvedValueOnce(
      reply(200, { data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
    );
    await send(GATEWAY_MODEL);
    expect(sentUrls()[2]).toBe(
      'https://gateway.example.com/v1/images/generations',
    );
  });

  it('asks no other API of a prompt the provider refused on its content', async () => {
    mockedFetch.mockResolvedValueOnce(
      reply(400, {
        error: {
          message: 'Your request was rejected by the safety system.',
          type: 'image_generation_user_error',
          code: 'moderation_blocked',
        },
      }),
    );
    const error = await failureOf(GATEWAY_MODEL);
    expect(String(error)).toContain(
      'Gateway refused the image request (400): Your request was rejected by the safety system.',
    );
    expect((error as ImageProviderError).refusedCode).toBe(
      'moderation_blocked',
    );
    expect(sentUrls()).toEqual([
      'https://gateway.example.com/v1/images/generations',
    ]);
  });

  it('asks no other wire of a model that carries none', async () => {
    mockedFetch.mockResolvedValueOnce(
      reply(404, { error: { message: 'No endpoints found' } }),
    );
    const error = await failureOf(OPENROUTER_MODEL);
    expect(String(error)).toContain(
      'OpenRouter refused the image request (404)',
    );
    expect(sentUrls()).toHaveLength(1);
  });

  it('builds the chat request once, and only when it is asked', () => {
    const request = prepareImageRequest(GATEWAY_MODEL, ARGS);
    expect(request.wire).toBe('openai-images');
    const fallback = request.fallback?.();
    expect(fallback?.wire).toBe('chat-images');
    expect(fallback?.url).toBe(
      'https://gateway.example.com/v1/chat/completions',
    );
    expect(request.fallback?.()).toBe(fallback);
    expect(prepareImageRequest(OPENAI_MODEL, ARGS).fallback).toBeUndefined();
  });
});
