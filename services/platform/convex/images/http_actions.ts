import { httpAction } from '../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;

  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }

  if (hostname === '::1' || hostname === '[::1]') return true;
  if (hostname.toLowerCase().startsWith('fe80:')) return true;

  return false;
}

export const imageProxyHandler = httpAction(async (ctx, req) => {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  try {
    await checkIpRateLimit(ctx, 'security:image-proxy', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(error.retryAfter / 1000)),
        },
      });
    }
    throw error;
  }

  const requestUrl = new URL(req.url);
  const encodedUrl = requestUrl.searchParams.get('url');

  if (!encodedUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(atob(decodeURIComponent(encodedUrl)));
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response('Unsupported protocol', { status: 400 });
  }

  if (isPrivateIp(targetUrl.hostname)) {
    return new Response('Private addresses not allowed', { status: 400 });
  }

  const MAX_REDIRECTS = 5;
  let currentUrl = targetUrl.toString();
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(10_000),
    });

    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const status = upstreamResponse.status;
      if (status < 300 || status >= 400) break;

      const location = upstreamResponse.headers.get('Location');
      if (!location) break;

      const redirectUrl = new URL(location, currentUrl);

      if (
        redirectUrl.protocol !== 'http:' &&
        redirectUrl.protocol !== 'https:'
      ) {
        return new Response('Redirect to unsupported protocol', {
          status: 400,
        });
      }

      if (isPrivateIp(redirectUrl.hostname)) {
        return new Response('Redirect to private address not allowed', {
          status: 400,
        });
      }

      currentUrl = redirectUrl.toString();
      upstreamResponse = await fetch(currentUrl, {
        redirect: 'manual',
        headers: { Accept: 'image/*,*/*;q=0.8' },
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch (error) {
    console.error('[image-proxy] fetch failed:', error);
    return new Response('Failed to fetch image', { status: 502 });
  }

  if (!upstreamResponse.ok) {
    return new Response('Upstream returned an error', {
      status: upstreamResponse.status,
    });
  }

  const contentType = upstreamResponse.headers.get('Content-Type') ?? '';
  const isImage =
    contentType.startsWith('image/') ||
    contentType === 'binary/octet-stream' ||
    contentType === 'application/octet-stream';
  if (!isImage) {
    return new Response('Response is not an image', { status: 415 });
  }

  const contentLength = upstreamResponse.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    return new Response('Image too large', { status: 413 });
  }

  const buffer = await upstreamResponse.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    return new Response('Image too large', { status: 413 });
  }

  // If upstream returned a generic octet-stream, infer type from URL extension
  let resolvedContentType = contentType;
  if (!contentType.startsWith('image/')) {
    const ext = targetUrl.pathname.split('.').pop()?.toLowerCase();
    const extMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
      avif: 'image/avif',
    };
    resolvedContentType = (ext && extMap[ext]) || 'application/octet-stream';
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': resolvedContentType,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
});
