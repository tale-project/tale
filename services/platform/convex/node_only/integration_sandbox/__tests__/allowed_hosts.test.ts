import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { executeHttpRequest } from '../helpers/execute_http_request';

describe('executeHttpRequest allowedHosts enforcement', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // @ts-expect-error vi.fn() mock does not satisfy the full fetch type signature
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should block requests to hosts not in allowedHosts', async () => {
    await expect(
      executeHttpRequest(
        { url: 'https://evil.com/api/data', options: { method: 'GET' } },
        ['circuly.io'],
      ),
    ).rejects.toThrow('HTTP request to "evil.com" blocked');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should block requests to hosts not matching any allowedHost', async () => {
    await expect(
      executeHttpRequest(
        {
          url: 'https://malicious.example.com/steal',
          options: { method: 'GET' },
        },
        ['circuly.io', 'shopify.com'],
      ),
    ).rejects.toThrow('HTTP request to "malicious.example.com" blocked');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should include allowedHosts list in error message', async () => {
    await expect(
      executeHttpRequest(
        { url: 'https://evil.com/api', options: { method: 'GET' } },
        ['circuly.io', 'shopify.com'],
      ),
    ).rejects.toThrow('allowedHosts [circuly.io, shopify.com]');
  });

  it('should allow requests to exact matching hosts', async () => {
    await executeHttpRequest(
      {
        url: 'https://circuly.io/api/products',
        options: { method: 'GET' },
      },
      ['circuly.io'],
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('should allow requests to subdomains of allowedHosts', async () => {
    await executeHttpRequest(
      {
        url: 'https://api.circuly.io/api/products',
        options: { method: 'GET' },
      },
      ['circuly.io'],
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('should allow requests to deeply nested subdomains', async () => {
    await executeHttpRequest(
      {
        url: 'https://v2.api.myshopify.com/graphql',
        options: { method: 'POST' },
      },
      ['myshopify.com'],
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('should not enforce when allowedHosts is undefined', async () => {
    await executeHttpRequest(
      { url: 'https://anything.com/api', options: { method: 'GET' } },
      undefined,
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('should not enforce when allowedHosts is empty', async () => {
    await executeHttpRequest(
      { url: 'https://anything.com/api', options: { method: 'GET' } },
      [],
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('should prevent subdomain spoofing (e.g., evilcirculy.io)', async () => {
    await expect(
      executeHttpRequest(
        {
          url: 'https://evilcirculy.io/api/data',
          options: { method: 'GET' },
        },
        ['circuly.io'],
      ),
    ).rejects.toThrow('blocked');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
