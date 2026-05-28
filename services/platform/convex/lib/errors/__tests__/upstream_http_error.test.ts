import { describe, expect, it } from 'vitest';

import {
  isRetryableStatus,
  isUpstreamHttpError,
  UpstreamHttpError,
} from '../upstream_http_error';

function makeResponse(status: number): Response {
  // Minimal Response stand-in — UpstreamHttpError.fromResponse only reads `.status`.
  return new Response(null, { status });
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
    // Engineer-facing message still embeds the (now-scrubbed) snippet for triage.
    expect(err.message).toMatch(/REDACTED/);
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
});
