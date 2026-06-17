import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  isRetryableStatus,
  isUpstreamHttpError,
  parseRetryAfterMs,
  UpstreamHttpError,
} from './upstream_http_error';

function makeResponse(
  status: number,
  init: { headers?: Record<string, string>; url?: string } = {},
): Response {
  // UpstreamHttpError.fromResponse reads .status, .headers, and (when
  // endpoint is omitted) .url. Response's `url` is read-only on
  // construction, so simulate it via a thin proxy that lets us override.
  const res = new Response(null, {
    status,
    headers: init.headers,
  });
  if (init.url !== undefined) {
    Object.defineProperty(res, 'url', {
      value: init.url,
      configurable: true,
    });
  }
  return res;
}

describe('UpstreamHttpError', () => {
  it('scrubs Bearer tokens and sk- API keys from body snippet', () => {
    const body =
      'Upstream complained: Authorization: Bearer sk-abcdefgh1234567890ABCDEF';
    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(500),
      body,
      '/api/v1/search',
    );
    expect(err.bodySnippet).not.toMatch(/sk-abcdefgh/);
    expect(err.bodySnippet).not.toMatch(/Bearer\s+sk-/);
    expect(err.bodySnippet).toMatch(/REDACTED/);
    // `.message` carries safeMessage only — snippet stays out so it
    // does not cross the Convex client boundary as a default toast.
    expect(err.message).not.toMatch(/REDACTED/);
    expect(err.message).toBe(err.safeMessage);
    // Safe message is clean of any body content.
    expect(err.safeMessage).not.toMatch(/REDACTED/);
    expect(err.safeMessage).toMatch(/RAG/);
  });

  it('truncates very long bodies to ~400 chars', () => {
    const body = 'X'.repeat(2000);
    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(500),
      body,
      '/api/v1/search',
    );
    expect(err.bodySnippet.length).toBeLessThanOrEqual(401); // 400 + ellipsis
  });

  it('marks 5xx / 408 / 429 as retryable; 4xx (other) as not', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);

    const fiveHundred = UpstreamHttpError.fromResponse(
      'crawler',
      makeResponse(500),
      'down',
      '/api/v1/web/fetch-and-extract',
    );
    expect(fiveHundred.retryable).toBe(true);

    const fourHundred = UpstreamHttpError.fromResponse(
      'crawler',
      makeResponse(400),
      'bad request',
      '/api/v1/urls/discover',
    );
    expect(fourHundred.retryable).toBe(false);
  });

  it('safe message includes service, endpoint, and status', () => {
    const err = UpstreamHttpError.fromResponse(
      'crawler',
      makeResponse(503),
      '',
      '/api/v1/web/fetch-and-extract',
    );
    expect(err.safeMessage).toContain('CRAWLER');
    expect(err.safeMessage).toContain('/api/v1/web/fetch-and-extract');
    expect(err.safeMessage).toContain('503');
  });

  it('isUpstreamHttpError narrows correctly', () => {
    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(500),
      '',
      '/x',
    );
    expect(isUpstreamHttpError(err)).toBe(true);
    expect(isUpstreamHttpError(new Error('other'))).toBe(false);
    expect(isUpstreamHttpError(null)).toBe(false);
    expect(isUpstreamHttpError('string')).toBe(false);
  });

  it('produces distinct safeMessage branches for 401 / 403 / 404 / 429', () => {
    const e401 = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(401),
      '',
      '/api/v1/search',
    );
    expect(e401.safeMessage).toMatch(/authentication failed/i);
    expect(e401.safeMessage).toMatch(/401/);

    const e403 = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(403),
      '',
      '/api/v1/search',
    );
    expect(e403.safeMessage).toMatch(/authentication failed/i);
    expect(e403.safeMessage).toMatch(/403/);

    const e404 = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(404),
      '',
      '/api/v1/docs/123',
    );
    expect(e404.safeMessage).toMatch(/not found/i);
    expect(e404.safeMessage).toMatch(/404/);

    const e429 = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(429),
      '',
      '/api/v1/search',
    );
    expect(e429.safeMessage).toMatch(/throttling/i);
    expect(e429.safeMessage).toMatch(/429/);
  });

  it('parses Retry-After header into retryAfterMs', () => {
    expect(parseRetryAfterMs('30')).toBe(30000);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-number')).toBeUndefined();

    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(429, { headers: { 'retry-after': '30' } }),
      '',
      '/api/v1/search',
    );
    expect(err.retryAfterMs).toBe(30000);
  });

  it('caps Retry-After at 24h to defend against absurd upstream values', () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    // Scientific-notation finite value: 1e10 seconds ≈ 317 years.
    expect(parseRetryAfterMs('1e10')).toBe(ONE_DAY_MS);
    // Plain too-large seconds.
    expect(parseRetryAfterMs('999999999')).toBe(ONE_DAY_MS);
    // Far-future HTTP date.
    const farFuture = new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 365,
    ).toUTCString();
    expect(parseRetryAfterMs(farFuture)).toBe(ONE_DAY_MS);
    // Past HTTP date still clamps to 0 (unchanged).
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it('defaults endpoint to response.url when caller omits it', () => {
    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(500, { url: 'http://rag/api/v1/search' }),
      '',
    );
    expect(err.endpoint).toBe('http://rag/api/v1/search');
    expect(err.safeMessage).toContain('http://rag/api/v1/search');
  });

  it('toConvexError marshals structured fields for the client boundary', () => {
    const err = UpstreamHttpError.fromResponse(
      'rag',
      makeResponse(429, { headers: { 'retry-after': '5' } }),
      'rate limited',
      '/api/v1/search',
    );
    const cv = err.toConvexError();
    expect(cv).toBeInstanceOf(ConvexError);
    expect(cv.data.code).toBe('upstream_http');
    expect(cv.data.service).toBe('rag');
    expect(cv.data.status).toBe(429);
    expect(cv.data.retryable).toBe(true);
    expect(cv.data.retryAfterMs).toBe(5000);
    expect(cv.data.safeMessage).toMatch(/429/);
  });
});
