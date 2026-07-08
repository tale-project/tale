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
// `db.get` is unused (every test prefetches the customer via options.customer).
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
    customerId: 'cust_1',
    subject: 'Help with my order',
    status: 'open',
    metadata: {},
    ...overrides,
  } as unknown as Doc<'conversations'>;
}

function makeCustomerDoc(
  overrides: Partial<Doc<'customers'>> = {},
): Doc<'customers'> {
  return {
    _id: 'cust_1',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org_1',
    email: 'customer@example.com',
    metadata: {},
    ...overrides,
  } as unknown as Doc<'customers'>;
}

describe('transformConversation customer name fallback', () => {
  it('leaves name undefined for a found customer that has no name', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    // A customer doc that exists but carries no name (and an empty-string name
    // should be treated the same way).
    const customer = makeCustomerDoc({ name: undefined });

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.customer.name).toBeUndefined();
    // Email is still populated so downstream consumers have a real identifier.
    expect(result.customer.email).toBe('customer@example.com');
  });

  it('leaves name undefined for an empty-string customer name', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    const customer = makeCustomerDoc({ name: '' });

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.customer.name).toBeUndefined();
  });

  it('leaves name undefined in the no-customer fallback', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();

    // A prefetched `null` is trusted as "no customer for this conversation".
    const result = await transformConversation(ctx, conversation, {
      customer: null,
    });

    expect(result.customer.name).toBeUndefined();
  });

  it('preserves a real customer name when present', async () => {
    const ctx = createMockCtx();
    const conversation = makeConversation();
    const customer = makeCustomerDoc({ name: 'Ada Lovelace' });

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.customer.name).toBe('Ada Lovelace');
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

  function makeMessageDoc(content: string): Record<string, unknown> {
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

  it('flattens the customer name onto senderName', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const customer = makeCustomerDoc({ name: 'Ada Lovelace' });

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.senderName).toBe('Ada Lovelace');
  });

  it('leaves senderName undefined when the customer has no name (the client renders its own fallback)', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const customer = makeCustomerDoc({ name: undefined });

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.senderName).toBeUndefined();
  });

  it('leaves senderName undefined when there is no customer', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();

    const result = await transformConversation(ctx, conversation, {
      customer: null,
    });

    expect(result.senderName).toBeUndefined();
  });

  it('carries the latest message content RAW (HTML intact) on lastMessagePreview', async () => {
    const raw = '<p>Hello <b>there</b></p>';
    const ctx = createMockCtxWithMessage(makeMessageDoc(raw));
    const conversation = makeConversation();
    const customer = makeCustomerDoc();

    const result = await transformConversation(ctx, conversation, { customer });

    // No server-side HTML cleaning — the block strips tags client-side.
    expect(result.lastMessagePreview).toBe(raw);
  });

  it('caps lastMessagePreview at 200 characters', async () => {
    const long = 'x'.repeat(500);
    const ctx = createMockCtxWithMessage(makeMessageDoc(long));
    const conversation = makeConversation();
    const customer = makeCustomerDoc();

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.lastMessagePreview).toBe('x'.repeat(200));
  });

  it('leaves lastMessagePreview undefined when the conversation has no messages', async () => {
    const ctx = createMockCtxWithMessage(null);
    const conversation = makeConversation();
    const customer = makeCustomerDoc();

    const result = await transformConversation(ctx, conversation, { customer });

    expect(result.lastMessagePreview).toBeUndefined();
  });
});
