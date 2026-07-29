// Server-side compose derivation — drives the REAL `mutationWithRLS` wrapper,
// the internal `createConversation` mutation and the real send helper through
// convex-test. Fake timers keep the scheduled outbound send action (a 'use
// node' connector call) from executing: the assertion boundary is the created
// conversation + queued message row + the scheduled job's args. Mirrors
// reply_to_conversation.test.ts.

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
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

const ORG = 'org_conv_compose';
const OTHER_ORG = 'org_conv_compose_other';
const EDITOR = 'user_compose_editor';
const OUTSIDER = 'user_compose_outsider';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role = 'editor',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedContact(
  t: T,
  organizationId: string,
  email: string | undefined,
): Promise<Id<'contacts'>> {
  return t.run((ctx) =>
    ctx.db.insert('contacts', {
      organizationId,
      name: 'Jane Doe',
      ...(email !== undefined ? { email } : {}),
      source: 'api_import',
    }),
  );
}

async function allConversations(t: T) {
  return t.run((ctx) => ctx.db.query('conversations').collect());
}

describe('composeEmailConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an outbound email conversation to the contact and delegates delivery to the send path', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId, messageId } = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: '<p>Hello there</p>',
      });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation).toMatchObject({
      organizationId: ORG,
      contactId,
      channel: 'email',
      direction: 'outbound',
      connectorName: 'outlook',
      subject: 'Project kickoff',
      status: 'open',
    });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message).toMatchObject({
      organizationId: ORG,
      conversationId,
      channel: 'email',
      direction: 'outbound',
      deliveryState: 'queued',
      content: '<p>Hello there</p>',
    });
    expect(message?.metadata).toMatchObject({
      to: ['jane@acme.test'],
      subject: 'Project kickoff',
      connectorName: 'outlook',
    });

    // Delivery delegated to the existing connector action. A fresh compose has
    // no inbound to derive a reply-from, so `from` is omitted entirely and the
    // send action falls back to the connector's configured From.
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const sendJobs = scheduled.filter((job) =>
      job.name.includes('sendMessageViaConnectorAction'),
    );
    expect(sendJobs).toHaveLength(1);
    expect(sendJobs[0].args[0]).toMatchObject({
      connectorName: 'outlook',
      to: ['jane@acme.test'],
      subject: 'Project kickoff',
      body: '<p>Hello there</p>',
      contentType: 'HTML',
    });
    expect(sendJobs[0].args[0]).not.toHaveProperty('from');

    const stored = await t.run((ctx) => ctx.db.get(conversationId));
    expect(typeof stored?.lastMessageAt).toBe('number');
  });

  it('default-assigns a non-admin composer as the conversation owner', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG); // editor = non-admin
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId } = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: '<p>Hi</p>',
      });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.assigneeUserId).toBe(EDITOR);
  });

  it('assigns an admin composer to themselves by default', async () => {
    const t = convexTest(schema, modules);
    const ADMIN = 'user_compose_admin';
    await seedMember(t, ADMIN, ORG, 'admin');
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId } = await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: '<p>Hi</p>',
      });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.assigneeUserId).toBe(ADMIN);
  });

  it('lets an admin assign the new conversation to a chosen member', async () => {
    const t = convexTest(schema, modules);
    const ADMIN = 'user_compose_admin';
    const OTHER = 'user_compose_other_member';
    await seedMember(t, ADMIN, ORG, 'admin');
    await seedMember(t, OTHER, ORG, 'editor');
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId } = await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: '<p>Hi</p>',
        assigneeUserId: OTHER,
      });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.assigneeUserId).toBe(OTHER);
  });

  it('clamps a non-admin composer to self even if another assignee is requested', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG); // editor = non-admin
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId } = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: '<p>Hi</p>',
        assigneeUserId: 'user_someone_else',
      });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.assigneeUserId).toBe(EDITOR);
  });

  it('sends from a chosen sender (dynamic-sender) and stamps it on the thread', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const { conversationId } = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'imap_smtp',
        subject: 'Project kickoff',
        content: '<p>Hello there</p>',
        from: 'sales@acme.test',
      });

    // Stamped on the conversation (our side of the thread) so replies reuse it.
    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conversation?.metadata).toMatchObject({
      to: [{ address: 'sales@acme.test' }],
    });

    // The send action receives it as `from` (its resolveReplyFrom then guards it
    // against the connector's verified domain).
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const sendJobs = scheduled.filter((job) =>
      job.name.includes('sendMessageViaConnectorAction'),
    );
    expect(sendJobs).toHaveLength(1);
    expect(sendJobs[0].args[0]).toMatchObject({
      to: ['jane@acme.test'],
      from: 'sales@acme.test',
    });
  });

  it('throws when the contact has no email and creates no conversation', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, ORG, undefined);

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: 'Project kickoff',
        content: 'Hello',
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('contact_email_not_found');
    expect(await allConversations(t)).toHaveLength(0);
  });

  it('throws when the subject is blank and creates no conversation', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.composeEmailConversation, {
        organizationId: ORG,
        contactId,
        connectorName: 'outlook',
        subject: '   ',
        content: 'Hello',
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('compose_subject_required');
    expect(await allConversations(t)).toHaveLength(0);
  });

  it('denies a member of another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, OUTSIDER, OTHER_ORG);
    const contactId = await seedContact(t, ORG, 'jane@acme.test');

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.composeEmailConversation, {
          organizationId: ORG,
          contactId,
          connectorName: 'outlook',
          subject: 'Project kickoff',
          content: 'Hello',
        }),
    ).rejects.toThrow();
    expect(await allConversations(t)).toHaveLength(0);
  });
});
