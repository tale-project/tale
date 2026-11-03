/**
 * The three image-generation dialects, pinned to the shapes the providers
 * document (read 2026-09-29) — OpenRouter's Image API and OpenAI's images
 * API — and to an AI gateway's chat replies (recorded 2026-11-03). No
 * network and no paid call — the request is built and a recorded reply
 * shape parsed.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildImageRequest,
  ImageReplyError,
  isReferenceMediaType,
  openRouterAspectRatio,
  parseImageReply,
  providerErrorMessage,
  rasterPixelSize,
  sniffRasterMediaType,
  type ImageWireRequest,
  type ReferenceImage,
} from './image_wire';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** A PNG's signature and header chunk — all a size reader needs. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** A JPEG's start, its JFIF segment and a baseline frame header. */
function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    // Start of image.
    0xff,
    0xd8,
    // The JFIF segment (APP0), 16 bytes long.
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    // The baseline frame header (SOF0): 8-bit samples, the height, the
    // width, and three components.
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    // End of image.
    0xff,
    0xd9,
  ]);
}

/** A JPEG whose frame header follows `segments` metadata segments of 64 KB
 * each, the way large EXIF or ICC blocks push it back. */
function jpegAfterMetadata(
  width: number,
  height: number,
  segments: number,
): Uint8Array {
  const header = jpegHeader(width, height);
  // APP1 with the largest length a segment can declare: 2 + 65535 bytes.
  const segment = new Uint8Array(2 + 0xffff);
  segment.set([0xff, 0xe1, 0xff, 0xff]);
  const bytes = new Uint8Array(header.length + segments * segment.length);
  // The start of image and the JFIF segment, the metadata, then the frame
  // header onwards.
  bytes.set(header.subarray(0, 20));
  for (let index = 0; index < segments; index += 1) {
    bytes.set(segment, 20 + index * segment.length);
  }
  bytes.set(header.subarray(20), 20 + segments * segment.length);
  return bytes;
}

/** A JSON request's body, parsed — form data is the edit dialect's own. */
function jsonBody(request: ImageWireRequest): unknown {
  if (typeof request.body !== 'string') {
    throw new Error('expected a JSON request body');
  }
  return JSON.parse(request.body);
}

const REFERENCE: ReferenceImage = {
  bytes: PNG,
  mediaType: 'image/png',
  fileName: 'logo.png',
};

describe('buildImageRequest — OpenRouter Image API', () => {
  it('asks for one image with the model, prompt and attribution', () => {
    const request = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or',
      modelId: 'google/gemini-2.5-flash-image',
      prompt: 'A lighthouse at dawn',
      size: 'square',
      references: [],
      extraHeaders: { 'HTTP-Referer': 'https://tale.dev', 'X-Title': 'Tale' },
    });
    expect(request.url).toBe('https://openrouter.ai/api/v1/images');
    expect(request.headers).toEqual({
      'HTTP-Referer': 'https://tale.dev',
      'X-Title': 'Tale',
      authorization: 'Bearer sk-or',
      'content-type': 'application/json',
    });
    // Every shape is spelled out, square included.
    expect(jsonBody(request)).toEqual({
      model: 'google/gemini-2.5-flash-image',
      prompt: 'A lighthouse at dawn',
      n: 1,
      aspect_ratio: '1:1',
    });
  });

  it('spells the shape as an aspect ratio and references as data URLs', () => {
    const request = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      modelId: 'black-forest-labs/flux.2-pro',
      prompt: 'Turn this logo blue',
      size: 'landscape',
      references: [REFERENCE],
    });
    expect(jsonBody(request)).toEqual({
      model: 'black-forest-labs/flux.2-pro',
      prompt: 'Turn this logo blue',
      n: 1,
      aspect_ratio: '3:2',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${b64(PNG)}` },
        },
      ],
    });
    const portrait = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      modelId: 'm',
      prompt: 'p',
      size: 'portrait',
      references: [],
    });
    expect(jsonBody(portrait)).toMatchObject({
      aspect_ratio: '2:3',
    });
  });

  it('asks a model for the shape it draws closest to the one wanted', () => {
    // Recraft draws no 3:2 and refuses a request for one (live, 2026-10-27).
    const request = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      modelId: 'recraft/recraft-v4.1',
      prompt: 'A lighthouse at dawn',
      size: 'landscape',
      references: [],
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    });
    expect(jsonBody(request)).toMatchObject({ aspect_ratio: '4:3' });
  });

  it('asks a GPT image model for medium quality, as on OpenAI', () => {
    const gpt = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      modelId: 'openai/gpt-image-2.5-flare',
      prompt: 'A lighthouse at dawn',
      size: 'square',
      references: [],
    });
    expect(jsonBody(gpt)).toMatchObject({ quality: 'medium' });
    const gemini = buildImageRequest({
      wire: 'openrouter-images',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      modelId: 'google/gemini-2.5-flash-image',
      prompt: 'A lighthouse at dawn',
      size: 'square',
      references: [],
    });
    expect(jsonBody(gemini)).not.toHaveProperty('quality');
  });
});

describe('openRouterAspectRatio', () => {
  it('keeps the shape of the size when the model draws it, or says nothing', () => {
    expect(openRouterAspectRatio('square', undefined)).toBe('1:1');
    expect(openRouterAspectRatio('landscape', undefined)).toBe('3:2');
    expect(openRouterAspectRatio('portrait', ['1:1', '3:2', '2:3'])).toBe(
      '2:3',
    );
  });

  it('takes the closest shape the model draws instead', () => {
    const recraft = ['1:1', '4:3', '3:4', '16:9', '9:16'];
    expect(openRouterAspectRatio('landscape', recraft)).toBe('4:3');
    expect(openRouterAspectRatio('portrait', recraft)).toBe('3:4');
    expect(openRouterAspectRatio('landscape', ['1:1', '16:9', '21:9'])).toBe(
      '16:9',
    );
    expect(openRouterAspectRatio('portrait', ['9:19.5', '1:1'])).toBe('9:19.5');
  });

  it('never turns a landscape into a portrait while a nearer shape exists', () => {
    expect(openRouterAspectRatio('landscape', ['3:4', '1:1'])).toBe('1:1');
    expect(openRouterAspectRatio('portrait', ['4:3', '1:1'])).toBe('1:1');
    expect(openRouterAspectRatio('square', ['4:3', '3:4'])).toBe('4:3');
  });
});

describe('buildImageRequest — OpenAI images API', () => {
  it('generates through /images/generations with a GPT image size', () => {
    const request = buildImageRequest({
      wire: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-oa',
      modelId: 'gpt-image-1',
      prompt: 'A lighthouse at dawn',
      size: 'portrait',
      references: [],
    });
    expect(request.url).toBe('https://api.openai.com/v1/images/generations');
    expect(request.headers).toEqual({
      authorization: 'Bearer sk-oa',
      'content-type': 'application/json',
    });
    // Medium, spelled out: the model's own default may pick `high`, at
    // about four times the price an image.
    expect(jsonBody(request)).toEqual({
      model: 'gpt-image-1',
      prompt: 'A lighthouse at dawn',
      n: 1,
      size: '1024x1536',
      quality: 'medium',
    });
  });

  it('leaves the quality to a model that is not a GPT image model', () => {
    const request = buildImageRequest({
      wire: 'openai-images',
      baseUrl: 'https://images.example.com/v1',
      apiKey: 'sk-x',
      modelId: 'flux-schnell',
      prompt: 'A lighthouse at dawn',
      size: 'square',
      references: [],
    });
    expect(jsonBody(request)).not.toHaveProperty('quality');
  });

  it('edits through /images/edits as form data, one reference as `image`', async () => {
    const request = buildImageRequest({
      wire: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-oa',
      modelId: 'gpt-image-1',
      prompt: 'Make it night',
      size: 'landscape',
      references: [REFERENCE],
    });
    expect(request.url).toBe('https://api.openai.com/v1/images/edits');
    // The HTTP client writes the multipart boundary itself.
    expect(request.headers).toEqual({ authorization: 'Bearer sk-oa' });
    expect(request.body).toBeInstanceOf(FormData);
    const form = request.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('Make it night');
    expect(form.get('n')).toBe('1');
    expect(form.get('size')).toBe('1536x1024');
    expect(form.get('quality')).toBe('medium');
    const file = form.get('image');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('logo.png');
    expect((file as File).type).toBe('image/png');
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(PNG);
  });

  it('repeats `image[]` for several references', () => {
    const request = buildImageRequest({
      wire: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-oa',
      modelId: 'gpt-image-1',
      prompt: 'Combine these',
      size: 'square',
      references: [REFERENCE, { ...REFERENCE, fileName: 'photo.png' }],
    });
    const form = request.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.get('image')).toBeNull();
    expect(form.get('size')).toBe('1024x1024');
  });
});

describe('buildImageRequest — chat completions', () => {
  it('asks for an image alone, with the shape in words', () => {
    const request = buildImageRequest({
      wire: 'chat-images',
      baseUrl: 'https://gateway.example.com/v1/',
      apiKey: 'sk-gw',
      modelId: 'antigravity/gemini-3.1-flash-image',
      prompt: 'A lighthouse at dawn',
      size: 'landscape',
      references: [],
    });
    expect(request.url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(request.headers).toEqual({
      authorization: 'Bearer sk-gw',
      'content-type': 'application/json',
    });
    expect(jsonBody(request)).toEqual({
      model: 'antigravity/gemini-3.1-flash-image',
      messages: [
        {
          role: 'user',
          content: 'A lighthouse at dawn\n\nAspect ratio: 3:2 (landscape).',
        },
      ],
      modalities: ['image'],
    });
  });

  it('asks a model that writes text for both, and sends references as image parts', () => {
    const request = buildImageRequest({
      wire: 'chat-images',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-gw',
      modelId: 'openrouter/google/gemini-2.5-flash-image',
      prompt: 'Turn this logo blue',
      size: 'portrait',
      references: [REFERENCE],
      aspectRatios: ['1:1', '3:4', '4:3'],
      writesText: true,
    });
    expect(jsonBody(request)).toEqual({
      model: 'openrouter/google/gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Turn this logo blue\n\nAspect ratio: 3:4 (portrait).',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${b64(PNG)}` },
            },
          ],
        },
      ],
      modalities: ['image', 'text'],
    });
  });
});

describe('parseImageReply', () => {
  it('reads OpenRouter images and the charge it reports', () => {
    const reply = parseImageReply('openrouter-images', {
      created: 1_790_000_000,
      data: [{ b64_json: b64(PNG), media_type: 'image/png' }],
      usage: { cost: 0.039, prompt_tokens: 12 },
    });
    expect(reply).toEqual({
      images: [{ bytes: PNG, mediaType: 'image/png' }],
      refusedFormats: 0,
      costUsd: 0.039,
    });
  });

  it('carries the pixel size each image header stores', () => {
    const wide = pngHeader(1248, 832);
    const reply = parseImageReply('openrouter-images', {
      data: [{ b64_json: b64(wide), media_type: 'image/png' }],
    });
    expect(reply.images).toEqual([
      { bytes: wide, mediaType: 'image/png', width: 1248, height: 832 },
    ]);
  });

  it('reads OpenAI images and their token counts', () => {
    const reply = parseImageReply('openai-images', {
      created: 1_790_000_000,
      data: [{ b64_json: b64(JPEG) }],
      usage: {
        input_tokens: 350,
        input_tokens_details: { text_tokens: 50, image_tokens: 300 },
        output_tokens: 4160,
        total_tokens: 4510,
      },
    });
    expect(reply).toEqual({
      images: [{ bytes: JPEG, mediaType: 'image/jpeg' }],
      refusedFormats: 0,
      usage: { textInputTokens: 50, imageInputTokens: 300, outputTokens: 4160 },
    });
  });

  it('trusts the bytes over a label, and tolerates a data URL', () => {
    const reply = parseImageReply('openrouter-images', {
      data: [
        {
          b64_json: `data:image/png;base64,${b64(WEBP)}`,
          media_type: 'image/png',
        },
      ],
    });
    expect(reply.images[0]?.mediaType).toBe('image/webp');
  });

  it('refuses a vector image and says why', () => {
    expect(() =>
      parseImageReply('openrouter-images', {
        data: [{ b64_json: b64(SVG), media_type: 'image/svg+xml' }],
      }),
    ).toThrow(/does not store/);
  });

  it('keeps the raster images of a mixed reply and counts the rest', () => {
    const reply = parseImageReply('openrouter-images', {
      data: [{ b64_json: b64(SVG) }, { b64_json: b64(PNG) }],
    });
    expect(reply.images).toHaveLength(1);
    expect(reply.refusedFormats).toBe(1);
  });

  it('treats a refusal carried on a 200 as the provider refusing', () => {
    expect(() =>
      parseImageReply('openrouter-images', {
        error: { code: 403, message: 'Content policy violation' },
      }),
    ).toThrow(new ImageReplyError('Content policy violation'));
  });

  it('carries what an unusable reply cost on its error', () => {
    const refusal = (() => {
      try {
        parseImageReply('openrouter-images', {
          error: { code: 502, message: 'Upstream model failed' },
          usage: { cost: 0.02 },
        });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refusal).toBeInstanceOf(ImageReplyError);
    expect((refusal as ImageReplyError).charge).toEqual({ costUsd: 0.02 });

    const vector = (() => {
      try {
        parseImageReply('openai-images', {
          data: [{ b64_json: b64(SVG) }],
          usage: { input_tokens: 40, output_tokens: 1000 },
        });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect((vector as ImageReplyError).charge).toEqual({
      usage: { textInputTokens: 40, imageInputTokens: 0, outputTokens: 1000 },
    });
  });

  it.each([
    [{}],
    [{ data: [] }],
    [{ data: [{ url: 'https://example.com/i.png' }] }],
    [null],
  ])('refuses a reply without a stored image: %j', (payload) => {
    expect(() => parseImageReply('openai-images', payload)).toThrow(
      ImageReplyError,
    );
  });
});

describe('parseImageReply — chat completions', () => {
  /** Images with a header their size is read from: an image read out of a
   * chat reply must have one. */
  const IMAGE_PNG = pngHeader(1024, 1024);
  const IMAGE_JPEG = jpegHeader(1408, 768);

  /** A chat reply's first choice carrying `message`. */
  function chatReply(message: Record<string, unknown>, usage?: unknown) {
    return {
      object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message }],
      ...(usage !== undefined && { usage }),
    };
  }

  /** The error a reply is refused with. */
  function refusalOf(payload: unknown): ImageReplyError {
    try {
      parseImageReply('chat-images', payload);
    } catch (error) {
      if (error instanceof ImageReplyError) return error;
      throw error;
    }
    throw new Error('expected the reply to be refused');
  }

  it('reads the images OpenRouter sends beside the text, and the charge it reports', () => {
    const reply = parseImageReply(
      'chat-images',
      chatReply(
        {
          role: 'assistant',
          content: 'Here is your lighthouse.',
          images: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${b64(IMAGE_PNG)}` },
            },
          ],
        },
        { prompt_tokens: 12, completion_tokens: 1290, cost: 0.039 },
      ),
    );
    expect(reply).toEqual({
      images: [
        { bytes: IMAGE_PNG, mediaType: 'image/png', width: 1024, height: 1024 },
      ],
      refusedFormats: 0,
      costUsd: 0.039,
    });
  });

  it('reads the charge Bifrost relays as an object', () => {
    // OpenRouter's reply through Bifrost v2.4.0 (2026-11-03): the image as
    // OpenRouter sent it, the charge moved into `total_cost`.
    const reply = parseImageReply(
      'chat-images',
      chatReply(
        {
          role: 'assistant',
          content: 'Here is your lighthouse.',
          refusal: null,
          images: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${b64(IMAGE_PNG)}` },
            },
          ],
        },
        {
          prompt_tokens: 20,
          completion_tokens: 1300,
          total_tokens: 1320,
          cost: { total_cost: 0.039 },
        },
      ),
    );
    expect(reply.costUsd).toBe(0.039);
    expect(reply).not.toHaveProperty('usage');
    // An object without a total is no charge: the token counts stand in.
    expect(
      parseImageReply(
        'chat-images',
        chatReply(
          {
            images: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${b64(IMAGE_PNG)}` },
              },
            ],
          },
          { prompt_tokens: 20, completion_tokens: 1300, cost: {} },
        ),
      ),
    ).toMatchObject({
      usage: { textInputTokens: 20, imageInputTokens: 0, outputTokens: 1300 },
    });
  });

  it('reads an image written into the text as Markdown, and the token counts', () => {
    // A Gemini backend's reply, as a gateway relayed it (2026-11-03): one
    // Markdown image and nothing else, and no charge.
    const reply = parseImageReply(
      'chat-images',
      chatReply(
        {
          role: 'assistant',
          content: `![image](data:image/jpeg;base64,${b64(IMAGE_JPEG)})`,
        },
        { prompt_tokens: 266, completion_tokens: 1517, total_tokens: 1783 },
      ),
    );
    expect(reply).toEqual({
      images: [
        {
          bytes: IMAGE_JPEG,
          mediaType: 'image/jpeg',
          width: 1408,
          height: 768,
        },
      ],
      refusedFormats: 0,
      usage: { textInputTokens: 266, imageInputTokens: 0, outputTokens: 1517 },
    });
    // The prompt's image tokens, where the reply counts them apart.
    expect(
      parseImageReply(
        'chat-images',
        chatReply(
          { content: `![image](data:image/jpeg;base64,${b64(IMAGE_JPEG)})` },
          {
            prompt_tokens: 300,
            prompt_tokens_details: { image_tokens: 258 },
            completion_tokens: 1290,
          },
        ),
      ).usage,
    ).toEqual({
      textInputTokens: 42,
      imageInputTokens: 258,
      outputTokens: 1290,
    });
  });

  it('reads image parts of the content, and each image once', () => {
    const png = `data:image/png;base64,${b64(IMAGE_PNG)}`;
    const reply = parseImageReply(
      'chat-images',
      chatReply({
        content: [
          { type: 'text', text: `Done: ![lighthouse](${png})` },
          { type: 'image_url', image_url: { url: png } },
          {
            type: 'image_url',
            image_url: `data:image/jpeg;base64,${b64(IMAGE_JPEG)}`,
          },
        ],
        images: [{ type: 'image_url', image_url: { url: png } }],
      }),
    );
    expect(reply.images.map((image) => image.mediaType)).toEqual([
      'image/png',
      'image/jpeg',
    ]);
  });

  it('says what the model wrote instead of an image', () => {
    const words = refusalOf(
      chatReply(
        { content: 'I can only describe a lighthouse.' },
        { prompt_tokens: 20, completion_tokens: 9 },
      ),
    );
    expect(words.message).toBe(
      'the model answered in words without an image: "I can only describe a lighthouse."',
    );
    // What the words cost is carried all the same.
    expect(words.charge).toEqual({
      usage: { textInputTokens: 20, imageInputTokens: 0, outputTokens: 9 },
    });
    const long = refusalOf(chatReply({ content: 'word '.repeat(100) }));
    expect(long.message).toMatch(/: "(word ){59}word…"$/);
    expect(refusalOf(chatReply({ content: null })).message).toBe(
      'the model answered without an image',
    );
  });

  it('fetches no image a reply links to, and says so', () => {
    expect(
      refusalOf(
        chatReply({
          content: '![image](https://cdn.example.com/lighthouse.png)',
        }),
      ).message,
    ).toMatch(/link to an image rather than the image itself/);
    expect(
      refusalOf(
        chatReply({
          images: [
            {
              type: 'image_url',
              image_url: { url: 'https://cdn.example.com/lighthouse.png' },
            },
          ],
        }),
      ).message,
    ).toMatch(/fetches no address a model names/);
  });

  it('stores no sample data URL the model writes among its words', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A PNG signature and nothing more: no header to read a size from.
    const sample = refusalOf(
      chatReply({
        content: `A PNG starts like data:image/png;base64,${b64(PNG)} and so on.`,
      }),
    );
    expect(sample.message).toBe(
      'the model answered in words without an image: "A PNG starts like and so on."',
    );
    warn.mockRestore();
  });

  it('reads a reply full of unclosed Markdown at once', () => {
    // Read whole, each of these took seconds: 200 KB of `![` held the
    // process for about 11 s. The bound is far above what a linear read
    // takes and far below what a quadratic one does.
    for (const filler of ['![', '![a](data:', '![a](https://']) {
      const started = performance.now();
      const error = refusalOf(chatReply({ content: filler.repeat(200_000) }));
      expect(error.message).toMatch(/^the model answered /);
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });

  it('refuses a vector image, a refusal on a 200 and a reply without a message', () => {
    expect(
      refusalOf(
        chatReply({
          content: `![logo](data:image/svg+xml;base64,${b64(SVG)})`,
        }),
      ).message,
    ).toMatch(/does not store/);
    expect(
      refusalOf({ error: { code: 400, message: 'Unsupported modality' } })
        .message,
    ).toBe('Unsupported modality');
    expect(refusalOf({ choices: [] }).message).toBe(
      'the provider answered without a chat message',
    );
    expect(refusalOf(null).message).toBe(
      'the provider answered without a chat message',
    );
  });
});

describe('rasterPixelSize', () => {
  it('reads the size a PNG or JPEG header stores', () => {
    expect(rasterPixelSize(pngHeader(1248, 832))).toEqual({
      width: 1248,
      height: 832,
    });
    expect(rasterPixelSize(jpegHeader(1024, 1536))).toEqual({
      width: 1024,
      height: 1536,
    });
  });

  it('reads a header followed by megabytes of image data', () => {
    const png = new Uint8Array(5 * 1024 * 1024);
    png.set(pngHeader(1536, 1024));
    expect(rasterPixelSize(png)).toEqual({ width: 1536, height: 1024 });
  });

  it('finds a JPEG frame header behind its metadata, within 512 KB', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Four segments put the frame header 256 KB in; nine put it past the cap.
    expect(rasterPixelSize(jpegAfterMetadata(1024, 1536, 4))).toEqual({
      width: 1024,
      height: 1536,
    });
    expect(rasterPixelSize(jpegAfterMetadata(1024, 1536, 9))).toBeUndefined();
    warn.mockRestore();
  });

  it('gives up at once on junk after a JPEG start marker', () => {
    // Read whole, this reply stalled image-size for minutes: it copies the
    // rest of a plain Uint8Array for every byte it skips. The test timeout
    // is the guard.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const junk = new Uint8Array(8 * 1024 * 1024);
    junk.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(rasterPixelSize(junk)).toBeUndefined();
    warn.mockRestore();
  });

  it('answers nothing, and says so, for a header it cannot read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(rasterPixelSize(PNG)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read a generated image's pixel size"),
    );
    warn.mockRestore();
  });
});

describe('providerErrorMessage and sniffRasterMediaType', () => {
  it('reads both dialects’ error sentences', () => {
    expect(
      providerErrorMessage({
        error: {
          message: 'Your request was rejected by the safety system.',
          type: 'image_generation_user_error',
          code: 'moderation_blocked',
        },
      }),
    ).toBe('Your request was rejected by the safety system.');
    expect(providerErrorMessage({ error: 'plain' })).toBe('plain');
    expect(providerErrorMessage({ error: { code: 500 } })).toBeUndefined();
    expect(providerErrorMessage('nope')).toBeUndefined();
  });

  it('recognizes the stored raster formats and nothing else', () => {
    expect(sniffRasterMediaType(PNG)).toBe('image/png');
    expect(sniffRasterMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffRasterMediaType(WEBP)).toBe('image/webp');
    expect(sniffRasterMediaType(new TextEncoder().encode('GIF89a...'))).toBe(
      'image/gif',
    );
    expect(sniffRasterMediaType(SVG)).toBeNull();
    expect(sniffRasterMediaType(new Uint8Array())).toBeNull();
  });

  it('takes PNG, JPEG and WebP as reference images, never GIF', () => {
    expect(isReferenceMediaType('image/png')).toBe(true);
    expect(isReferenceMediaType('image/jpeg')).toBe(true);
    expect(isReferenceMediaType('image/webp')).toBe(true);
    expect(isReferenceMediaType('image/gif')).toBe(false);
  });
});
