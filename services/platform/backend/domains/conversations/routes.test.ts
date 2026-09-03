/**
 * The Inbox list/counts connector filter WIRE contract. The paginated list
 * adapter serializes `&connectorName=` while the counts adapter serializes
 * `?connector=`; the route must honour whichever key arrives so filtering the
 * Inbox to one mailbox no longer shows every connector's conversations.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  listConversationsPage,
  countConversationsByStatus,
  countUnreadConversations,
  projectConversationForView,
  loadMessageForViewer,
  undoSendMessage,
  retrySendMessage,
  discardOutboundMessage,
} = vi.hoisted(() => ({
  listConversationsPage: vi.fn(),
  countConversationsByStatus: vi.fn(),
  countUnreadConversations: vi.fn(),
  projectConversationForView: vi.fn(),
  loadMessageForViewer: vi.fn(),
  undoSendMessage: vi.fn(),
  retrySendMessage: vi.fn(),
  discardOutboundMessage: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    listConversationsPage,
    countConversationsByStatus,
    countUnreadConversations,
    projectConversationForView,
    loadMessageForViewer,
  };
});

vi.mock('./send.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./send.ts')>();
  return {
    ...actual,
    undoSendMessage,
    retrySendMessage,
    discardOutboundMessage,
  };
});

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { createConversationRoutes } from './routes.ts';
import { ConversationError } from './service.ts';

function makeApp() {
  return createConversationRoutes({
    sql: {} as never,
    auth: {} as never,
  });
}

describe('conversations route — connector filter wire contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listConversationsPage.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    countConversationsByStatus.mockResolvedValue({});
    countUnreadConversations.mockResolvedValue(0);
    projectConversationForView.mockResolvedValue({});
  });

  it('GET / filters on the client-sent connectorName key', async () => {
    const res = await makeApp().request('/?orgId=o1&connectorName=gmail');
    expect(res.status).toBe(200);
    expect(listConversationsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ connectorName: 'gmail' }),
    );
  });

  it('GET / still accepts the legacy connector key', async () => {
    const res = await makeApp().request('/?orgId=o1&connector=outlook');
    expect(res.status).toBe(200);
    expect(listConversationsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ connectorName: 'outlook' }),
    );
  });

  it('GET / passes no connector filter when neither key is present', async () => {
    await makeApp().request('/?orgId=o1');
    const options = listConversationsPage.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(options).not.toHaveProperty('connectorName');
  });

  it('GET /counts filters on connectorName too', async () => {
    await makeApp().request('/counts?orgId=o1&connectorName=imap-smtp');
    expect(countConversationsByStatus).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'imap-smtp',
    );
    expect(countUnreadConversations).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'imap-smtp',
    );
  });
});

/**
 * The message-level doors act on a message only inside a conversation the
 * viewer can open. Org scoping alone let a member holding a messageId cancel,
 * resend, or discard a colleague's outbound mail in a conversation the
 * assignment predicate hides from them; the guard the attachments door
 * already ran now fronts undo, retry and discard too.
 */
describe('conversations route — message doors share the visibility guard', () => {
  const doors = [
    ['undo', undoSendMessage],
    ['retry', retrySendMessage],
    ['discard', discardOutboundMessage],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    undoSendMessage.mockResolvedValue({ sourceMarkdown: null });
    retrySendMessage.mockResolvedValue(undefined);
    discardOutboundMessage.mockResolvedValue(undefined);
  });

  for (const [door, service] of doors) {
    it(`POST /messages/:id/${door} answers the opaque 404 for a hidden conversation and touches nothing`, async () => {
      loadMessageForViewer.mockRejectedValue(
        new ConversationError(
          'conversation_not_found',
          'Conversation not found',
          404,
        ),
      );
      const res = await makeApp().request(
        '/messages/m1/' + door + '?orgId=o1',
        {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        },
      );
      expect(res.status).toBe(404);
      expect(loadMessageForViewer).toHaveBeenCalledWith(
        expect.anything(),
        { organizationId: 'o1', userId: 'u1', role: 'admin' },
        'm1',
      );
      expect(service).not.toHaveBeenCalled();
    });

    it(`POST /messages/:id/${door} runs for a message the viewer can open`, async () => {
      loadMessageForViewer.mockResolvedValue({
        id: 'm1',
        conversationId: 'c1',
        connectorName: 'imap-smtp',
      });
      const res = await makeApp().request(
        '/messages/m1/' + door + '?orgId=o1',
        {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        },
      );
      expect(res.status).toBe(200);
      expect(service).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organizationId: 'o1', messageId: 'm1' }),
      );
    });
  }
});
