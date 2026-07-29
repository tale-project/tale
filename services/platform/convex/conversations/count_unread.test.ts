// Approximate unread count over open conversations — drives the REAL
// `queryWithRLS` wrapper and the real schema indexes through convex-test.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import { DEFAULT_COUNT_CAP } from '../lib/helpers/count_items_in_org';
import schema from '../schema';
import { isUnreadConversation } from './count_unread';

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

const ORG = 'org_conv_unread';
const READER = 'user_unread_reader';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedReader(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: 'm_unread',
      userId: READER,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
  });
}

interface SeedRow {
  status: 'open' | 'closed' | 'spam' | 'archived';
  connectorName?: string;
  unreadCount?: number;
}

async function seedConversations(t: T, rows: SeedRow[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert('conversations', {
        organizationId: ORG,
        status: row.status,
        subject: 'Seeded',
        ...(row.connectorName !== undefined
          ? { connectorName: row.connectorName }
          : {}),
        ...(row.unreadCount !== undefined
          ? { metadata: { unread_count: row.unreadCount } }
          : {}),
      });
    }
  });
}

function countUnread(t: T, connectorName?: string): Promise<number> {
  return t
    .withIdentity({ subject: READER })
    .query(api.conversations.queries.approxCountUnreadConversations, {
      organizationId: ORG,
      ...(connectorName !== undefined ? { connectorName } : {}),
    });
}

describe('isUnreadConversation', () => {
  it('is true only for a positive numeric unread marker', () => {
    expect(isUnreadConversation({ unread_count: 3 })).toBe(true);
    expect(isUnreadConversation({ unread_count: 0 })).toBe(false);
    expect(isUnreadConversation({ unread_count: 'many' })).toBe(false);
    expect(isUnreadConversation({})).toBe(false);
    expect(isUnreadConversation(undefined)).toBe(false);
  });
});

describe('approxCountUnreadConversations', () => {
  it('counts open conversations with a positive unread marker, ignoring read, markerless and non-open rows', async () => {
    const t = convexTest(schema, modules);
    await seedReader(t);
    await seedConversations(t, [
      { status: 'open', connectorName: 'outlook', unreadCount: 2 },
      { status: 'open', connectorName: 'gmail', unreadCount: 1 },
      { status: 'open', connectorName: 'outlook', unreadCount: 0 },
      { status: 'open', connectorName: 'outlook' },
      { status: 'closed', connectorName: 'outlook', unreadCount: 5 },
      { status: 'open', unreadCount: 4 },
    ]);

    // outlook-unread + gmail-unread + connectorless-unread; read (0),
    // markerless and closed rows never count.
    expect(await countUnread(t)).toBe(3);
  });

  it('filters by connectorName via the compound index', async () => {
    const t = convexTest(schema, modules);
    await seedReader(t);
    await seedConversations(t, [
      { status: 'open', connectorName: 'outlook', unreadCount: 2 },
      { status: 'open', connectorName: 'gmail', unreadCount: 1 },
      { status: 'open', unreadCount: 4 },
      { status: 'closed', connectorName: 'outlook', unreadCount: 5 },
    ]);

    expect(await countUnread(t, 'outlook')).toBe(1);
    expect(await countUnread(t, 'gmail')).toBe(1);
    expect(await countUnread(t, 'imap_smtp')).toBe(0);
  });

  it('caps the result at DEFAULT_COUNT_CAP', async () => {
    const t = convexTest(schema, modules);
    await seedReader(t);
    await seedConversations(
      t,
      Array.from({ length: DEFAULT_COUNT_CAP + 5 }, () => ({
        status: 'open' as const,
        connectorName: 'outlook',
        unreadCount: 1,
      })),
    );

    expect(await countUnread(t)).toBe(DEFAULT_COUNT_CAP);
  });
});
