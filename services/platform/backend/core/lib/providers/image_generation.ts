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
 *
 * A model reached through an image API the platform has not verified — an
 * AI gateway's, which routes other vendors' models — carries a fallback wire
 * (`resolve_image_model.ts`): a gateway may serve a model over chat alone
 * (Bifrost implements no images API for OpenRouter and refuses it with 400,
 * and one gateway's Gemini backend answered 404). A call such a gateway
 * refuses with a status that says it cannot serve that API for the model
 * ({@link GATEWAY_REFUSAL_STATUSES}) is sent again on the fallback wire, and
 * when that serves it, later calls of the organization's model on that
 * gateway go there first, for a while. A refusal costs nothing; an answer
 * without a usable image is billed, so it is never asked again.
 */

import { LRUCache } from 'lru-cache';

import { privateProviderHostsAllowed } from '../../../../lib/net/host-policy';
import {
  safeFetch,
  SafeFetchError,
  type SafeFetchErrorKind,
} from '../../../../lib/net/safe-fetch';
import { estimateImageGenerationCostCents } from '../../governance/cost_estimation';
import { sanitizeError } from '../utils/sanitize_secrets';
import { GATEWAY_REFUSAL_STATUSES } from './gateway_refusal';
import {
  buildImageRequest,
  ImageReplyError,
  parseImageReply,
  providerErrorCode,
  providerErrorMessage,
  type GeneratedImage,
  type ImageGenerationWire,
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
/** How long a fallback wire that served a refused model stays its first. */
const SERVED_WIRE_TTL_MS = 24 * 60 * 60 * 1000;
/** Gateway models remembered. */
const REMEMBERED_MODELS = 512;
/** The error codes with which a provider refuses the prompt itself, under
 * its content policy (OpenAI's images API, Azure's), rather than the API:
 * asked on another API, the same prompt would only be judged again. */
const CONTENT_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'moderation_blocked',
  'content_policy_violation',
  'content_filter',
]);

/** The wire that served a model after its own was refused, per
 * organization, provider, endpoint and model: two organizations on one
 * gateway hold different keys, which may reach different routes. */
const servedOnFallback = new LRUCache<string, ImageGenerationWire>({
  max: REMEMBERED_MODELS,
  ttl: SERVED_WIRE_TTL_MS,
});

function servedWireKey(model: ResolvedImageModel): string {
  return JSON.stringify([
    model.organizationId,
    model.providerSlug,
    model.baseUrl,
    model.modelId,
  ]);
}

/** Forget which wire served each model — for tests, which share the
 * process. */
export function forgetServedImageWires(): void {
  servedOnFallback.clear();
}

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
 * the platform can store; `refusedStatus` when it refused the request
 * outright, with that HTTP status, and `refusedCode` when the refusal names
 * its own error code. */
export class ImageProviderError extends Error {
  readonly charge?: { costCents: number };
  readonly refusedStatus?: number;
  readonly refusedCode?: string;
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      charge?: { costCents: number };
      refusedStatus?: number;
      refusedCode?: string;
    },
  ) {
    super(message, options);
    this.name = 'ImageProviderError';
    if (options?.charge !== undefined) this.charge = options.charge;
    if (options?.refusedStatus !== undefined) {
      this.refusedStatus = options.refusedStatus;
    }
    if (options?.refusedCode !== undefined) {
      this.refusedCode = options.refusedCode;
    }
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

/** The request a call sends for each image it asks for, on the model's own
 * wire — and, for a model that has one, on its fallback wire, built on first
 * use: a call its own wire serves encodes the reference images once. */
export interface PreparedImageRequest extends ImageWireRequest {
  readonly wire: ImageGenerationWire;
  readonly fallback?: () => PreparedImageRequest;
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
): PreparedImageRequest {
  const build = (wire: ImageGenerationWire): PreparedImageRequest => ({
    ...buildImageRequest({
      wire,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelId: model.modelId,
      prompt: args.prompt,
      size: args.size,
      references: args.references,
      ...(model.aspectRatios !== undefined
        ? { aspectRatios: model.aspectRatios }
        : {}),
      writesText: model.writesText,
      extraHeaders: model.attribution,
    }),
    wire,
  });
  const own = build(model.wire);
  const fallbackWire = model.fallbackWire;
  if (fallbackWire === undefined) return own;
  let fallback: PreparedImageRequest | undefined;
  return { ...own, fallback: () => (fallback ??= build(fallbackWire)) };
}

/** Why `model` would refuse a request with `count` reference images — more
 * than its catalog entry says it takes, or fewer than an edit model needs —
 * or `undefined` when it would not. Asked before anything is spent: the
 * provider refuses such a request outright (Gemini 2.5 Flash Image takes
 * three; Krea K3 Edit needs one). */
export function referenceImagesRefusal(
  model: Pick<
    ResolvedImageModel,
    'modelId' | 'minReferenceImages' | 'maxReferenceImages'
  >,
  count: number,
): string | undefined {
  const images = (n: number) =>
    `${n} reference ${n === 1 ? 'image' : 'images'}`;
  const max = model.maxReferenceImages;
  if (max !== undefined && count > max) {
    return `The image model ${model.modelId} takes at most ${images(max)} in one call; pass at most ${max} "inputImages".`;
  }
  const min = model.minReferenceImages;
  if (min !== undefined && count < min) {
    return `The image model ${model.modelId} edits pictures and needs at least ${images(min)} in every call: pass the picture to start from in "inputImages". It cannot draw from a description alone; if there is no picture to start from, tell the user an administrator would choose another image model.`;
  }
  return undefined;
}

/** How a call names each wire when it says which one it asked. */
const WIRE_NAMES: Record<ImageGenerationWire, string> = {
  'openrouter-images': 'its Image API',
  'openai-images': 'its images API',
  'chat-images': 'chat completions',
};

/** A refusal that says the provider cannot serve that API for the model —
 * one the model's other wire may not get. A refusal of the prompt under the
 * provider's content policy is none, whatever its status. */
function refusedAsUnserved(error: unknown): error is ImageProviderError {
  return (
    error instanceof ImageProviderError &&
    error.refusedStatus !== undefined &&
    GATEWAY_REFUSAL_STATUSES.has(error.refusedStatus) &&
    !(
      error.refusedCode !== undefined &&
      CONTENT_REFUSAL_CODES.has(error.refusedCode)
    )
  );
}

/**
 * Send one prepared request: ONE image. A model with a fallback wire is
 * asked on it when its first wire refuses the request as one it cannot
 * serve; the wire that served is the first the next call asks (see the
 * module doc). When both fail, the error says what each answered.
 */
export async function generateOneImage(
  model: ResolvedImageModel,
  request: PreparedImageRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ImageCallResult> {
  const fallback = request.fallback;
  if (fallback === undefined) return sendImageRequest(model, request, options);
  const key = servedWireKey(model);
  const fallbackFirst = servedOnFallback.get(key) === model.fallbackWire;
  const first = fallbackFirst ? fallback() : request;
  try {
    return await sendImageRequest(model, first, options);
  } catch (error) {
    if (!refusedAsUnserved(error)) throw error;
    const second = fallbackFirst ? request : fallback();
    console.warn(
      `[image-generation] ${model.providerSlug}/${model.modelId}: ${error.message}; asking ${WIRE_NAMES[second.wire]}`,
    );
    let result: ImageCallResult;
    try {
      result = await sendImageRequest(model, second, options);
    } catch (secondError) {
      if (!(secondError instanceof ImageProviderError)) throw secondError;
      throw new ImageProviderError(
        `${error.message.replace(/\.+$/, '')}. Asked over ${WIRE_NAMES[second.wire]} instead: ${secondError.message}`,
        {
          cause: secondError,
          ...(secondError.charge !== undefined
            ? { charge: secondError.charge }
            : {}),
          ...(secondError.refusedStatus !== undefined
            ? { refusedStatus: secondError.refusedStatus }
            : {}),
          ...(secondError.refusedCode !== undefined
            ? { refusedCode: secondError.refusedCode }
            : {}),
        },
      );
    }
    if (second === request) servedOnFallback.delete(key);
    else servedOnFallback.set(key, second.wire);
    return result;
  }
}

/** Send one request on its own wire, and read its reply. */
async function sendImageRequest(
  model: ResolvedImageModel,
  request: PreparedImageRequest,
  options: { signal?: AbortSignal },
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
    const code = providerErrorCode(payload);
    throw new ImageProviderError(
      `${model.providerDisplayName} refused the image request (${response.status})${said !== undefined ? `: ${redacted(model, said)}` : ''}`,
      {
        refusedStatus: response.status,
        ...(code !== undefined ? { refusedCode: code } : {}),
      },
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
    reply = parseImageReply(request.wire, payload);
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
