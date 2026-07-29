import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';
import schema from '../schema';
import { listConversationsPaginated } from './list_conversations_paginated';

// Hoisted switch: most suites run a cheap stub; the flat list-row field suite
// flips to the REAL transform (and back) — the factory below reads the flag
// per call, so no re-typed `mockImplementation` swap is needed.
const transformMode = vi.hoisted(() => ({ useReal: false }));

vi.mock('./transform_conversation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./transform_conversation')>();
  return {
    transformConversation: vi.fn((ctx, doc, options) =>
      transformMode.useReal
        ? actual.transformConversation(ctx, doc, options)
        : Promise.resolve({ ...doc, title: 'transformed' }),
    ),
  };
});

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

function createMockQueryBuilder(
  documents: Array<Record<string, unknown>> = [],
) {
  const paginateResult = {
    page: documents,
    isDone: true,
    continueCursor: documents.length > 0 ? 'cursor_1' : '',
  };

  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    paginate: vi.fn().mockResolvedValue(paginateResult),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
    },
  };

  return { ctx, builder, paginateResult };
}

const DEFAULT_PAGINATION_OPTS = { numItems: 20, cursor: null, id: 0 };

describe('listConversationsPaginated', () => {
  it('uses by_org_lastMessageAt index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('conversations');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('uses by_org_status_lastMessageAt index when status is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses by_org_lastMessageAt and filters priority when only priority is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      priority: 'high',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('uses by_org_lastMessageAt and filters channel when only channel is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      channel: 'email',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('uses status index and filters priority when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
      priority: 'high',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('uses status index and filters both priority and channel when all provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
      priority: 'high',
      channel: 'email',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(2);
  });

  it('transforms each document in the page', async () => {
    const docs = [
      { _id: 'c_1', subject: 'Test 1' },
      { _id: 'c_2', subject: 'Test 2' },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listConversationsPaginated(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        organizationId: 'org_1',
      },
    );

    expect(result.page).toHaveLength(2);
    expect(result.page[0]).toHaveProperty('title', 'transformed');
    expect(result.page[1]).toHaveProperty('title', 'transformed');
  });

  it('returns pagination metadata', async () => {
    const docs = [{ _id: 'c_1' }];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listConversationsPaginated(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        organizationId: 'org_1',
      },
    );

    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe('cursor_1');
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });

  it('uses by_org_connector_status_lastMessageAt when connectorName and status are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
      connectorName: 'outlook',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_connector_status_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses by_org_lastMessageAt and filters connectorName when only connectorName is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      connectorName: 'outlook',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('uses the connector index and filters priority when connectorName, status and priority are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
      connectorName: 'outlook',
      priority: 'high',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_connector_status_lastMessageAt',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });
});

// Row-level checks against the real schema indexes — the mock-based suite
// above proves dispatch, this one proves the rows an email app actually gets.
describe('listConversationsPaginated connectorName row filtering', () => {
  const ORG = 'org_conv_list_rows';
  type T = TestConvex<typeof schema>;

  interface SeededIds {
    outlookOpen: string;
    gmailOpen: string;
    unsetOpen: string;
    outlookClosed: string;
  }

  async function seedRows(t: T): Promise<SeededIds> {
    return t.run(async (ctx) => {
      const outlookOpen = await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
        connectorName: 'outlook',
        subject: 'Outlook open',
        lastMessageAt: 400,
      });
      const gmailOpen = await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
        connectorName: 'gmail',
        subject: 'Gmail open',
        lastMessageAt: 300,
      });
      const unsetOpen = await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
        subject: 'No connector',
        lastMessageAt: 200,
      });
      const outlookClosed = await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'closed',
        connectorName: 'outlook',
        subject: 'Outlook closed',
        lastMessageAt: 100,
      });
      return { outlookOpen, gmailOpen, unsetOpen, outlookClosed };
    });
  }

  it('returns only rows of the requested connector and status — other connectors, unset-connector rows and other statuses are excluded', async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t);

    const result = await t.run((ctx) =>
      listConversationsPaginated(ctx as unknown as QueryCtx, {
        paginationOpts: { numItems: 10, cursor: null },
        organizationId: ORG,
        status: 'open',
        connectorName: 'outlook',
      }),
    );

    expect(result.page.map((c) => c._id)).toEqual([ids.outlookOpen]);
  });

  it('filters by connectorName across statuses (recency order) when status is not set', async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t);

    const result = await t.run((ctx) =>
      listConversationsPaginated(ctx as unknown as QueryCtx, {
        paginationOpts: { numItems: 10, cursor: null },
        organizationId: ORG,
        connectorName: 'outlook',
      }),
    );

    expect(result.page.map((c) => c._id)).toEqual([
      ids.outlookOpen,
      ids.outlookClosed,
    ]);
  });

  it('keeps the unfiltered listing unchanged when connectorName is absent', async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t);

    const result = await t.run((ctx) =>
      listConversationsPaginated(ctx as unknown as QueryCtx, {
        paginationOpts: { numItems: 10, cursor: null },
        organizationId: ORG,
        status: 'open',
      }),
    );

    expect(result.page.map((c) => c._id)).toEqual([
      ids.outlookOpen,
      ids.gmailOpen,
      ids.unsetOpen,
    ]);
  });
});

// End-to-end over the REAL transform: the flat fields the ConversationList
// block's item map reads (senderField/previewField) must land on every list
// row, derived from the batch-prefetched customer and the latest message.
describe('listConversationsPaginated flat list-row fields', () => {
  const ORG = 'org_conv_list_flat_fields';

  beforeEach(() => {
    transformMode.useReal = true;
  });

  afterEach(() => {
    transformMode.useReal = false;
  });

  it('flattens senderName and a capped raw lastMessagePreview onto each row', async () => {
    const t = convexTest(schema, modules);
    const rawHtml = `<p>Hello from Ada</p>${'x'.repeat(300)}`;

    await t.run(async (ctx) => {
      const contactId = await ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        source: 'manual_import',
      });
      const withContact = await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
        connectorName: 'outlook',
        contactId,
        subject: 'With contact',
        lastMessageAt: 200,
      });
      await ctx.db.insert('conversationMessages', {
        organizationId: ORG,
        conversationId: withContact,
        channel: 'email',
        direction: 'inbound',
        deliveryState: 'delivered',
        content: rawHtml,
        sentAt: 200,
        deliveredAt: 200,
      });
      // A row with no contact and no messages — both fields stay absent.
      await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
        connectorName: 'outlook',
        subject: 'Bare',
        lastMessageAt: 100,
      });
    });

    const result = await t.run((ctx) =>
      listConversationsPaginated(ctx as unknown as QueryCtx, {
        paginationOpts: { numItems: 10, cursor: null },
        organizationId: ORG,
        status: 'open',
        connectorName: 'outlook',
      }),
    );

    expect(result.page).toHaveLength(2);
    const [withContact, bare] = result.page;
    expect(withContact.senderName).toBe('Ada Lovelace');
    // Raw (HTML intact — the block cleans client-side) and capped at 200.
    expect(withContact.lastMessagePreview).toBe(rawHtml.slice(0, 200));
    expect(withContact.lastMessagePreview).toHaveLength(200);
    expect(bare.senderName).toBeUndefined();
    expect(bare.lastMessagePreview).toBeUndefined();
  });
});
