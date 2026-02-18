import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

describe('responseType base64 support in HTTP methods', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
      { preconnect: vi.fn() },
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return base64-encoded body for GET with responseType base64', async () => {
    const code = `
      var connector = {
        operations: ['download'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.get('https://api.example.com/file', {
            responseType: 'base64'
          });
          return { body: response.body, status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'download',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      body: Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]).toString('base64'),
      status: 200,
    });
  });

  it('should return base64-encoded body for POST with responseType base64', async () => {
    const code = `
      var connector = {
        operations: ['upload'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.post('https://api.example.com/upload', {
            body: JSON.stringify({ key: 'value' }),
            responseType: 'base64'
          });
          return { body: response.body, status: response.status };
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
    const data = result.result as { body: string; status: number };
    expect(data.status).toBe(200);
    expect(Buffer.from(data.body, 'base64')).toEqual(
      Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]),
    );
  });

  it('should return text body when responseType is not set', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response('plain text response', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        }),
      ),
      { preconnect: vi.fn() },
    );

    const code = `
      var connector = {
        operations: ['fetch'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.get('https://api.example.com/text');
          return { body: response.body, status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'fetch',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      body: 'plain text response',
      status: 200,
    });
  });
});

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
    const options = fetchCall[1] as RequestInit;
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
    const options = fetchCall[1] as RequestInit;
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
