'use node';

/**
 * One image-generation call against the organization's resolved image
 * model: the wire shaping (`image_wire.ts`) sent through the platform's one
 * audited outbound client (`safeFetch`, with the same private-host policy as
 * every other provider call), and the reply read back into image bytes plus
 * what it cost.
 *
 * The credential rides the request from the server alone — the sandbox that
 * asked for the image never sees it.
 */

import { privateProviderHostsAllowed } from '../../../../lib/net/host-policy';
import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import { estimateImageGenerationCostCents } from '../../governance/cost_estimation';
import { sanitizeError } from '../utils/sanitize_secrets';
import {
  buildImageRequest,
  ImageReplyError,
  parseImageReply,
  providerErrorMessage,
  type GeneratedImage,
  type ImageSize,
  type ReferenceImage,
} from './image_wire';
import type { ResolvedImageModel } from './resolve_image_model';

/** A slow image model (a high-quality GPT image) takes up to two minutes;
 * past three the call is abandoned rather than holding a request open. */
const REQUEST_TIMEOUT_MS = 180_000;
/** One image's reply: base64 grows a 20 MB image to about 27 MB. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** The stored excerpt of an upstream error body; secrets are handled by
 * redaction, not by cutting the text short. */
const ERROR_EXCERPT = 600;

export interface ImageCallResult {
  images: GeneratedImage[];
  /** The ledger's figure for this call: the provider's reported charge, or
   * the catalog price of the tokens it reported, else 0. */
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

/** Provider text as the agent may read it: the shared secret redaction,
 * plus this call's own key in whatever format the credential stores it (a
 * custom provider's key carries no recognizable prefix). */
function redacted(model: ResolvedImageModel, text: unknown): string {
  const clean = sanitizeError(text, ERROR_EXCERPT);
  return model.apiKey.length >= 8
    ? clean.replaceAll(model.apiKey, '[redacted]')
    : clean;
}

/** A call the provider refused or could not complete. The message is the
 * provider's own sentence (redacted), fit to relay to the agent. */
export class ImageProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageProviderError';
  }
}

/** Generate ONE image. */
export async function generateOneImage(
  model: ResolvedImageModel,
  args: {
    prompt: string;
    size: ImageSize;
    references: readonly ReferenceImage[];
    signal?: AbortSignal;
  },
): Promise<ImageCallResult> {
  const request = buildImageRequest({
    wire: model.wire,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelId: model.modelId,
    prompt: args.prompt,
    size: args.size,
    references: args.references,
    extraHeaders: model.attribution,
  });

  let response;
  try {
    response = await safeFetch(request.url, {
      allowPrivateAddresses: privateProviderHostsAllowed(),
      method: 'POST',
      headers: request.headers,
      body: request.body,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
  } catch (error) {
    if (error instanceof SafeFetchError) {
      throw new ImageProviderError(
        `${model.providerDisplayName} could not be reached (${error.kind}): ${redacted(model, error)}`,
        { cause: error },
      );
    }
    throw error;
  }

  let payload: unknown;
  let parseError: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    parseError = error;
  }
  if (response.status < 200 || response.status >= 300) {
    const said = providerErrorMessage(payload);
    throw new ImageProviderError(
      `${model.providerDisplayName} refused the image request (${response.status})${said !== undefined ? `: ${redacted(model, said)}` : ''}`,
    );
  }
  if (parseError !== undefined) {
    throw new ImageProviderError(
      `${model.providerDisplayName} answered with a body that is not JSON`,
      { cause: parseError },
    );
  }

  let reply;
  try {
    reply = parseImageReply(model.wire, payload);
  } catch (error) {
    if (error instanceof ImageReplyError) {
      throw new ImageProviderError(
        `${model.providerDisplayName} returned no usable image: ${redacted(model, error)}`,
        { cause: error },
      );
    }
    throw error;
  }
  if (reply.refusedFormats > 0) {
    console.warn(
      `[image-generation] ${model.providerSlug}/${model.modelId} returned ${reply.refusedFormats} image(s) in a format the platform does not store`,
    );
  }
  const usage = reply.usage;
  return {
    images: reply.images,
    costCents: estimateImageGenerationCostCents({
      ...(reply.costUsd !== undefined ? { reportedUsd: reply.costUsd } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(model.pricing !== undefined ? { pricing: model.pricing } : {}),
    }),
    inputTokens:
      usage !== undefined ? usage.textInputTokens + usage.imageInputTokens : 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}
