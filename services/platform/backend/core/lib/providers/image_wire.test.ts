/**
 * The two image-generation dialects, pinned to the shapes the providers
 * document (read 2026-09-29): OpenRouter's Image API and OpenAI's images
 * API. No network and no paid call — the request is built and a recorded
 * reply shape parsed.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildImageRequest,
  ImageReplyError,
  isReferenceMediaType,
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
