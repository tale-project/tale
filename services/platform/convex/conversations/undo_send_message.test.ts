// Undo-send window — drives the REAL `mutationWithRLS` wrappers through
// convex-test. Fake timers keep the 10 s-delayed outbound send action from
// executing, so the assertion boundary is the queued row, its undo stamps,
// and the scheduled job's lifecycle (pending → canceled).

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';
import { UNDO_SEND_DELAY_MS } from './send_message_via_connector';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/conversations/), mirroring reply_to_conversation.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'conversations';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_conv_undo';
const OTHER_ORG = 'org_conv_undo_other';
const EDITOR = 'user_undo_editor';
const OUTSIDER = 'user_undo_outsider';
type T = TestConvex<typeof schema>;

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId,
      role: 'editor',
      createdAt: 0,
    });
  });
}

async function seedContact(t: T): Promise<Id<'contacts'>> {
  return t.run((ctx) =>
    ctx.db.insert('contacts', {
      organizationId: ORG,
      name: 'Jane Doe',
      email: 'jane@acme.test',
      source: 'api_import',
    }),
  );
}

async function seedConversation(
  t: T,
  overrides: Partial<Doc<'conversations'>> = {},
): Promise<Id<'conversations'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId: ORG,
      status: 'open',
      // Owned by the acting editor — assignment privacy is built into the
      // conversations RLS rules, so an unassigned thread is admin-triage only.
      assigneeUserId: EDITOR,
      ...overrides,
    }),
  );
}

async function scheduledSendJobs(t: T) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  return scheduled.filter((job) =>
    job.name.includes('sendMessageViaConnectorAction'),
  );
}

async function sendReply(
  t: T,
  conversationId: Id<'conversations'>,
  sourceMarkdown?: string,
): Promise<Id<'conversationMessages'>> {
  return t
    .withIdentity({ subject: EDITOR })
    .mutation(api.conversations.mutations.sendMessageViaConnector, {
      conversationId,
      organizationId: ORG,
      connectorName: 'outlook',
      content: '<p>Happy to help</p>',
      to: ['jane@acme.test'],
      subject: 'Re: Need help',
      html: '<p>Happy to help</p>',
      text: 'Happy to help',
      ...(sourceMarkdown ? { sourceMarkdown } : {}),
    });
}

describe('sendMessageViaConnector — undo window stamps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays the send action by the undo window and stamps scheduledSendId/At + sourceMarkdown', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });

    const messageId = await sendReply(t, conversationId, 'Happy to **help**');

    const jobs = await scheduledSendJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].scheduledTime).toBe(2_000_000 + UNDO_SEND_DELAY_MS);

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.deliveryState).toBe('queued');
    expect(message?.metadata).toMatchObject({
      scheduledSendId: String(jobs[0]._id),
      scheduledSendAt: 2_000_000 + UNDO_SEND_DELAY_MS,
      sourceMarkdown: 'Happy to **help**',
    });
  });
});

describe('undoSendMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the scheduled job, deletes the row, restores lastMessageAt and returns the draft markdown', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
      lastMessageAt: 1_000,
    });
    // A prior inbound message anchors where lastMessageAt must walk back to.
    await t.run((ctx) =>
      ctx.db.insert('conversationMessages', {
        organizationId: ORG,
        conversationId,
        channel: 'email',
        direction: 'inbound',
        deliveryState: 'delivered',
        content: 'Original question',
        sentAt: 1_000,
        deliveredAt: 1_000,
      }),
    );

    const messageId = await sendReply(t, conversationId, 'Happy to **help**');
    expect(
      (await t.run((ctx) => ctx.db.get(conversationId)))?.lastMessageAt,
    ).toBe(2_000_000);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.undoSendMessage, { messageId });

    expect(result).toEqual({ sourceMarkdown: 'Happy to **help**' });
    expect(await t.run((ctx) => ctx.db.get(messageId))).toBeNull();

    const jobs = await scheduledSendJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state.kind).toBe('canceled');

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.lastMessageAt).toBe(1_000);
  });

  it('falls back to the conversation creation time when no message remains', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });

    const messageId = await sendReply(t, conversationId);
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.undoSendMessage, { messageId });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.lastMessageAt).toBe(conversation?._creationTime);
  });

  it('rejects an undo once the send has fired (row no longer queued)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });

    const messageId = await sendReply(t, conversationId);
    await t.run((ctx) => ctx.db.patch(messageId, { deliveryState: 'sent' }));

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.undoSendMessage, { messageId })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('undo_window_closed');
    expect(await t.run((ctx) => ctx.db.get(messageId))).not.toBeNull();
  });

  it('rejects a queued row without a cancellable scheduled job (pre-feature rows)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, { contactId });
    const messageId = await t.run((ctx) =>
      ctx.db.insert('conversationMessages', {
        organizationId: ORG,
        conversationId,
        channel: 'email',
        direction: 'outbound',
        deliveryState: 'queued',
        content: '<p>Legacy</p>',
        sentAt: 1_500,
        deliveredAt: 1_500,
      }),
    );

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.undoSendMessage, { messageId })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('undo_not_available');
  });

  it('denies a member of another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    await seedMember(t, OUTSIDER, OTHER_ORG);
    const contactId = await seedContact(t);
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });
    const messageId = await sendReply(t, conversationId);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.undoSendMessage, { messageId }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(messageId))).not.toBeNull();
  });
});
