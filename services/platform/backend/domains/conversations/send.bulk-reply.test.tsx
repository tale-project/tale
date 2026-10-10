// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { Sql } from 'postgres';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useBulkActions } from '@/app/features/conversations/hooks/use-bulk-actions';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { replyToConversation } from '@/backend/domains/conversations/send';

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

const {
  runConnectorAction,
  createAuditLog,
  addJobInTx,
  emitHintInTx,
  queueApiReply,
  assertOwnedAttachments,
} = vi.hoisted(() => ({
  runConnectorAction: vi.fn(),
  createAuditLog: vi.fn(async () => undefined),
  addJobInTx: vi.fn(async () => 'job-1'),
  emitHintInTx: vi.fn(async () => undefined),
  queueApiReply: vi.fn(async () => 'm-api'),
  assertOwnedAttachments: vi.fn(async () => undefined),
}));

vi.mock('@/backend/domains/connectors/service.ts', () => ({
  runConnectorAction,
}));
vi.mock('@/backend/domains/audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('@/backend/domains/files/service.ts', () => ({ getFileUrl: vi.fn() }));
vi.mock('@/backend/realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('@/backend/domains/events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('@/backend/jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('@/backend/domains/conversations/attachment-ownership.ts', () => ({
  assertOwnedAttachments,
}));
vi.mock(
  '@/backend/domains/conversations/api-sync.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/backend/domains/conversations/api-sync.ts')
    >()),
    queueApiReply,
  }),
);

type Statement = { text: string; values: unknown[]; begin: number | null };
type Begin = { status: 'open' | 'committed' | 'rolled_back' };

/**
 * A `sql` double that records statements and answers by statement shape:
 * `answer` maps a text fragment to the rows that statement returns (or the
 * error it rejects with); the first matching fragment wins, and anything
 * unmatched answers no rows. `begin` runs the callback on the same tag and
 * records whether the transaction committed or rolled back.
 */
function fakeSql(answer: Record<string, unknown[] | Error>) {
  const statements: Statement[] = [];
  const begins: Begin[] = [];
  let current: number | null = null;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values, begin: current });
    const hit = Object.entries(answer).find(([needle]) =>
      text.includes(needle),
    );
    if (hit?.[1] instanceof Error) return Promise.reject(hit[1]);
    return Promise.resolve(hit ? hit[1] : []);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: async (cb: (tx: unknown) => unknown) => {
      const index = begins.push({ status: 'open' }) - 1;
      current = index;
      try {
        const result = await cb(sql);
        begins[index] = { status: 'committed' };
        return result;
      } catch (error) {
        begins[index] = { status: 'rolled_back' };
        throw error;
      } finally {
        current = null;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements, begins };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('preserves bulk API plaintext through the reply door while queueing escaped email HTML', async () => {
  const body = 'A&B.\nSecond line <price> <script>alert("x")</script>';
  const html =
    '<p>A&amp;B.<br>Second line &lt;price&gt; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>';
  const { sql: apiSql } = fakeSql({
    'FROM app.conversations c': [{ organizationId: 'org-1', channel: 'api' }],
  });
  const { sql: emailSql, statements } = fakeSql({
    'FROM app.conversations c': [
      {
        organizationId: 'org-1',
        channel: 'email',
        connectorName: 'imap-smtp',
        subject: 'Order 42',
        contactEmail: 'carla@example.com',
      },
    ],
    'FROM app.conversations WHERE': [
      { id: 'email', organizationId: 'org-1', metadata: null },
    ],
    'INSERT INTO app.conversation_messages': [{ id: 'm-email' }],
  });
  const requests: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const id = /\/conversations\/([^/?]+)\/reply/.exec(url)?.[1];
    if (!id) throw new Error('Unexpected request');
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const payload = JSON.parse(init.body) as {
      content: string;
      sourceMarkdown?: string;
    };
    requests.push(payload);
    const messageId = await replyToConversation(
      id === 'api' ? apiSql : emailSql,
      {
        ...payload,
        conversationId: id,
        organizationId: 'org-1',
        actor: { userId: 'u1' },
      },
    );
    return Response.json({ messageId });
  });
  const client = new QueryClient();
  const { result } = renderHook(
    () =>
      useBulkActions({
        organizationId: 'org-1',
        conversations: ['api', 'email'].map(
          (id) =>
            ({
              id,
              _id: id,
              channel: id,
              contact: { id: 'contact', email: 'carla@example.com' },
            }) as unknown as ConversationItem,
        ),
        selectionState: { type: 'all' },
        onComplete: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await act(async () => {
    await result.current.handleSendMessages(body);
  });
  expect(queueApiReply).toHaveBeenCalledWith(
    apiSql,
    expect.objectContaining({ body }),
  );
  expect(requests).toEqual([
    { content: html, sourceMarkdown: body },
    { content: html, sourceMarkdown: body },
  ]);
  expect(addJobInTx).toHaveBeenCalledWith(
    expect.anything(),
    'conversation.send_message',
    expect.objectContaining({ body: html, contentType: 'HTML' }),
    expect.anything(),
  );
  expect(
    statements.find((st) =>
      st.text.includes('INSERT INTO app.conversation_messages'),
    )?.values[4],
  ).toBe(html);
  expect(runConnectorAction).not.toHaveBeenCalled();
  client.clear();
});

it('queues a bulk reply to a mirrored conversation without an email address, and sends nothing to an email one without [#3912]', async () => {
  const body = 'Use <price> & A&B\nThanks';
  const { sql: apiSql } = fakeSql({
    'FROM app.conversations c': [
      { organizationId: 'org-1', channel: 'api', contactEmail: null },
    ],
  });
  const replied: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const id = /\/conversations\/([^/?]+)\/reply/.exec(url)?.[1];
    if (!id) throw new Error('Unexpected request');
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const payload = JSON.parse(init.body) as {
      content: string;
      sourceMarkdown?: string;
    };
    replied.push(id);
    const messageId = await replyToConversation(apiSql, {
      ...payload,
      conversationId: id,
      organizationId: 'org-1',
      actor: { userId: 'u1' },
    });
    return Response.json({ messageId });
  });
  const onComplete = vi.fn();
  const client = new QueryClient();
  const { result } = renderHook(
    () =>
      useBulkActions({
        organizationId: 'org-1',
        // As the Inbox projects them: a mirrored contact without an address
        // reads blank, an email one reads the stand-in.
        conversations: [
          { id: 'api', _id: 'api', channel: 'api', contact: { email: '' } },
          {
            id: 'mail',
            _id: 'mail',
            channel: 'email',
            contact: { email: 'unknown@example.com' },
          },
        ] as unknown as ConversationItem[],
        selectionState: { type: 'all' },
        onComplete,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );

  await act(async () => {
    await result.current.handleSendMessages(body);
  });

  expect(replied).toEqual(['api']);
  expect(queueApiReply).toHaveBeenCalledWith(
    apiSql,
    expect.objectContaining({ conversationId: 'api', body }),
  );
  expect(addJobInTx).not.toHaveBeenCalled();
  expect(runConnectorAction).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledWith(['mail']);
  client.clear();
});
