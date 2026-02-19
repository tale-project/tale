import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

const connectorCode = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../../../examples/integrations/outlook/connector.js',
  ),
  'utf-8',
);

function jsonResponse(data: unknown, status = 200) {
  return () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('Outlook connector draft filtering', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('listMessages', () => {
    it('should include isDraft eq false filter in the request URL', async () => {
      const fetchCalls: string[] = [];
      const meResponse = jsonResponse({
        mail: 'me@example.com',
        userPrincipalName: 'me@example.com',
      });
      const messagesResponse = jsonResponse({ value: [] });

      globalThis.fetch = Object.assign(
        vi.fn().mockImplementation((url: string) => {
          fetchCalls.push(url);
          if (url.includes('/me?') || url.endsWith('/me')) {
            return Promise.resolve(meResponse());
          }
          return Promise.resolve(messagesResponse());
        }),
        { preconnect: vi.fn() },
      );

      await executeIntegrationImpl({
        code: connectorCode,
        operation: 'list_messages',
        params: {},
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['graph.microsoft.com'],
        timeoutMs: 5000,
      });

      const listUrl = fetchCalls.find((u) => u.includes('/me/messages?'));
      expect(listUrl).toBeDefined();
      expect(listUrl).toContain('isDraft eq false');
    });

    it('should combine isDraft filter with existing filter', async () => {
      const fetchCalls: string[] = [];
      const meResponse = jsonResponse({
        mail: 'me@example.com',
      });
      const messagesResponse = jsonResponse({ value: [] });

      globalThis.fetch = Object.assign(
        vi.fn().mockImplementation((url: string) => {
          fetchCalls.push(url);
          if (url.includes('/me?') || url.endsWith('/me')) {
            return Promise.resolve(meResponse());
          }
          return Promise.resolve(messagesResponse());
        }),
        { preconnect: vi.fn() },
      );

      await executeIntegrationImpl({
        code: connectorCode,
        operation: 'list_messages',
        params: { filter: 'isRead eq false' },
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['graph.microsoft.com'],
        timeoutMs: 5000,
      });

      const listUrl = fetchCalls.find((u) => u.includes('/me/messages?'));
      expect(listUrl).toBeDefined();
      expect(listUrl).toContain('isRead eq false');
      expect(listUrl).toContain('isDraft eq false');
    });

    it('should combine isDraft filter with folder filter', async () => {
      const fetchCalls: string[] = [];
      const meResponse = jsonResponse({
        mail: 'me@example.com',
      });
      const messagesResponse = jsonResponse({ value: [] });

      globalThis.fetch = Object.assign(
        vi.fn().mockImplementation((url: string) => {
          fetchCalls.push(url);
          if (url.includes('/me?') || url.endsWith('/me')) {
            return Promise.resolve(meResponse());
          }
          return Promise.resolve(messagesResponse());
        }),
        { preconnect: vi.fn() },
      );

      await executeIntegrationImpl({
        code: connectorCode,
        operation: 'list_messages',
        params: { folder: 'inbox-id' },
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['graph.microsoft.com'],
        timeoutMs: 5000,
      });

      const listUrl = fetchCalls.find((u) => u.includes('/me/messages?'));
      expect(listUrl).toBeDefined();
      expect(listUrl).toContain('inbox-id');
      expect(listUrl).toContain('isDraft eq false');
    });
  });
});
