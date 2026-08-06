// Server-side reply derivation — drives the REAL `mutationWithRLS` wrapper and
// the real send helper through convex-test. Fake timers keep the scheduled
// outbound send action (a 'use node' connector call) from executing: the
// assertion boundary is the queued message row + the scheduled job's args.

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  BULK_REPLY_CAP,
  buildReplySubject,
  splitHtmlText,
} from './reply_to_conversation';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/conversations/), mirroring status_transitions_rls.test.ts.
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

const ORG = 'org_conv_reply';
const OTHER_ORG = 'org_conv_reply_other';
const EDITOR = 'user_reply_editor';
const OUTSIDER = 'user_reply_outsider';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
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

async function seedContact(t: T, email: string): Promise<Id<'contacts'>> {
  return t.run((ctx) =>
    ctx.db.insert('contacts', {
      organizationId: ORG,
      name: 'Jane Doe',
      email,
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
      // Owned by the acting editor: assignment privacy is built into the
      // conversations RLS rules, so an unassigned thread is admin-triage only
      // and the reply would be denied at the read.
      assigneeUserId: EDITOR,
      ...overrides,
    }),
  );
}

async function outboundMessages(
  t: T,
  conversationId: Id<'conversations'>,
): Promise<Doc<'conversationMessages'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_and_deliveredAt', (q) =>
        q.eq('conversationId', conversationId),
      )
      .collect(),
  );
}

describe('buildReplySubject', () => {
  it('prefixes a plain subject with Re:', () => {
    expect(buildReplySubject('Need help')).toBe('Re: Need help');
  });

  it('is idempotent for already-prefixed subjects, case-insensitively', () => {
    expect(buildReplySubject('Re: Need help')).toBe('Re: Need help');
    expect(buildReplySubject('RE: Need help')).toBe('RE: Need help');
    expect(buildReplySubject('re: Need help')).toBe('re: Need help');
  });

  it('falls back to a generic reply subject when the conversation has none', () => {
    expect(buildReplySubject(undefined)).toBe('Re: Conversation');
    expect(buildReplySubject('   ')).toBe('Re: Conversation');
  });
});

describe('splitHtmlText', () => {
  it('keeps the content as html and strips tags for the text body', () => {
    expect(splitHtmlText('<p>Hello <b>there</b></p>')).toEqual({
      html: '<p>Hello <b>there</b></p>',
      text: 'Hello there',
    });
  });

  it('passes plain text through unchanged', () => {
    expect(splitHtmlText('Just text')).toEqual({
      html: 'Just text',
      text: 'Just text',
    });
  });
});

describe('replyToConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives recipient, Re: subject, html/text split and connector from the conversation and delegates to the send path', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
      externalMessageId: '<root@acme.test>',
    });

    const messageId = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: '<p>Happy to help</p>',
      });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message).toMatchObject({
      organizationId: ORG,
      conversationId,
      channel: 'email',
      direction: 'outbound',
      deliveryState: 'queued',
      content: '<p>Happy to help</p>',
    });
    expect(message?.metadata).toMatchObject({
      to: ['jane@acme.test'],
      subject: 'Re: Need help',
      connectorName: 'outlook',
      // Threading resolved by the shared send helper from the conversation root.
      inReplyTo: '<root@acme.test>',
    });

    // The actual delivery is delegated to the existing connector action.
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
      subject: 'Re: Need help',
      body: '<p>Happy to help</p>',
      contentType: 'HTML',
    });

    const conversation = await t.run((ctx) => ctx.db.get(conversationId));
    expect(typeof conversation?.lastMessageAt).toBe('number');
  });

  it('does not double-prefix a subject that already starts with Re:', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Re: Need help',
    });

    const messageId = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Following up',
      });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.metadata).toMatchObject({ subject: 'Re: Need help' });
  });

  it('throws when the conversation has no connectorName — no silent provider fallback', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      subject: 'Need help',
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Hello',
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('conversation_connector_missing');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });

  it('throws when the conversation has no usable customer email', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const conversationId = await seedConversation(t, {
      connectorName: 'outlook',
      subject: 'Need help',
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Hello',
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('customer_email_not_found');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });

  it('denies a member of another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, OUTSIDER, OTHER_ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.replyToConversation, {
          conversationId,
          organizationId: ORG,
          content: 'Hello',
        }),
    ).rejects.toThrow();
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });
});

// `sendMessageViaConnector` is the shared choke point `replyToConversation`
// and `composeEmailConversation` both delegate through — one gate closes the
// gap for every write path (#2661). Exercised here via `replyToConversation`
// since it needs no extra setup beyond the fixtures already in this file.
describe('replyToConversation — attachment caps (#2661)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function storeBlob(t: T): Promise<Id<'_storage'>> {
    return t.run((ctx) => ctx.storage.store(new Blob(['x'])));
  }

  it('rejects an over-count attachment set and sends nothing', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });
    const storageId = await storeBlob(t);
    const attachments = Array.from({ length: 11 }, (_, i) => ({
      storageId,
      fileName: `doc-${i}.pdf`,
      contentType: 'application/pdf',
      size: 1024,
    }));

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Hello',
        attachments,
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('CONVERSATION_ATTACHMENTS_TOO_MANY');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });

  it('rejects a disallowed MIME type and sends nothing', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });
    const storageId = await storeBlob(t);

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Hello',
        attachments: [
          {
            storageId,
            fileName: 'payload.exe',
            contentType: 'application/x-msdownload',
            size: 1024,
          },
        ],
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('CONVERSATION_ATTACHMENT_TYPE_INVALID');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });

  it('rejects a declared over-size attachment and sends nothing', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });
    const storageId = await storeBlob(t);

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.replyToConversation, {
        conversationId,
        organizationId: ORG,
        content: 'Hello',
        attachments: [
          {
            storageId,
            fileName: 'huge.pdf',
            contentType: 'application/pdf',
            size: 5e8,
          },
        ],
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('CONVERSATION_ATTACHMENT_TOO_LARGE');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });
});

describe('bulkReplyToConversations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replies to every deliverable conversation and reports per-row failures (partial-failure bulk contract)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const deliverable = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });
    const missingConnector = await seedConversation(t, {
      contactId,
      subject: 'Other topic',
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.bulkReplyToConversations, {
        conversationIds: [deliverable, missingConnector],
        organizationId: ORG,
        content: 'Bulk update',
      });

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(String(missingConnector));
    expect(await outboundMessages(t, deliverable)).toHaveLength(1);
    expect(await outboundMessages(t, missingConnector)).toHaveLength(0);
  });

  it('enforces the bulk cap before any reply goes out', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG);
    const contactId = await seedContact(t, 'jane@acme.test');
    const conversationId = await seedConversation(t, {
      contactId,
      connectorName: 'outlook',
      subject: 'Need help',
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.bulkReplyToConversations, {
        conversationIds: new Array<Id<'conversations'>>(
          BULK_REPLY_CAP + 1,
        ).fill(conversationId),
        organizationId: ORG,
        content: 'Bulk update',
      })
      .catch((e: unknown) => e);

    expect(String(error)).toContain('bulk_reply_too_many');
    expect(await outboundMessages(t, conversationId)).toHaveLength(0);
  });
});
