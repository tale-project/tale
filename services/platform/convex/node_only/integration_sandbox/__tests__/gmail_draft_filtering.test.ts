import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { executeIntegrationImpl } from '../execute_integration_impl';

const connectorCode = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../../../examples/integrations/gmail/connector.js',
  ),
  'utf-8',
);

function mockFetchSequence(responses: Array<() => Response>) {
  let callIndex = 0;
  return Object.assign(
    vi.fn().mockImplementation(() => {
      const factory = responses[callIndex];
      if (!factory) throw new Error('Unexpected fetch call #' + callIndex);
      callIndex++;
      return Promise.resolve(factory());
    }),
    { preconnect: vi.fn() },
  );
}

function jsonResponse(data: unknown, status = 200) {
  return () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('Gmail connector draft filtering', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('listMessages', () => {
    it('should add -is:draft to the query parameter', async () => {
      const fetchCalls: string[] = [];
      globalThis.fetch = Object.assign(
        vi.fn().mockImplementation((url: string) => {
          fetchCalls.push(url);
          return Promise.resolve(
            jsonResponse({ messages: [], resultSizeEstimate: 0 })(),
          );
        }),
        { preconnect: vi.fn() },
      );

      await executeIntegrationImpl({
        code: connectorCode,
        operation: 'list_messages',
        params: {},
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['gmail.googleapis.com'],
        timeoutMs: 5000,
      });

      const listUrl = fetchCalls.find((u) => u.includes('/messages?'));
      expect(listUrl).toBeDefined();
      expect(listUrl).toContain(encodeURIComponent('-is:draft'));
    });

    it('should append -is:draft to existing query', async () => {
      const fetchCalls: string[] = [];
      globalThis.fetch = Object.assign(
        vi.fn().mockImplementation((url: string) => {
          fetchCalls.push(url);
          return Promise.resolve(
            jsonResponse({ messages: [], resultSizeEstimate: 0 })(),
          );
        }),
        { preconnect: vi.fn() },
      );

      await executeIntegrationImpl({
        code: connectorCode,
        operation: 'list_messages',
        params: { q: 'from:user@example.com' },
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['gmail.googleapis.com'],
        timeoutMs: 5000,
      });

      const listUrl = fetchCalls.find((u) => u.includes('/messages?'));
      expect(listUrl).toBeDefined();
      const qParam = decodeURIComponent(
        listUrl?.split('q=')[1]?.split('&')[0] ?? '',
      );
      expect(qParam).toContain('from:user@example.com');
      expect(qParam).toContain('-is:draft');
    });
  });

  describe('getThread', () => {
    it('should exclude messages with DRAFT label when format is email', async () => {
      const profileResponse = jsonResponse({
        emailAddress: 'me@example.com',
      });
      const threadResponse = jsonResponse({
        id: 'thread-1',
        messages: [
          {
            id: 'msg-1',
            threadId: 'thread-1',
            labelIds: ['INBOX'],
            payload: {
              headers: [
                { name: 'From', value: 'customer@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Hello' },
                { name: 'Date', value: '2024-01-01T00:00:00Z' },
              ],
            },
          },
          {
            id: 'msg-2',
            threadId: 'thread-1',
            labelIds: ['DRAFT'],
            payload: {
              headers: [
                { name: 'From', value: 'me@example.com' },
                { name: 'To', value: 'customer@example.com' },
                { name: 'Subject', value: 'Re: Hello' },
                { name: 'Date', value: '2024-01-01T01:00:00Z' },
              ],
            },
          },
          {
            id: 'msg-3',
            threadId: 'thread-1',
            labelIds: ['INBOX', 'UNREAD'],
            payload: {
              headers: [
                { name: 'From', value: 'customer@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Re: Hello' },
                { name: 'Date', value: '2024-01-01T02:00:00Z' },
              ],
            },
          },
        ],
      });

      globalThis.fetch = mockFetchSequence([
        // First pass: thread fetch
        threadResponse,
        // Second pass: thread fetch (cached), then profile fetch
        threadResponse,
        profileResponse,
      ]);

      const result = await executeIntegrationImpl({
        code: connectorCode,
        operation: 'get_thread',
        params: { threadId: 'thread-1', format: 'email' },
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['gmail.googleapis.com'],
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      const data = result.result as {
        data: Array<{ messageId: string }>;
        count: number;
      };
      expect(data.count).toBe(2);
      expect(data.data).toHaveLength(2);
      expect(data.data.map((m) => m.messageId)).toEqual(['msg-1', 'msg-3']);
    });

    it('should return all messages when none are drafts', async () => {
      const profileResponse = jsonResponse({
        emailAddress: 'me@example.com',
      });
      const threadResponse = jsonResponse({
        id: 'thread-1',
        messages: [
          {
            id: 'msg-1',
            threadId: 'thread-1',
            labelIds: ['INBOX'],
            payload: {
              headers: [
                { name: 'From', value: 'customer@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Hello' },
                { name: 'Date', value: '2024-01-01T00:00:00Z' },
              ],
            },
          },
          {
            id: 'msg-2',
            threadId: 'thread-1',
            labelIds: ['SENT'],
            payload: {
              headers: [
                { name: 'From', value: 'me@example.com' },
                { name: 'To', value: 'customer@example.com' },
                { name: 'Subject', value: 'Re: Hello' },
                { name: 'Date', value: '2024-01-01T01:00:00Z' },
              ],
            },
          },
        ],
      });

      globalThis.fetch = mockFetchSequence([
        threadResponse,
        threadResponse,
        profileResponse,
      ]);

      const result = await executeIntegrationImpl({
        code: connectorCode,
        operation: 'get_thread',
        params: { threadId: 'thread-1', format: 'email' },
        variables: {},
        secrets: { accessToken: 'test-token' },
        allowedHosts: ['gmail.googleapis.com'],
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      const data = result.result as {
        data: Array<{ messageId: string }>;
        count: number;
      };
      expect(data.count).toBe(2);
      expect(data.data).toHaveLength(2);
    });
  });
});
