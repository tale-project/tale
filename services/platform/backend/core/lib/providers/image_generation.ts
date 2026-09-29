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
import {
  safeFetch,
  SafeFetchError,
  type SafeFetchErrorKind,
} from '../../../../lib/net/safe-fetch';
import { estimateImageGenerationCostCents } from '../../governance/cost_estimation';
import { sanitizeError } from '../utils/sanitize_secrets';
import {
  buildImageRequest,
  ImageReplyError,
  parseImageReply,
  providerErrorMessage,
  type GeneratedImage,
  type ImageReplyCharge,
  type ImageSize,
  type ImageWireRequest,
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

/** A call the provider refused or could not complete. The message is fit to
 * relay to the agent: the provider's own sentence (redacted), or a plain
 * account of a transport failure that names no host. `charge` is set when
 * the provider answered the request — and so billed it — without an image
 * the platform can store. */
export class ImageProviderError extends Error {
  readonly charge?: { costCents: number };
  constructor(
    message: string,
    options?: { cause?: unknown; charge?: { costCents: number } },
  ) {
    super(message, options);
    this.name = 'ImageProviderError';
    if (options?.charge !== undefined) this.charge = options.charge;
  }
}

/** What a transport failure is told as. The detail — an address, a host
 * the network policy refused — stays in the platform's log: it describes
 * the deployment's network, not the provider's answer. */
function transportFailure(kind: SafeFetchErrorKind): string {
  switch (kind) {
    case 'timeout':
      return `did not answer within ${REQUEST_TIMEOUT_MS / 60_000} minutes`;
    case 'aborted':
      return 'was cancelled before it answered';
    case 'response_too_large':
      return 'answered with more data than the platform accepts for one image';
    default:
      return 'could not be reached';
  }
}

/** The ledger's figure for a reply's reported charge. */
function costCentsOf(
  model: ResolvedImageModel,
  charge: ImageReplyCharge,
): number {
  return estimateImageGenerationCostCents({
    ...(charge.costUsd !== undefined ? { reportedUsd: charge.costUsd } : {}),
    ...(charge.usage !== undefined ? { usage: charge.usage } : {}),
    ...(model.pricing !== undefined ? { pricing: model.pricing } : {}),
  });
}

/** The one request a call sends for each image it asks for — built once,
 * so the reference images are encoded once whatever the count. */
export function prepareImageRequest(
  model: ResolvedImageModel,
  args: {
    prompt: string;
    size: ImageSize;
    references: readonly ReferenceImage[];
  },
): ImageWireRequest {
  return buildImageRequest({
    wire: model.wire,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelId: model.modelId,
    prompt: args.prompt,
    size: args.size,
    references: args.references,
    extraHeaders: model.attribution,
  });
}

/** Send one prepared request: ONE image. */
export async function generateOneImage(
  model: ResolvedImageModel,
  request: ImageWireRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ImageCallResult> {
  let response;
  try {
    response = await safeFetch(request.url, {
      allowPrivateAddresses: privateProviderHostsAllowed(),
      method: 'POST',
      headers: request.headers,
      body: request.body,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof SafeFetchError) {
      console.warn(
        `[image-generation] ${model.providerSlug}/${model.modelId} request failed (${error.kind}): ${redacted(model, error)}`,
      );
      throw new ImageProviderError(
        `${model.providerDisplayName} ${transportFailure(error.kind)}`,
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
  // From here on the provider has answered the request: whatever the reply
  // is worth, the request is billed.
  if (parseError !== undefined) {
    throw new ImageProviderError(
      `${model.providerDisplayName} answered with a body that is not JSON`,
      { cause: parseError, charge: { costCents: 0 } },
    );
  }

  let reply;
  try {
    reply = parseImageReply(model.wire, payload);
  } catch (error) {
    if (error instanceof ImageReplyError) {
      throw new ImageProviderError(
        `${model.providerDisplayName} returned no usable image: ${redacted(model, error)}`,
        {
          cause: error,
          charge: { costCents: costCentsOf(model, error.charge) },
        },
      );
    }
    throw error;
  }
  if (reply.refusedFormats > 0) {
    console.warn(
      `[image-generation] ${model.providerSlug}/${model.modelId} returned ${reply.refusedFormats} image(s) in a format the platform does not store`,
    );
  }
  return { images: reply.images, costCents: costCentsOf(model, reply) };
}
