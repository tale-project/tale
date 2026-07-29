// Discard a failed outbound message — drives the REAL `mutationWithRLS`
// wrapper through convex-test. Fake timers unused here (no scheduler work on
// discard); kept for consistency with neighbouring conversation tests.

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';

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

const ORG = 'org_conv_discard';
const OTHER_ORG = 'org_conv_discard_other';
const EDITOR = 'user_discard_editor';
const OUTSIDER = 'user_discard_outsider';
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

async function seedConversation(t: T): Promise<Id<'conversations'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId: ORG,
      status: 'open',
      connectorName: 'imap_smtp',
      subject: 'Need help',
      lastMessageAt: 2_000,
    }),
  );
}

async function seedFailedMessage(
  t: T,
  conversationId: Id<'conversations'>,
  overrides: Partial<Doc<'conversationMessages'>> = {},
): Promise<Id<'conversationMessages'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversationMessages', {
      organizationId: ORG,
      conversationId,
      channel: 'email',
      direction: 'outbound',
      deliveryState: 'failed',
      connectorName: 'imap_smtp',
      content: '<p>Happy to help</p>',
      sentAt: 2_000,
      deliveredAt: 2_000,
      metadata: {
        to: ['jane@acme.test'],
        subject: 'Re: Need help',
        error: 'SMTP send failed',
      },
      ...overrides,
    }),
  );
}

describe('discardOutboundMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes a failed outbound row and walks lastMessageAt back', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t);
    await t.run((ctx) =>
      ctx.db.insert('conversationMessages', {
        organizationId: ORG,
        conversationId,
        channel: 'email',
        direction: 'inbound',
        deliveryState: 'delivered',
        content: 'Original',
        sentAt: 1_000,
        deliveredAt: 1_000,
      }),
    );
    const messageId = await seedFailedMessage(t, conversationId);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.discardOutboundMessage, {
        messageId,
      });

    expect(await t.run((ctx) => ctx.db.get(messageId))).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.get(conversationId)))?.lastMessageAt,
    ).toBe(1_000);
  });

  it('rejects a message that is not failed', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId, {
      deliveryState: 'sent',
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.discardOutboundMessage, {
        messageId,
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('discard_not_available');
    expect(await t.run((ctx) => ctx.db.get(messageId))).not.toBeNull();
  });

  it('denies a member of another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, OUTSIDER, OTHER_ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.discardOutboundMessage, {
          messageId,
        }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(messageId))).not.toBeNull();
  });
});
