'use node';

/**
 * Shared image-generation core.
 *
 * Resolves an image model and turns a text (optionally image-referenced)
 * prompt into raw image bytes, then persists those bytes to Convex storage as
 * downloadable file parts. Used by BOTH the direct-mode image agent
 * (`runImageGeneration`, which saves a fresh assistant message) and the inline
 * `generate_image` chat tool (which appends an image card to the current
 * assistant turn) so the two paths can never drift in how they call the model.
 */

import { generateImage } from 'ai';

import { parseModelRef } from '../../../lib/shared/utils/model-ref';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { buildDownloadUrl } from '../../lib/helpers/public_storage_url';
import {
  buildCallProviderOptions,
  isPlainObject,
  stripDenyListed,
} from '../../lib/provider_options';
import {
  resolveImageModelById,
  resolveImageModelByTag,
  type ResolvedImageModel,
} from '../../providers/resolve_model';

export interface GeneratedImageBlob {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ImageGenerationOutput {
  imageBlobs: GeneratedImageBlob[];
  usage?: ImageUsage;
  /** USD cost the gateway billed, when reported (OpenRouter `usage.cost`). */
  providerCostUsd?: number;
  resolved: ResolvedImageModel;
}

/**
 * Resolve, then call, an image model. `modelRef` accepts `provider:model-id`
 * or a bare `model-id`; an empty string (or `'default'`) falls back to the
 * org's `image-generation` tag default. Reference images (edit mode) require a
 * model tagged `image-edit`. Throws when the model returns no image.
 */
export async function generateImageBlobs(
  ctx: ActionCtx,
  opts: {
    modelRef: string;
    textPrompt: string;
    attachmentBytes?: GeneratedImageBlob[];
    organizationId: string;
  },
): Promise<ImageGenerationOutput> {
  const attachmentBytes = opts.attachmentBytes ?? [];
  const hasAttachments = attachmentBytes.length > 0;

  let resolved: ResolvedImageModel;
  if (opts.modelRef && opts.modelRef !== 'default') {
    const { providerName, modelId } = parseModelRef(opts.modelRef);
    resolved = await resolveImageModelById(ctx, {
      modelId,
      providerName,
      organizationId: opts.organizationId,
    });
  } else {
    resolved = await resolveImageModelByTag(ctx, {
      organizationId: opts.organizationId,
    });
  }

  // Edit-mode guard — text-only models cannot consume reference images.
  if (hasAttachments && !resolved.modelData.tags.includes('image-edit')) {
    throw new Error(
      `Model "${resolved.modelData.modelId}" does not support image editing. ` +
        'Switch to FLUX Kontext or Nano Banana to use attached images as references.',
    );
  }

  const imageBlobs: GeneratedImageBlob[] = [];
  let usage: ImageUsage | undefined;
  let providerCostUsd: number | undefined;

  if (resolved.kind === 'images-api') {
    // `prompt.images` at the AI SDK level routes to the standard OpenAI
    // `/v1/images/edits` multipart endpoint — supported by LocalAI, LiteLLM,
    // self-hosted gateways, and OpenAI itself. Gateways that don't expose
    // `/v1/images/edits` (e.g. Vercel AI Gateway) will fail here; remove the
    // `image-edit` tag from those models so the UI never sends edit requests.
    const promptArg: string | { text: string; images: Uint8Array[] } =
      hasAttachments
        ? { text: opts.textPrompt, images: attachmentBytes.map((a) => a.bytes) }
        : opts.textPrompt;

    const imageProviderOptions = buildCallProviderOptions(resolved.modelData);
    const result = await generateImage({
      model: resolved.imageModel,
      prompt: promptArg,
      n: 1,
      ...(imageProviderOptions
        ? { providerOptions: imageProviderOptions }
        : {}),
    });
    for (const img of result.images) {
      imageBlobs.push({
        bytes: img.uint8Array,
        mediaType: img.mediaType || 'image/png',
      });
    }
  } else {
    // chat-multimodal — Nano Banana / GPT-Image / OpenRouter FLUX / etc.
    //
    // We do NOT go through @ai-sdk/openai-compatible here: its chat response
    // parser reads only `choices[0].message.content` and `.tool_calls`,
    // silently dropping `choices[0].message.images[]` — which is exactly where
    // gateways (OpenRouter, Vercel Gateway, plus the OpenAI gpt-image-in-chat
    // spec) put generated images. `generateText` would therefore always see
    // `result.files === []`. The wire shape is well-defined, so we issue the
    // /chat/completions call directly and parse the images out ourselves.
    const {
      images: extractedImages,
      usage: extractedUsage,
      providerCostUsd: extractedCostUsd,
    } = await fetchChatCompletionImages({
      baseUrl: resolved.modelData.baseUrl,
      apiKey: resolved.modelData.apiKey,
      modelId: resolved.modelData.modelId,
      textPrompt: opts.textPrompt,
      attachmentImages: attachmentBytes,
      providerOptions: stripDenyListed(resolved.modelData.providerOptions),
    });
    for (const img of extractedImages) imageBlobs.push(img);
    usage = extractedUsage;
    providerCostUsd = extractedCostUsd;
  }

  if (imageBlobs.length === 0) {
    throw new Error(`Model "${resolved.modelData.modelId}" returned no image.`);
  }

  return { imageBlobs, usage, providerCostUsd, resolved };
}

export interface PersistedImage {
  storageId: Id<'_storage'>;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
}

/**
 * Persist one generated image to Convex storage and build a browser-reachable
 * download URL. `buildDownloadUrl` carries `?id=<storageId>`, which the
 * frontend's EditingBanner relies on to round-trip the image as a reference
 * attachment for follow-up edit requests.
 */
export async function persistImageBlob(
  ctx: ActionCtx,
  blob: GeneratedImageBlob,
  namePrefix: string,
  idx: number,
): Promise<PersistedImage> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Uint8Array<ArrayBufferLike> ↔ BlobPart mismatch is a TS strictness quirk; runtime is fine.
  const fileBlob = new Blob([blob.bytes as BlobPart], { type: blob.mediaType });
  const storageId = await ctx.storage.store(fileBlob);
  const extension = blob.mediaType.split('/')[1] ?? 'png';
  const fileName = `${namePrefix}-${Date.now()}-${idx + 1}.${extension}`;
  return {
    storageId,
    downloadUrl: buildDownloadUrl(storageId, fileName),
    fileName,
    mimeType: blob.mediaType,
  };
}

interface ChatCompletionsImageResult {
  images: GeneratedImageBlob[];
  usage: ImageUsage;
  /**
   * Actual cost in USD reported by the gateway (OpenRouter exposes this via
   * `usage.cost`). Undefined when the gateway doesn't return a cost field, in
   * which case callers fall back to the model's static per-image price.
   */
  providerCostUsd?: number;
}

/**
 * Direct POST to `/chat/completions` with multimodal output, parsing image
 * data URIs out of `choices[0].message.images[].image_url.url`.
 *
 * This is the documented response shape used by OpenRouter and Vercel AI
 * Gateway for image-producing chat models, AND is what OpenAI itself emits for
 * its multimodal GPT-image-in-chat output. `@ai-sdk/openai-compatible`'s chat
 * response parser ignores `message.images`, so we go direct instead of chasing
 * AI SDK abstractions that don't know about it.
 */
async function fetchChatCompletionImages(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  textPrompt: string;
  attachmentImages: GeneratedImageBlob[];
  providerOptions?: Record<string, unknown>;
}): Promise<ChatCompletionsImageResult> {
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: opts.textPrompt }];
  for (const att of opts.attachmentImages) {
    const b64 = Buffer.from(att.bytes).toString('base64');
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${att.mediaType};base64,${b64}` },
    });
  }

  // Gateways that honor OpenAI's multimodal-output spec read `modalities` as a
  // top-level body field. Unknown-field tolerant gateways ignore it.
  // `usage.include` asks OpenRouter to return the actual USD cost in
  // `usage.cost` — megapixel-priced image models don't fit a flat per-image
  // rate, so we prefer the gateway's billed amount over a static estimate.
  //
  // Per-model `providerOptions` (already deny-list-stripped) spread first so
  // the protected keys below win on collision: `model`/`messages`/`modalities`
  // must never be overridable from config, and `usage` requires a nested merge
  // so callers can extend without dropping `include: true`.
  const incomingUsage = isPlainObject(opts.providerOptions?.usage)
    ? opts.providerOptions.usage
    : {};
  const body = {
    ...(opts.providerOptions ? opts.providerOptions : {}),
    model: opts.modelId,
    messages: [{ role: 'user', content: userContent }],
    modalities: ['image'],
    usage: { ...incomingUsage, include: true },
  };

  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `${opts.modelId} chat/completions failed (${response.status}): ${errText || response.statusText}`,
    );
  }

  const json = (await response.json()) as unknown;
  if (
    !json ||
    typeof json !== 'object' ||
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object by the checks above
    !Array.isArray((json as { choices?: unknown }).choices)
  ) {
    throw new Error('Unexpected chat/completions response shape');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by shape check above
  const body_ = json as {
    choices: Array<{
      message?: {
        content?: string | null;
        images?: Array<{
          type?: string;
          image_url?: { url?: string } | string;
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };

  const rawImages = body_.choices[0]?.message?.images ?? [];
  const images: GeneratedImageBlob[] = [];
  for (const entry of rawImages) {
    const entryUrl =
      typeof entry.image_url === 'string'
        ? entry.image_url
        : entry.image_url?.url;
    if (!entryUrl) continue;
    const parsed = parseDataUri(entryUrl);
    if (parsed) images.push(parsed);
  }

  return {
    images,
    usage: {
      inputTokens: body_.usage?.prompt_tokens ?? 0,
      outputTokens: body_.usage?.completion_tokens ?? 0,
      totalTokens: body_.usage?.total_tokens ?? 0,
    },
    providerCostUsd:
      typeof body_.usage?.cost === 'number' ? body_.usage.cost : undefined,
  };
}

export function parseDataUri(url: string): GeneratedImageBlob | null {
  // data:image/png;base64,xxxx
  const match = /^data:([^;,]+)(?:;base64)?,([\s\S]+)$/.exec(url);
  if (!match) return null;
  const mediaType = match[1] || 'image/png';
  const payload = match[2];
  if (!payload) return null;
  try {
    return { bytes: new Uint8Array(Buffer.from(payload, 'base64')), mediaType };
  } catch (err) {
    console.warn('[parseDataUri] base64 decode failed:', err);
    return null;
  }
}
