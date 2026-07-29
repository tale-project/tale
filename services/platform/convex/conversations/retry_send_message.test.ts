// Retry of a failed outbound send — drives the REAL `mutationWithRLS` wrapper
// through convex-test. Fake timers keep the rescheduled send action (a
// 'use node' connector call) from executing: the assertion boundary is the
// row flipping failed → queued and the scheduled job's rebuilt args.

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';

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

const ORG = 'org_conv_retry';
const OTHER_ORG = 'org_conv_retry_other';
const EDITOR = 'user_retry_editor';
const OUTSIDER = 'user_retry_outsider';
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
      sentAt: 1_000,
      deliveredAt: 1_000,
      metadata: {
        sender: 'connector',
        isCustomer: false,
        to: ['jane@acme.test'],
        cc: ['boss@acme.test'],
        subject: 'Re: Need help',
        connectorName: 'imap_smtp',
        sendContentType: 'HTML',
        inReplyTo: '<root@acme.test>',
        error: 'SMTP send failed: connect ETIMEDOUT 1.2.3.4:465',
        scheduledSendId: 'stale_job_id',
        scheduledSendAt: 900,
      },
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

describe('retrySendMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flips failed → queued, bumps retryCount, clears the error and reschedules the send with the original args', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.retrySendMessage, { messageId });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.deliveryState).toBe('queued');
    expect(message?.retryCount).toBe(1);
    expect(message?.metadata).not.toHaveProperty('error');
    // Stale undo stamps must not resurface a countdown on the retried row.
    expect(message?.metadata).not.toHaveProperty('scheduledSendId');
    expect(message?.metadata).not.toHaveProperty('scheduledSendAt');

    const jobs = await scheduledSendJobs(t);
    expect(jobs).toHaveLength(1);
    // A retry sends immediately — the user just asked for it; no undo window.
    expect(jobs[0].scheduledTime).toBe(2_000_000);
    expect(jobs[0].args[0]).toMatchObject({
      messageId,
      organizationId: ORG,
      connectorName: 'imap_smtp',
      to: ['jane@acme.test'],
      cc: ['boss@acme.test'],
      subject: 'Re: Need help',
      body: '<p>Happy to help</p>',
      contentType: 'HTML',
      inReplyTo: '<root@acme.test>',
    });
  });

  it('rejects a message that is not in the failed state', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId, {
      deliveryState: 'sent',
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.retrySendMessage, { messageId })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('retry_not_available');
    expect(await scheduledSendJobs(t)).toHaveLength(0);
  });

  it('rejects a failed row whose original send parameters are missing', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId, {
      metadata: { error: 'boom' },
      connectorName: undefined,
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.retrySendMessage, { messageId })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('retry_not_available');
    expect(await scheduledSendJobs(t)).toHaveLength(0);
  });

  it('denies a member of another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, OUTSIDER, OTHER_ORG);
    const conversationId = await seedConversation(t);
    const messageId = await seedFailedMessage(t, conversationId);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.retrySendMessage, { messageId }),
    ).rejects.toThrow();

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.deliveryState).toBe('failed');
  });
});
