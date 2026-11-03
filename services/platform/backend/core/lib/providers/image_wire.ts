/**
 * The image-generation wire: one request in the provider's dialect out, and
 * the provider's reply back into image bytes. Pure data mapping — no network
 * and no credential lookup — so both dialects are pinned by tests without a
 * paid call (`image_wire.test.ts`).
 *
 * Three dialects, the first two read against the providers' documentation
 * (2026-09-29), the third against an AI gateway's live answers (2026-11-03):
 *
 *  - `openrouter-images` — OpenRouter's dedicated Image API
 *    (https://openrouter.ai/docs/guides/overview/multimodal/image-generation):
 *    `POST {base}/images` with JSON `{model, prompt, n, aspect_ratio?,
 *    quality?, input_references?}`; the reply carries `data: [{b64_json,
 *    media_type}]` and a `usage.cost` in USD. OpenRouter documents this API,
 *    not chat completions, as the way to generate images, and it serves
 *    image-only models (FLUX, the GPT image models) that write no chat
 *    message at all. Each model draws its own set of aspect ratios, which
 *    OpenRouter lists per model (`/api/v1/images/models`); a request for one
 *    it does not draw is refused.
 *  - `openai-images` — OpenAI's images API
 *    (https://developers.openai.com/api/reference/resources/images):
 *    `POST {base}/images/generations` with JSON `{model, prompt, n, size,
 *    quality?}`, or `POST {base}/images/edits` as multipart form data with
 *    the reference images as `image` / `image[]` parts. The reply carries
 *    `data: [{b64_json}]` and token counts — no cost, which the ledger
 *    computes from the catalog's prices.
 *  - `chat-images` — Chat Completions asked for image output, the way an AI
 *    gateway serves a model whose upstream it reaches over chat alone
 *    (Bifrost implements no images API for OpenRouter, and one gateway's
 *    Gemini backend refused its own):
 *    `POST {base}/chat/completions` with JSON `{model, messages,
 *    modalities}` — `['image', 'text']` for a model that writes text as well,
 *    `['image']` for one that only draws — and the reference images as
 *    `image_url` parts of the one user message. The reply carries each image
 *    as a data URL, in `message.images` (OpenRouter's shape, which Bifrost
 *    relays from v2.4.0 on and drops before it) or inline in
 *    `message.content` (a Gemini backend writes it as Markdown,
 *    `![image](data:image/jpeg;base64,…)`), plus the chat token counts and,
 *    where the upstream reports one, a `usage.cost` in USD: a number from
 *    OpenRouter, `{total_cost}` through Bifrost. A chat request has
 *    no portable shape field — gateways drop OpenRouter's `image_config` —
 *    so the prompt asks for the aspect ratio in words, which Gemini's image
 *    models follow (1:1 drew 1024×1024 and 2:3 848×1264, where they draw
 *    1408×768 unasked).
 *
 * Every request asks for ONE image: several models serve only `n: 1`, so a
 * caller that wants more runs several requests.
 */

import { IMAGE_ASPECT_RATIO_PATTERN } from '@tale/shared/schemas/providers';
import { imageSize } from 'image-size';

/** How a request reaches the provider's image API. */
export type ImageGenerationWire =
  | 'openrouter-images'
  | 'openai-images'
  | 'chat-images';

/** The shapes an agent may ask for, spelled the same for every model. */
export const IMAGE_SIZES = ['square', 'landscape', 'portrait'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** The shape an agent asked for: one of {@link IMAGE_SIZES}, or a pixel size
 * (`1536x1024`, the spelling image APIs teach models) or an aspect ratio
 * (`16:9`, the spelling people use) read by its orientation. Shared by
 * every lane's image tool, so a size means the same wherever it is asked. */
export function readImageSize(raw: unknown): ImageSize | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  const named = IMAGE_SIZES.find((candidate) => candidate === value);
  if (named !== undefined) return named;
  const shape =
    /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(value) ??
    /^([1-9]\d{0,3})\s*:\s*([1-9]\d{0,3})$/.exec(value);
  if (shape === null) return undefined;
  const width = Number(shape[1]);
  const height = Number(shape[2]);
  return width === height
    ? 'square'
    : width > height
      ? 'landscape'
      : 'portrait';
}

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

/** The aspect ratio each size asks OpenRouter for. A model whose catalog
 * entry lists the ratios it draws, and not this one, is asked for its
 * closest ({@link openRouterAspectRatio}). */
const OPENROUTER_ASPECT_RATIOS: Record<ImageSize, string> = {
  square: '1:1',
  landscape: '3:2',
  portrait: '2:3',
};

/** Width over height of a `width:height` ratio, or `undefined`. */
function ratioValue(spelled: string): number | undefined {
  const match = IMAGE_ASPECT_RATIO_PATTERN.exec(spelled);
  if (match === null) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

/**
 * The aspect ratio a request asks for where it names one — OpenRouter's
 * `aspect_ratio`, the words of a chat request: the size's own (1:1, 3:2,
 * 2:3) when the model draws it or its catalog entry does not say which it
 * draws, else the listed ratio closest to it — 4:3 for a landscape on
 * Recraft, which draws no 3:2. Closest by the logarithm of the ratio, so a
 * shape is as far from 3:2 when it is twice as wide as when it is half: a
 * landscape never turns into a portrait while the model draws any shape
 * nearer.
 */
export function openRouterAspectRatio(
  size: ImageSize,
  aspectRatios: readonly string[] | undefined,
): string {
  const preferred = OPENROUTER_ASPECT_RATIOS[size];
  if (aspectRatios === undefined || aspectRatios.includes(preferred)) {
    return preferred;
  }
  const target = Math.log(ratioValue(preferred) ?? 1);
  let best: { ratio: string; distance: number } | undefined;
  for (const ratio of aspectRatios) {
    const value = ratioValue(ratio);
    if (value === undefined) continue;
    const distance = Math.abs(Math.log(value) - target);
    if (best === undefined || distance < best.distance) {
      best = { ratio, distance };
    }
  }
  return best?.ratio ?? preferred;
}

/** The quality a GPT image model is asked for, on OpenAI and through
 * OpenRouter alike: its default, `auto`, may pick `high`, which costs about
 * four times as much an image (through OpenRouter, GPT Image 1 Mini on
 * `auto` cost 3.3 and 5.0 cents a square and a portrait image where
 * `medium` cost 0.8 and 1.3, 2026-10-27). */
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
  /** The aspect ratios the model draws, when its catalog entry lists them
   * (OpenRouter). */
  aspectRatios?: readonly string[];
  /** The model writes text as well as images, so a chat request asks it for
   * both (`chat-images`); one that only draws is asked for images alone. */
  writesText?: boolean;
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

/** The token counts a provider reports (OpenAI's images API, or a chat
 * reply's counts read the same way). */
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
  const quality = takesGptImageQuality(args.modelId)
    ? OPENAI_IMAGE_QUALITY
    : undefined;
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
        aspect_ratio: openRouterAspectRatio(args.size, args.aspectRatios),
        ...(quality !== undefined ? { quality } : {}),
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
  if (args.wire === 'chat-images') {
    const text = `${args.prompt}\n\nAspect ratio: ${openRouterAspectRatio(args.size, args.aspectRatios)} (${args.size}).`;
    return {
      url: `${base}/chat/completions`,
      headers: {
        ...args.extraHeaders,
        ...auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: args.modelId,
        messages: [
          {
            role: 'user',
            content:
              args.references.length === 0
                ? text
                : [
                    { type: 'text', text },
                    ...args.references.map((image) => ({
                      type: 'image_url',
                      image_url: { url: dataUrl(image) },
                    })),
                  ],
          },
        ],
        modalities: args.writesText === true ? ['image', 'text'] : ['image'],
      }),
    };
  }
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

/** How much of an image the size read looks at. PNG, GIF and WebP keep
 * their size in the first bytes and a JPEG after its metadata segments;
 * image-size reads its own files through the same cap. */
const PIXEL_SIZE_READ_MAX_BYTES = 512 * 1024;

/** The pixel size stored in a raster image's header, or `undefined` when the
 * header cannot be read. Reported to the agent, never relied on: each model
 * draws "landscape" at its own size (1248×832 on one, 1536×1024 on
 * another), and only the image itself says which. */
export function rasterPixelSize(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  // A capped Buffer VIEW, never the reply itself: image-size walks a JPEG
  // by slicing off each byte it skips, which copies a plain Uint8Array —
  // quadratic, so a reply of junk after a JPEG start marker would stall the
  // process for minutes — but only re-views a Buffer.
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, PIXEL_SIZE_READ_MAX_BYTES),
  );
  try {
    const { width, height } = imageSize(head);
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
 * every dialect spells it `{error: {message}}` (OpenRouter may send it on a
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

/** The provider's own error code from a reply body, if it names one as a
 * string (`{error: {code: 'moderation_blocked'}}`); OpenRouter's numeric
 * codes repeat the HTTP status. */
export function providerErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  const code = payload.error.code;
  return typeof code === 'string' && code.trim() !== ''
    ? code.trim()
    : undefined;
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

/** The token counts of a Chat Completions reply, as the image ledger reads
 * them: the prompt is text unless the reply says how much of it was images,
 * and every completion token is output. */
function readChatTokenUsage(value: unknown): ImageTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonNegativeNumber(value.prompt_tokens);
  const output = nonNegativeNumber(value.completion_tokens);
  if (input === undefined && output === undefined) return undefined;
  const details = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : undefined;
  const imageInput = Math.min(
    nonNegativeNumber(details?.image_tokens) ?? 0,
    input ?? 0,
  );
  return {
    textInputTokens: (input ?? 0) - imageInput,
    imageInputTokens: imageInput,
    outputTokens: output ?? 0,
  };
}

function decodeBase64Image(raw: string): Uint8Array | null {
  // The field is raw base64 in the image APIs; a data URL is tolerated.
  const comma = raw.startsWith('data:') ? raw.indexOf(',') : -1;
  const encoded = comma >= 0 ? raw.slice(comma + 1) : raw;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

/** The charge in US dollars a reply reports in `usage.cost`: a number, as
 * OpenRouter writes it, or an object whose `total_cost` is the charge, as
 * Bifrost relays it (`{"total_cost": 0.039}`, 2026-11-03). */
function reportedCostUsd(
  usage: Record<string, unknown> | undefined,
): number | undefined {
  const cost = usage?.cost;
  return nonNegativeNumber(isRecord(cost) ? cost.total_cost : cost);
}

/** What a reply reports it cost, in its dialect: OpenRouter's charge in
 * US dollars, OpenAI's token counts, and on a chat reply the charge where
 * one is reported, else the chat token counts. */
function readCharge(
  wire: ImageGenerationWire,
  payload: unknown,
): ImageReplyCharge {
  const usage =
    isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  if (wire === 'openrouter-images' || wire === 'chat-images') {
    const costUsd = reportedCostUsd(usage);
    if (costUsd !== undefined) return { costUsd };
    if (wire === 'openrouter-images') return {};
    const tokens = readChatTokenUsage(usage);
    return tokens !== undefined ? { usage: tokens } : {};
  }
  const tokens = readTokenUsage(usage);
  return tokens !== undefined ? { usage: tokens } : {};
}

/** A base64 image inside a data URL, wherever a chat reply writes one: a
 * part's `url`, or Markdown in the message text. */
const DATA_URL_IMAGE = /data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/]+=*)/gi;
/** How much of each text a chat reply writes, once its images are taken
 * out, is searched for Markdown images and kept as words: only the start is
 * ever quoted ({@link REPLY_TEXT_EXCERPT}) and a link only counted. Over a
 * whole reply a Markdown pattern takes quadratic time on text full of `![`
 * without a closing bracket — seconds for a few hundred kilobytes. */
const REPLY_TEXT_SCAN = 4096;
/** A Markdown image whose source was taken out (`![image]()`): what a chat
 * reply's text keeps of an image once it is read. */
const EMPTIED_MARKDOWN_IMAGE = /!\[[^\]\n]{0,256}\]\(\s*\)/g;
/** A Markdown image that links to an address. */
const MARKDOWN_LINKED_IMAGE = /!\[[^\]\n]{0,256}\]\(\s*https?:\/\//gi;
/** How much of a reply's words without an image the error quotes. */
const REPLY_TEXT_EXCERPT = 300;

/** What a chat reply carries instead of, or beside, its images. */
interface ChatReplyImages {
  /** The base64 of each image, in reply order, without repeats. */
  encoded: string[];
  /** The message's words, without its images. */
  text: string;
  /** Images the reply links to instead of sending: the platform fetches
   * no address a model names. */
  links: number;
}

/** The images of a Chat Completions reply's first choice (one request asks
 * for one image), or `undefined` when the reply holds no message at all. */
function readChatReplyImages(payload: unknown): ChatReplyImages | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  const message = choice.message;
  const found = new Set<string>();
  const words: string[] = [];
  let links = 0;
  const readDataUrls = (text: string) => {
    for (const match of text.matchAll(DATA_URL_IMAGE)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  };
  const readText = (text: string) => {
    readDataUrls(text);
    const rest = text.replace(DATA_URL_IMAGE, '').slice(0, REPLY_TEXT_SCAN);
    links += [...rest.matchAll(MARKDOWN_LINKED_IMAGE)].length;
    words.push(rest.replace(EMPTIED_MARKDOWN_IMAGE, ' '));
  };
  const readUrl = (url: unknown) => {
    if (typeof url !== 'string') return;
    if (/^https?:\/\//i.test(url)) links += 1;
    else readDataUrls(url);
  };
  const readPart = (part: unknown) => {
    if (!isRecord(part)) return;
    if (typeof part.text === 'string') readText(part.text);
    else if (typeof part.b64_json === 'string') {
      found.add(part.b64_json.replace(/^data:[^,]*,/, ''));
    } else {
      readUrl(
        isRecord(part.image_url)
          ? part.image_url.url
          : (part.image_url ?? part.url),
      );
    }
  };
  if (Array.isArray(message.images)) message.images.forEach(readPart);
  if (typeof message.content === 'string') readText(message.content);
  else if (Array.isArray(message.content)) message.content.forEach(readPart);
  return {
    encoded: [...found],
    text: words.join(' ').replace(/\s+/g, ' ').trim(),
    links,
  };
}

/** Why a chat reply that carries no image the platform can store has none,
 * in words the agent can relay: what the model wrote instead, if anything. */
function chatReplyWithoutImage(chat: ChatReplyImages): string {
  if (chat.links > 0) {
    return 'the model answered with a link to an image rather than the image itself, and the platform fetches no address a model names';
  }
  if (chat.text === '') return 'the model answered without an image';
  const excerpt =
    chat.text.length > REPLY_TEXT_EXCERPT
      ? `${chat.text.slice(0, REPLY_TEXT_EXCERPT).trimEnd()}…`
      : chat.text;
  return `the model answered in words without an image: "${excerpt}"`;
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
  let encoded: string[];
  let chat: ChatReplyImages | undefined;
  if (wire === 'chat-images') {
    chat = readChatReplyImages(payload);
    if (chat === undefined) {
      throw new ImageReplyError(
        'the provider answered without a chat message',
        charge,
      );
    }
    encoded = chat.encoded;
  } else {
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new ImageReplyError(
        'the provider answered without an image list',
        charge,
      );
    }
    encoded = payload.data.flatMap((item: unknown) =>
      isRecord(item) && typeof item.b64_json === 'string'
        ? [item.b64_json]
        : [],
    );
  }
  const images: GeneratedImage[] = [];
  let refusedFormats = 0;
  for (const raw of encoded) {
    const bytes = decodeBase64Image(raw);
    if (bytes === null) continue;
    const mediaType = sniffRasterMediaType(bytes);
    if (mediaType === null) {
      refusedFormats += 1;
      continue;
    }
    const size = rasterPixelSize(bytes);
    // An image read out of a chat reply must be one: a sample data URL the
    // model wrote among its words carries a signature and nothing more.
    if (chat !== undefined && size === undefined) continue;
    images.push({ bytes, mediaType, ...size });
  }
  if (images.length === 0) {
    throw new ImageReplyError(
      refusedFormats > 0
        ? 'the model returned an image format the platform does not store (PNG, JPEG, WebP and GIF are); pick a raster image model'
        : chat !== undefined
          ? chatReplyWithoutImage(chat)
          : 'the provider answered without an image',
      charge,
    );
  }
  return { images, refusedFormats, ...charge };
}
