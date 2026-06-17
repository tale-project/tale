'use node';

/**
 * OpenAI Vision API client for OCR and image description.
 *
 * Constructor-injected configuration — no global state or settings imports.
 * Each service creates its own VisionClient instance with its own config.
 */

import OpenAI from 'openai';

import { VisionCache } from './cache';

export const OCR_PROMPT = `Extract ALL text from this document image.
Preserve the original layout and formatting as much as possible.
Include headers, paragraphs, lists, tables, and any other text content.
If there's no readable text, respond with "[No text found]".
Return ONLY the extracted text, nothing else.`;

export const DESCRIBE_PROMPT = `Briefly describe this image in 1-2 short sentences (max 150 characters).
Focus on: image type (photo/chart/diagram), main subject, and key visible text.
Be extremely concise - omit minor details.`;

const MAGIC_BYTES: [Uint8Array, string][] = [
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png'], // \x89PNG
  [new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg'],
  [new Uint8Array([0x47, 0x49, 0x46, 0x38]), 'image/gif'], // GIF8
  [new Uint8Array([0x52, 0x49, 0x46, 0x46]), 'image/webp'], // RIFF (+WEBP check)
  [new Uint8Array([0x42, 0x4d]), 'image/bmp'], // BM
  [new Uint8Array([0x49, 0x49, 0x2a, 0x00]), 'image/tiff'], // II*\0
  [new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]), 'image/tiff'], // MM\0*
];

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

export function detectMimeType(imageBytes: Uint8Array): string {
  for (const [magic, mime] of MAGIC_BYTES) {
    if (startsWith(imageBytes, magic)) {
      if (mime === 'image/webp') {
        // RIFF container: confirm the WEBP fourcc at offset 8.
        const webp = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // WEBP
        const slice = imageBytes.subarray(8, 12);
        if (startsWith(slice, webp)) {
          return mime;
        }
        continue;
      }
      return mime;
    }
  }
  return 'image/png';
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export interface VisionClientOptions {
  baseUrl?: string | null;
  timeout?: number;
  requestTimeout?: number;
  maxConcurrentPages?: number;
  pdfDpi?: number;
  ocrPrompt?: string;
  describePrompt?: string;
  cache?: VisionCache;
}

export class VisionClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly requestTimeout: number;
  private readonly cache: VisionCache;
  private readonly ocrPrompt: string;
  private readonly describePrompt: string;
  readonly maxConcurrentPages: number;
  readonly pdfDpi: number;

  constructor(
    apiKey: string,
    model: string,
    options: VisionClientOptions = {},
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseUrl ?? undefined,
      timeout: (options.timeout ?? 120.0) * 1000,
    });
    this.model = model;
    this.requestTimeout = (options.requestTimeout ?? 120.0) * 1000;
    this.maxConcurrentPages = options.maxConcurrentPages ?? 3;
    this.pdfDpi = options.pdfDpi ?? 200;
    this.ocrPrompt = options.ocrPrompt ?? OCR_PROMPT;
    this.describePrompt = options.describePrompt ?? DESCRIBE_PROMPT;
    this.cache = options.cache ?? new VisionCache();
  }

  getCache(): VisionCache {
    return this.cache;
  }

  private async completion(
    imageBytes: Uint8Array,
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const imageB64 = toBase64(imageBytes);
    const mimeType = detectMimeType(imageBytes);

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${imageB64}` },
              },
            ],
          },
        ],
        max_tokens: maxTokens,
      },
      { timeout: this.requestTimeout },
    );

    return response.choices[0]?.message.content ?? '';
  }

  private async doOcr(imageBytes: Uint8Array, prompt: string): Promise<string> {
    let result: string;
    try {
      result = await this.completion(imageBytes, prompt, 4096);
    } catch (err) {
      console.error(
        `Vision API OCR request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    const normalized = result.trim().toLowerCase();
    if (
      normalized === '[no text found]' ||
      normalized === 'no text found' ||
      normalized === ''
    ) {
      return '';
    }
    return result;
  }

  private async doDescribe(
    imageBytes: Uint8Array,
    prompt: string,
  ): Promise<string> {
    try {
      return (await this.completion(imageBytes, prompt, 100)).trim();
    } catch (err) {
      console.error(
        `Vision API description request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /** Extract text from a scanned document image, coalescing duplicate calls. */
  async ocrImage(imageBytes: Uint8Array, prompt?: string): Promise<string> {
    const extractionPrompt = prompt ?? this.ocrPrompt;
    return this.cache.getOrSetOcr(imageBytes, () =>
      this.doOcr(imageBytes, extractionPrompt),
    );
  }

  /** Generate a description of an image for indexing, coalescing duplicate calls. */
  async describeImage(
    imageBytes: Uint8Array,
    prompt?: string,
  ): Promise<string> {
    const descriptionPrompt = prompt ?? this.describePrompt;
    return this.cache.getOrSetDescription(imageBytes, () =>
      this.doDescribe(imageBytes, descriptionPrompt),
    );
  }
}
