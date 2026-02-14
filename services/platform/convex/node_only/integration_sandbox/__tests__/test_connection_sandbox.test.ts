import { describe, it, expect } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

describe('executeIntegrationImpl __test_connection__', () => {
  it('should call testConnection and return success', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        testConnection: function(ctx) {
          return { status: 'ok', name: 'test-store' };
        },
        execute: function(ctx) {
          return { data: [] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 'ok', name: 'test-store' });
  });

  it('should return error when testConnection is not defined', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        execute: function(ctx) {
          return { data: [] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('testConnection');
  });

  it('should return error when testConnection throws', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        testConnection: function(ctx) {
          throw new Error('Authentication failed: invalid token');
        },
        execute: function(ctx) {
          return { data: [] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed: invalid token');
  });

  it('should pass secrets to testConnection context', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        testConnection: function(ctx) {
          var token = ctx.secrets.get('accessToken');
          var domain = ctx.secrets.get('domain');
          if (!token) throw new Error('Missing token');
          if (!domain) throw new Error('Missing domain');
          return { status: 'ok', domain: domain };
        },
        execute: function(ctx) {
          return { data: [] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {
        accessToken: 'shpat_test123',
        domain: 'mystore.myshopify.com',
      },
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      status: 'ok',
      domain: 'mystore.myshopify.com',
    });
  });

  it('should provide base64 helpers to testConnection context', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        testConnection: function(ctx) {
          var encoded = ctx.base64Encode('hello:world');
          return { status: 'ok', encoded: encoded };
        },
        execute: function(ctx) {
          return { data: [] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    const resultObj = result.result as Record<string, unknown>;
    expect(resultObj.status).toBe('ok');
    expect(resultObj.encoded).toBe(
      Buffer.from('hello:world').toString('base64'),
    );
  });

  it('should not interfere with regular execute operations', async () => {
    const code = `
      const connector = {
        operations: ['list_items'],
        testConnection: function(ctx) {
          return { status: 'ok' };
        },
        execute: function(ctx) {
          return { data: [1, 2, 3], operation: ctx.operation };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'list_items',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ data: [1, 2, 3], operation: 'list_items' });
  });

  it('should return error when no connector object is defined', async () => {
    const code = `
      function list_items(params) {
        return { data: [] };
      }
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    // No connector object found → falls through to function pattern → operation not found
    expect(result.success).toBe(false);
    expect(result.error).toContain('__test_connection__');
  });
});
