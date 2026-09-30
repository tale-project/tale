/**
 * The image-generation wire: one request in the provider's dialect out, and
 * the provider's reply back into image bytes. Pure data mapping — no network
 * and no credential lookup — so both dialects are pinned by tests without a
 * paid call (`image_wire.test.ts`).
 *
 * Two dialects, read against the providers' documentation (2026-09-29):
 *
 *  - `openrouter-images` — OpenRouter's dedicated Image API
 *    (https://openrouter.ai/docs/guides/overview/multimodal/image-generation):
 *    `POST {base}/images` with JSON `{model, prompt, n, aspect_ratio?,
 *    input_references?}`; the reply carries `data: [{b64_json, media_type}]`
 *    and a `usage.cost` in USD. OpenRouter documents this API, not chat
 *    completions, as the way to generate images, and it serves image-only
 *    models (FLUX, the GPT image models) that write no chat message at all.
 *  - `openai-images` — OpenAI's images API
 *    (https://developers.openai.com/api/reference/resources/images):
 *    `POST {base}/images/generations` with JSON `{model, prompt, n, size,
 *    quality?}`, or `POST {base}/images/edits` as multipart form data with
 *    the reference images as `image` / `image[]` parts. The reply carries
 *    `data: [{b64_json}]` and token counts — no cost, which the ledger
 *    computes from the catalog's prices.
 *
 * Every request asks for ONE image: several models serve only `n: 1`, so a
 * caller that wants more runs several requests.
 */

import { imageSize } from 'image-size';

/** How a request reaches the provider's image API. */
export type ImageGenerationWire = 'openrouter-images' | 'openai-images';

/** The shapes an agent may ask for, spelled the same for every model. */
export const IMAGE_SIZES = ['square', 'landscape', 'portrait'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** The raster formats the platform stores. Anything else a model returns —
 * an SVG from a vector model, a format it cannot recognize — is refused: a
 * deliverable is served back to people, and an SVG can carry script. */
export const RASTER_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export type RasterMediaType = (typeof RASTER_MEDIA_TYPES)[number];

/** The formats a reference image may have: what both APIs take as an
 * input image (OpenAI's edits accept exactly these three). */
export const REFERENCE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type ReferenceMediaType = (typeof REFERENCE_MEDIA_TYPES)[number];

export function isReferenceMediaType(
  mediaType: RasterMediaType,
): mediaType is ReferenceMediaType {
  return REFERENCE_MEDIA_TYPES.some((allowed) => allowed === mediaType);
}

/** The file extension each stored format is saved under. */
export const RASTER_EXTENSIONS: Record<RasterMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** OpenAI's GPT image models take exactly these three sizes (and `auto`). */
const OPENAI_SIZES: Record<ImageSize, string> = {
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
};

/** OpenRouter aspect ratios every curated image model supports. */
const OPENROUTER_ASPECT_RATIOS: Record<ImageSize, string> = {
  square: '1:1',
  landscape: '3:2',
  portrait: '2:3',
};

/** The quality a GPT image model is asked for: its default, `auto`, may
 * pick `high`, which costs about four times as much an image. */
const OPENAI_IMAGE_QUALITY = 'medium';

/** Whether `modelId` is one of OpenAI's GPT image models — the models that
 * take `quality` as `low`/`medium`/`high` (older and other models spell it
 * differently or not at all, so they keep their own default). */
function takesGptImageQuality(modelId: string): boolean {
  return /(^|\/)gpt-image/i.test(modelId);
}

/** A reference image an edit or a variation starts from. */
export interface ReferenceImage {
  bytes: Uint8Array;
  mediaType: ReferenceMediaType;
  fileName: string;
}

export interface ImageRequestArgs {
  wire: ImageGenerationWire;
  /** The provider's API origin, with or without a trailing slash. */
  baseUrl: string;
  apiKey: string;
  modelId: string;
  prompt: string;
  size: ImageSize;
  references: readonly ReferenceImage[];
  /** Provider attribution headers the platform sends where they apply. */
  extraHeaders?: Record<string, string>;
}

export interface ImageWireRequest {
  url: string;
  headers: Record<string, string>;
  /** JSON text, or form data for an OpenAI edit (its boundary header is set
   * by the HTTP client, so `headers` carries no content type then). */
  body: string | FormData;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mediaType: RasterMediaType;
  /** The stored pixel size, when the image's header could be read. */
  width?: number;
  height?: number;
}

/** The token counts a provider reports (OpenAI's images API). */
export interface ImageTokenUsage {
  textInputTokens: number;
  imageInputTokens: number;
  outputTokens: number;
}

export interface ImageReply {
  images: GeneratedImage[];
  /** What the provider says it charged, in US dollars (OpenRouter). */
  costUsd?: number;
  usage?: ImageTokenUsage;
  /** Images the reply carried in a format the platform does not store. */
  refusedFormats: number;
}

/** What a reply says it cost, read before anything else in it. */
export interface ImageReplyCharge {
  costUsd?: number;
  usage?: ImageTokenUsage;
}

/** A reply that carries no usable image, or a provider refusal. The message
 * is the provider's own words where it gave any — never the payload. The
 * charge is what the same reply reported it cost: a provider bills a request
 * it answered, whether or not the image it returned can be stored. */
export class ImageReplyError extends Error {
  readonly charge: ImageReplyCharge;
  constructor(message: string, charge: ImageReplyCharge = {}) {
    super(message);
    this.name = 'ImageReplyError';
    this.charge = charge;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dataUrl(image: ReferenceImage): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`;
}

/**
 * One request for one image, in the provider's dialect. Built once per call
 * and sent as often as the call asks for images: the reference images are
 * encoded into it once, not once per image.
 */
export function buildImageRequest(args: ImageRequestArgs): ImageWireRequest {
  const base = stripTrailingSlash(args.baseUrl);
  const auth = { authorization: `Bearer ${args.apiKey}` };
  if (args.wire === 'openrouter-images') {
    return {
      url: `${base}/images`,
      headers: {
        ...args.extraHeaders,
        ...auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: args.modelId,
        prompt: args.prompt,
        n: 1,
        aspect_ratio: OPENROUTER_ASPECT_RATIOS[args.size],
        ...(args.references.length > 0
          ? {
              input_references: args.references.map((image) => ({
                type: 'image_url',
                image_url: { url: dataUrl(image) },
              })),
            }
          : {}),
      }),
    };
  }
  const quality = takesGptImageQuality(args.modelId)
    ? OPENAI_IMAGE_QUALITY
    : undefined;
  if (args.references.length === 0) {
    return {
      url: `${base}/images/generations`,
      headers: {
        ...args.extraHeaders,
        ...auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: args.modelId,
        prompt: args.prompt,
        n: 1,
        size: OPENAI_SIZES[args.size],
        ...(quality !== undefined ? { quality } : {}),
      }),
    };
  }
  const form = new FormData();
  form.append('model', args.modelId);
  form.append('prompt', args.prompt);
  form.append('n', '1');
  form.append('size', OPENAI_SIZES[args.size]);
  if (quality !== undefined) form.append('quality', quality);
  // One reference is the `image` part; several repeat `image[]` — the
  // encoding OpenAI's own SDK and reference examples use.
  const field = args.references.length === 1 ? 'image' : 'image[]';
  for (const image of args.references) {
    form.append(
      field,
      new Blob([Buffer.from(image.bytes)], { type: image.mediaType }),
      image.fileName,
    );
  }
  return {
    url: `${base}/images/edits`,
    headers: { ...args.extraHeaders, ...auth },
    body: form,
  };
}

/** The raster format of `bytes` by its magic number, or `null` when it is
 * none the platform stores. The bytes decide, not the provider's label: a
 * mislabeled image must not be saved under the wrong extension. */
export function sniffRasterMediaType(
  bytes: Uint8Array,
): RasterMediaType | null {
  const starts = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png';
  }
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** The pixel size stored in a raster image's header, or `undefined` when the
 * header cannot be read. Reported to the agent, never relied on: each model
 * draws "landscape" at its own size (1248×832 on one, 1536×1024 on
 * another), and only the image itself says which. */
export function rasterPixelSize(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  try {
    const { width, height } = imageSize(bytes);
    return Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0
      ? { width, height }
      : undefined;
  } catch (error) {
    console.warn(
      `[image-generation] could not read a generated image's pixel size: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** The provider's own error sentence from a reply body, if it gave one —
 * both dialects spell it `{error: {message}}` (OpenRouter may send it on a
 * 200 once the upstream model failed). */
export function providerErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  if (isRecord(error) && typeof error.message === 'string') {
    const message = error.message.trim();
    return message === '' ? undefined : message;
  }
  return undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readTokenUsage(value: unknown): ImageTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonNegativeNumber(value.input_tokens);
  const output = nonNegativeNumber(value.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  const details = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : undefined;
  const imageInput = nonNegativeNumber(details?.image_tokens) ?? 0;
  const textInput =
    nonNegativeNumber(details?.text_tokens) ??
    Math.max(0, (input ?? 0) - imageInput);
  return {
    textInputTokens: textInput,
    imageInputTokens: imageInput,
    outputTokens: output ?? 0,
  };
}

function decodeBase64Image(raw: string): Uint8Array | null {
  // The field is raw base64 in both dialects; a data URL is tolerated.
  const comma = raw.startsWith('data:') ? raw.indexOf(',') : -1;
  const encoded = comma >= 0 ? raw.slice(comma + 1) : raw;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

/** What a reply reports it cost, in its dialect: OpenRouter's charge in
 * US dollars, OpenAI's token counts. */
function readCharge(
  wire: ImageGenerationWire,
  payload: unknown,
): ImageReplyCharge {
  const usage =
    isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  if (wire === 'openrouter-images') {
    const costUsd = nonNegativeNumber(usage?.cost);
    return costUsd !== undefined ? { costUsd } : {};
  }
  const tokens = readTokenUsage(usage);
  return tokens !== undefined ? { usage: tokens } : {};
}

/**
 * The images and usage of one reply. Throws {@link ImageReplyError} when the
 * reply is a refusal or carries no image the platform can store — carrying
 * what the reply said it cost, which is read first.
 */
export function parseImageReply(
  wire: ImageGenerationWire,
  payload: unknown,
): ImageReply {
  const charge = readCharge(wire, payload);
  const refusal = providerErrorMessage(payload);
  if (refusal !== undefined) throw new ImageReplyError(refusal, charge);
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ImageReplyError(
      'the provider answered without an image list',
      charge,
    );
  }
  const images: GeneratedImage[] = [];
  let refusedFormats = 0;
  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.b64_json !== 'string') continue;
    const bytes = decodeBase64Image(item.b64_json);
    if (bytes === null) continue;
    const mediaType = sniffRasterMediaType(bytes);
    if (mediaType === null) {
      refusedFormats += 1;
      continue;
    }
    images.push({ bytes, mediaType, ...rasterPixelSize(bytes) });
  }
  if (images.length === 0) {
    throw new ImageReplyError(
      refusedFormats > 0
        ? 'the model returned an image format the platform does not store (PNG, JPEG, WebP and GIF are); pick a raster image model'
        : 'the provider answered without an image',
      charge,
    );
  }
  return { images, refusedFormats, ...charge };
}
