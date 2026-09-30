import { fileTypeFromBuffer } from 'file-type';
import PQueue from 'p-queue';

import {
  safeFetchBinary,
  SafeFetchError,
  type SafeFetchErrorKind,
} from '../../../lib/net/safe-fetch.ts';

/**
 * The image proxy behind every remote image an email body draws:
 * `EmailPreview` (`@tale/ui`) rewrites each `http(s)` image to
 * `/api/image-proxy?url=<base64>`. The backend fetches it instead of the
 * reader's browser, so the sender's server never learns the reader's address
 * or that the message was opened, and a plaintext image never mixes into
 * the https app.
 *
 * It fetches with no credential of any kind, through the SSRF-safe client:
 * every hop is resolved, checked and pinned, and nothing private or cloud
 * metadata is reachable, however the URL or its redirects are spelled. What
 * it hands back is only a raster image, judged by its bytes rather than by
 * the label the host put on them. SVG is refused: it can carry script, and
 * mail clients do not draw it inside a message either.
 */

export const IMAGE_PROXY_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_PROXY_TIMEOUT_MS = 10_000;

/** Fetches one process runs at once. Each can hold IMAGE_PROXY_MAX_BYTES in
 * memory, so this — not the per-person rate limit, whose burst is hundreds —
 * is what bounds the proxy's footprint (about 160 MB) under any burst. */
const IMAGE_PROXY_CONCURRENCY = 16;
const lane = new PQueue({ concurrency: IMAGE_PROXY_CONCURRENCY });

/** What a browser draws inline, as `file-type` names it from the bytes. */
const RASTER_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/apng',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
]);

export type ImageProxyErrorCode =
  | 'INVALID_IMAGE_URL'
  | 'IMAGE_HOST_REFUSED'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_FETCH_TIMEOUT'
  | 'IMAGE_FETCH_FAILED'
  | 'NOT_AN_IMAGE';

export class ImageProxyError extends Error {
  readonly code: ImageProxyErrorCode;
  readonly status: 400 | 403 | 413 | 415 | 502 | 504;

  constructor(
    code: ImageProxyErrorCode,
    status: ImageProxyError['status'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ImageProxyError';
    this.code = code;
    this.status = status;
  }
}

function invalidUrl(cause?: unknown): ImageProxyError {
  return new ImageProxyError(
    'INVALID_IMAGE_URL',
    400,
    'The url parameter must be a base64-encoded http(s) URL',
    { cause },
  );
}

/** The URL the `url` parameter names: base64 of an absolute http(s) URL. */
export function decodeImageProxyTarget(param: string | undefined): URL {
  if (param === undefined || param === '') throw invalidUrl();
  let target: URL;
  try {
    target = new URL(atob(param));
  } catch (error) {
    throw invalidUrl(error);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw invalidUrl();
  }
  return target;
}

/** A refused or failed fetch, as the proxy answers it. */
function refusalFor(error: SafeFetchError): ImageProxyError {
  const kind: SafeFetchErrorKind = error.kind;
  switch (kind) {
    case 'invalid_url':
    case 'unsupported_protocol':
      return invalidUrl(error);
    case 'private_ip':
    case 'host_not_allowed':
    case 'insecure_public_http':
      return new ImageProxyError(
        'IMAGE_HOST_REFUSED',
        403,
        'The image host is not one the proxy may reach',
        { cause: error },
      );
    case 'response_too_large':
      return new ImageProxyError(
        'IMAGE_TOO_LARGE',
        413,
        `The image is larger than ${IMAGE_PROXY_MAX_BYTES / 1024 / 1024} MB`,
        { cause: error },
      );
    case 'timeout':
      return new ImageProxyError(
        'IMAGE_FETCH_TIMEOUT',
        504,
        'The image host did not answer in time',
        { cause: error },
      );
    default:
      return new ImageProxyError(
        'IMAGE_FETCH_FAILED',
        502,
        'The image could not be fetched',
        { cause: error },
      );
  }
}

export interface ProxiedImage {
  bytes: Uint8Array<ArrayBuffer>;
  /** The type the bytes are, never the one the host claimed. */
  contentType: string;
}

/** Fetch one remote image and hand it back only if it is a raster image. */
export async function fetchProxiedImage(
  target: URL,
  fetchBinary: typeof safeFetchBinary = safeFetchBinary,
): Promise<ProxiedImage> {
  return await lane.add(() => fetchAndCheck(target, fetchBinary));
}

async function fetchAndCheck(
  target: URL,
  fetchBinary: typeof safeFetchBinary,
): Promise<ProxiedImage> {
  let response: Awaited<ReturnType<typeof safeFetchBinary>>;
  try {
    response = await fetchBinary(target.href, {
      credentialless: true,
      timeoutMs: IMAGE_PROXY_TIMEOUT_MS,
      maxResponseBytes: IMAGE_PROXY_MAX_BYTES,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; TaleImageProxy/1.0)',
      },
    });
  } catch (error) {
    if (error instanceof SafeFetchError) throw refusalFor(error);
    throw error;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ImageProxyError(
      'IMAGE_FETCH_FAILED',
      502,
      `The image host answered ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.body.arrayBuffer());
  const detected = await fileTypeFromBuffer(bytes).catch((error: unknown) => {
    console.warn('[image-proxy] type detection failed', error);
    return undefined;
  });
  if (detected === undefined || !RASTER_TYPES.has(detected.mime)) {
    throw new ImageProxyError(
      'NOT_AN_IMAGE',
      415,
      'The host did not answer with an image the proxy serves',
    );
  }
  return { bytes, contentType: detected.mime };
}
