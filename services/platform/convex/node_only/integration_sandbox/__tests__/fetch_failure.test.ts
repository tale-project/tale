import { describe, it, expect, vi, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

describe('fetch-level failures surface the underlying cause', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const connectorCode = `
    var connector = {
      operations: ['search'],
      testConnection: function(ctx) { return { status: 'ok' }; },
      execute: function(ctx) {
        var response = ctx.http.post('https://api.tavily.com/search', {
          body: JSON.stringify({ query: 'hi' })
        });
        return { status: response.status };
      }
    };
  `;

  it('includes .cause message and code in the returned error (DNS failure)', async () => {
    const dnsError = Object.assign(
      new Error('getaddrinfo ENOTFOUND api.tavily.com'),
      {
        code: 'ENOTFOUND',
      },
    );
    const fetchErr = new TypeError('fetch failed');
    (fetchErr as { cause?: unknown }).cause = dnsError;

    globalThis.fetch = Object.assign(vi.fn().mockRejectedValue(fetchErr), {
      preconnect: vi.fn(),
    });

    const result = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'search',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['tavily.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('fetch failed');
    expect(result.error).toContain('ENOTFOUND');
    expect(result.error).toContain('api.tavily.com');
    expect(result.error).toContain('url=https://api.tavily.com/search');
  });

  it('handles fetch rejections with no cause by including the URL', async () => {
    const fetchErr = new TypeError('fetch failed');

    globalThis.fetch = Object.assign(vi.fn().mockRejectedValue(fetchErr), {
      preconnect: vi.fn(),
    });

    const result = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'search',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['tavily.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('fetch failed');
    expect(result.error).toContain('url=https://api.tavily.com/search');
  });
});
