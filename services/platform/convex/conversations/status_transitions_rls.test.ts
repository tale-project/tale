// Regression gate for issue #1972 — closing, reopening, marking-as-spam and
// bulk-transitioning a conversation must persist for a normal inbox role.
//
// The status mutations emit an audit row, and `createAuditLog` opens every
// write by upserting the per-org `auditLogChainGenesis` sentinel. That sentinel
// table is deny-all for EVERY role under `mutationWithRLS`, so before the fix
// the audit write ran on the RLS-wrapped ctx, failed the sentinel's RLS insert
// check, and aborted the whole mutation with `insert access not allowed` — the
// conversation patch rolled back and the status never changed (regardless of
// role). The fix routes the audit write through the internal `createAuditLog`
// mutation (raw ctx, bypasses RLS) — see `audit_logs/emit.ts`.
//
// We drive the REAL `mutationWithRLS` wrapper + REAL RLS rules + REAL audit
// chain through convex-test as an `editor` (conversations: ALL, so the patch is
// permitted and we actually reach the audit write). This fails on the pre-fix
// code (RLS denial on the genesis sentinel) and passes after.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/conversations/), mirroring support_cases/support_cases.test.ts.
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

const ORG = 'org_conv_rls';
const EDITOR = 'user_conv_editor';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedEditor(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: 'm_conv',
      userId: EDITOR,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
  });
}

async function seedConversation(
  t: T,
  status: 'open' | 'closed' | 'spam' | 'archived' = 'open',
): Promise<Id<'conversations'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId: ORG,
      status,
      subject: 'Need help',
      // Owned by the acting editor: assignment privacy is built into the
      // conversations RLS rules, so an unassigned thread is admin-triage only
      // and would fail the read before this test reaches the audit chain.
      assigneeUserId: EDITOR,
    }),
  );
}

async function statusOf(
  t: T,
  id: Id<'conversations'>,
): Promise<string | undefined> {
  const row = await t.run((ctx) => ctx.db.get(id));
  return row?.status;
}

async function auditActions(t: T): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', ORG),
      )
      .collect(),
  );
  return rows.map((r) => r.action);
}

describe('conversation status transitions reach the audit write (#1972)', () => {
  it('closeConversation persists status and writes an audit row (no RLS denial)', async () => {
    const t = convexTest(schema, modules);
    await seedEditor(t);
    const conversationId = await seedConversation(t, 'open');

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.closeConversation, {
        conversationId,
      });

    expect(await statusOf(t, conversationId)).toBe('closed');
    expect(await auditActions(t)).toContain('close_conversation');
  });

  it('markConversationAsSpam persists status', async () => {
    const t = convexTest(schema, modules);
    await seedEditor(t);
    const conversationId = await seedConversation(t, 'open');

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.markConversationAsSpam, {
        conversationId,
      });

    expect(await statusOf(t, conversationId)).toBe('spam');
  });

  it('reopenConversation persists status', async () => {
    const t = convexTest(schema, modules);
    await seedEditor(t);
    const conversationId = await seedConversation(t, 'closed');

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.reopenConversation, {
        conversationId,
      });

    expect(await statusOf(t, conversationId)).toBe('open');
  });

  it('bulkCloseConversations transitions every row', async () => {
    const t = convexTest(schema, modules);
    await seedEditor(t);
    const a = await seedConversation(t, 'open');
    const b = await seedConversation(t, 'open');

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.bulkCloseConversations, {
        conversationIds: [a, b],
      });

    expect(result.successCount).toBe(2);
    expect(await statusOf(t, a)).toBe('closed');
    expect(await statusOf(t, b)).toBe('closed');
  });
});
