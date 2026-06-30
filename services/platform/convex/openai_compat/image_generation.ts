'use node';

/**
 * Image generation for the OpenAI-compatible endpoint.
 *
 * Reuses the shared `generateImageBlobs` / `persistImageBlob` core (the same
 * code the in-product image agent and the inline `generate_image` tool use) so
 * the API path can never drift from how the rest of the app calls image
 * models. Used by BOTH the `/api/v1/images/generations` handler and the
 * `/api/v1/chat/completions` image branch (when an `image-generation`-tagged
 * model is requested) so the two surfaces share one code path.
 */

import type { ActionCtx } from '../_generated/server';
import {
  type GeneratedImageBlob,
  generateImageBlobs,
  type ImageUsage,
  parseDataUri,
  type PersistedImage,
  persistImageBlob,
} from '../agents/image_generation/generate_image_blobs';
import { roundCents } from '../governance/cost_estimation';
import { imageUrlsOf } from './content';

/** Hard ceiling on `n` so one request can't fan out into an unbounded number
 * of (separately billed) model calls. OpenAI's own cap for most image models. */
export const MAX_IMAGES_PER_REQUEST = 4;

/**
 * Decode `data:` URLs from an OpenAI content-part array into image bytes — the
 * reference images for an edit request. Only `data:` URLs are accepted (the
 * standard way to pass a local image): we never fetch a user-supplied `http`
 * URL server-side, which would be an SSRF surface. `http(s)` image parts are
 * left for the model to fetch on the vision (text) path.
 */
export function extractDataUriImages(
  userContent: unknown,
): GeneratedImageBlob[] {
  const out: GeneratedImageBlob[] = [];
  for (const url of imageUrlsOf(userContent)) {
    if (url.startsWith('data:')) {
      const blob = parseDataUri(url);
      if (blob) out.push(blob);
    }
  }
  return out;
}

export interface ApiImageResult {
  /** Persisted images (Convex storage + browser-reachable download URL). */
  persisted: PersistedImage[];
  /** Raw bytes, for `response_format: 'b64_json'` callers. */
  blobs: GeneratedImageBlob[];
  usage: ImageUsage;
  /** USD the gateway billed, summed across calls, when reported. */
  providerCostUsd?: number;
  /** Estimated cost in cents (provider USD ?? per-image rate), when derivable. */
  costCents?: number;
  modelId: string;
  providerName: string;
  /** Whether `n` was clamped to {@link MAX_IMAGES_PER_REQUEST}. */
  clamped: boolean;
}

/**
 * Resolve and call an image model `n` times, persisting every produced image.
 * `modelRef` is `provider:model-id` or a bare `model-id`; empty falls back to
 * the org's `image-generation` default. Throws when the model returns no image
 * (so callers can record a failure rather than bill for nothing).
 */
export async function generateApiImages(
  ctx: ActionCtx,
  opts: {
    modelRef: string;
    prompt: string;
    n?: number;
    organizationId: string;
    namePrefix?: string;
    /** Reference images (decoded `data:` URLs) — present ⇒ edit mode. */
    attachmentBytes?: GeneratedImageBlob[];
  },
): Promise<ApiImageResult> {
  const requested = opts.n ?? 1;
  const n = Math.max(1, Math.min(requested, MAX_IMAGES_PER_REQUEST));
  const clamped = requested > MAX_IMAGES_PER_REQUEST;

  const blobs: GeneratedImageBlob[] = [];
  const usage: ImageUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let providerCostUsd: number | undefined;
  let modelId = '';
  let providerName = '';
  let imageCentsPerImage: number | undefined;

  for (let i = 0; i < n; i++) {
    const out = await generateImageBlobs(ctx, {
      modelRef: opts.modelRef,
      textPrompt: opts.prompt,
      attachmentBytes: opts.attachmentBytes,
      organizationId: opts.organizationId,
    });
    blobs.push(...out.imageBlobs);
    if (out.usage) {
      usage.inputTokens += out.usage.inputTokens;
      usage.outputTokens += out.usage.outputTokens;
      usage.totalTokens += out.usage.totalTokens;
    }
    if (out.providerCostUsd != null) {
      providerCostUsd = (providerCostUsd ?? 0) + out.providerCostUsd;
    }
    modelId = out.resolved.modelData.modelId;
    providerName = out.resolved.modelData.providerName;
    imageCentsPerImage = out.resolved.modelData.imageCentsPerImage;
  }

  const persisted = await Promise.all(
    blobs.map((blob, idx) =>
      persistImageBlob(ctx, blob, opts.namePrefix ?? 'openai-image', idx),
    ),
  );

  // Prefer the gateway's billed USD (megapixel-priced models don't fit a flat
  // per-image rate); fall back to the model's static per-image price.
  const costCents =
    providerCostUsd != null
      ? roundCents(providerCostUsd * 100)
      : imageCentsPerImage != null
        ? blobs.length * imageCentsPerImage
        : undefined;

  return {
    persisted,
    blobs,
    usage,
    providerCostUsd,
    costCents,
    modelId,
    providerName,
    clamped,
  };
}
