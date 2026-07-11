import { describe, expect, it, vi } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { transformConversation } from './transform_conversation';

// transformConversation fetches a pending approval for the conversation; the
// name-fallback behavior under test does not depend on it, so stub it out.
vi.mock('../approvals/helpers', () => ({
  getPendingApprovalForResource: vi.fn().mockResolvedValue(null),
}));

// Minimal ctx whose message query resolves to "no messages" and whose
// `db.get` is unused (every test prefetches the contact via options.contact).
function createMockCtx() {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      get: vi.fn().mockResolvedValue(null),
    },
  };

  return ctx as unknown as QueryCtx;
}

function makeConversation(
  overrides: Partial<Doc<'conversations'>> = {},
): Doc<'conversations'> {
  return {
    _id: 'conv_1',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org_1',
    contactId: 'cont_1',
    subject: 'Help with my order',
    status: 'open',
    metadata: {},
    ...overrides,
  } as unknown as Doc<'conversations'>;
}

function makeContactDoc(
  overrides: Partial<Doc<'contacts'>> = {},
): Doc<'contacts'> {
  return {
    _id: 'cont_1',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org_1',
    email: 'contact@example.com',
    source: 'manual_import',
    ...overrides,
  } as unknown as Doc<'contacts'>;
}

function makeMessageDoc(
  overrides: Partial<Omit<Doc<'conversationMessages'>, '_id'>> & {
    _id?: string;
  } = {},
): Doc<'conversationMessages'> {
  return {
    _id: 'msg_1',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org_1',
    conversationId: 'conv_1',
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    content: 'Hello',
    sentAt: 1_700_000_000_000,
    deliveredAt: 1_700_000_000_000,
    metadata: {},
    ...overrides,
  } as unknown as Doc<'conversationMessages'>;
}

function createMockCtxWithMessages(messages: Doc<'conversationMessages'>[]) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    [Symbol.asyncIterator]: async function* () {
      for (const message of messages) {
        yield message;
      }
    },
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      get: vi.fn().mockResolvedValue(null),
    },
  };

  return ctx as unknown as QueryCtx;
}

describe('transformConversation message ordering', () => {
  it('sorts messages by sentAt even when deliveredAt is missing on outbound mail', async () => {
    const messages = [
      makeMessageDoc({
        _id: 'inbound_latest',
        direction: 'inbound',
        sentAt: 1_752_406_542_000,
        deliveredAt: 1_752_406_542_000,
        _creationTime: 1_752_406_800_000,
      }),
      makeMessageDoc({
        _id: 'outbound_mid',
        direction: 'outbound',
        deliveryState: 'sent',
        sentAt: 1_752_405_895_085,
        deliveredAt: undefined,
        _creationTime: 1_752_405_895_085,
      }),
      makeMessageDoc({
        _id: 'outbound_early',
        direction: 'outbound',
        deliveryState: 'sent',
        sentAt: 1_752_405_527_413,
        deliveredAt: undefined,
        _creationTime: 1_752_405_527_413,
      }),
      makeMessageDoc({
        _id: 'inbound_yesterday',
        direction: 'inbound',
        sentAt: 1_752_315_109_000,
        deliveredAt: 1_752_315_109_000,
        _creationTime: 1_752_315_600_000,
      }),
    ];

    const ctx = createMockCtxWithMessages(messages);
    const conversation = makeConversation();
    const contact = makeContactDoc();

    const result = await transformConversation(ctx, conversation, {
      contact,
      includeAllMessages: true,
    });

    expect(result.messages.map((message) => message.id)).toEqual([
      'inbound_yesterday',
      'outbound_early',
      'outbound_mid',
      'inbound_latest',
    ]);
  });
});

describe('transformConversation contact name fallback', () => {
  it('leaves name undefined for a found contact that has no name', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    // A contact doc that exists but carries no name (and an empty-string name
    // should be treated the same way).
    const contact = makeContactDoc({ name: undefined });

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.contact.name).toBeUndefined();
    // Email is still populated so downstream consumers have a real identifier.
    expect(result.contact.email).toBe('contact@example.com');
  });

  it('leaves name undefined for an empty-string contact name', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    const contact = makeContactDoc({ name: '' });

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.contact.name).toBeUndefined();
  });

  it('leaves name undefined in the no-contact fallback', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();

    // A prefetched `null` is trusted as "no contact for this conversation".
    const result = await transformConversation(ctx, conversation, {
      contact: null,
    });

    expect(result.contact.name).toBeUndefined();
  });

  it('preserves a real contact name when present', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    const contact = makeContactDoc({ name: 'Ada Lovelace' });

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.contact.name).toBe('Ada Lovelace');
  });

  it('exposes no status field on the contact display object', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    const contact = makeContactDoc({ name: 'Ada Lovelace' });

    const result = await transformConversation(ctx, conversation, { contact });

    expect('status' in result.contact).toBe(false);
  });
});

// The ConversationList block reads row fields single-level, so the transform
// flattens the sender heading and the latest message's content onto the row.
describe('transformConversation flat list-row fields', () => {
  // Like createMockCtx, but the latest-message query resolves to `message`.
  function createMockCtxWithMessage(message: Record<string, unknown> | null) {
    const builder = {
      withIndex: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(message),
    };

    const ctx = {
      db: {
        query: vi.fn().mockReturnValue(builder),
        get: vi.fn().mockResolvedValue(null),
      },
    };

    return ctx as unknown as QueryCtx;
  }

  function makeMessageDocWithContent(content: string): Record<string, unknown> {
    return {
      _id: 'msg_1',
      _creationTime: 1_700_000_100_000,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      channel: 'email',
      direction: 'inbound',
      deliveryState: 'delivered',
      content,
      sentAt: 1_700_000_100_000,
      deliveredAt: 1_700_000_100_000,
      metadata: {},
    };
  }

  it('flattens the contact name onto senderName', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const contact = makeContactDoc({ name: 'Ada Lovelace' });

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.senderName).toBe('Ada Lovelace');
  });

  it('leaves senderName undefined when the contact has no name (the client renders its own fallback)', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const contact = makeContactDoc({ name: undefined });

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.senderName).toBeUndefined();
  });

  it('leaves senderName undefined when there is no contact', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();

    const result = await transformConversation(ctx, conversation, {
      contact: null,
    });

    expect(result.senderName).toBeUndefined();
  });

  it('carries the latest message content RAW (HTML intact) on lastMessagePreview', async () => {
    const raw = '<p>Hello <b>there</b></p>';
    const ctx = createMockCtxWithMessage(makeMessageDocWithContent(raw));
    const conversation = makeConversation();
    const contact = makeContactDoc();

    const result = await transformConversation(ctx, conversation, { contact });

    // No server-side HTML cleaning — the block strips tags client-side.
    expect(result.lastMessagePreview).toBe(raw);
  });

  it('caps lastMessagePreview at 200 characters', async () => {
    const long = 'x'.repeat(500);
    const ctx = createMockCtxWithMessage(makeMessageDocWithContent(long));
    const conversation = makeConversation();
    const contact = makeContactDoc();

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.lastMessagePreview).toBe('x'.repeat(200));
  });

  it('leaves lastMessagePreview undefined when the conversation has no messages', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const contact = makeContactDoc();

    const result = await transformConversation(ctx, conversation, { contact });

    expect(result.lastMessagePreview).toBeUndefined();
  });
});
