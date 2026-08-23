// Driven through convex-test against the real schema and indexes, because what
// matters here is not the shape of the rows but who is allowed to see them and
// what the walk costs. An emailed attachment is visible exactly when its
// conversation is, and this listing is a WIDER door than search — search needs
// the caller to guess words that appear in the file, a listing hands over the
// catalogue.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { listMailAttachments } from './list_mail_attachments';

const TEST_DIR_FROM_CONVEX_ROOT = 'file_metadata';
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

const ORG = 'org_mail_list';
const TEAM = 'team_inbox';
const OTHER_TEAM = 'team_other';
const BASE_TIME = 1_700_000_000_000;
type T = TestConvex<typeof schema>;

async function seedMember(
  t: T,
  userId: string,
  role: string,
  teamIds: string[] = [],
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
    for (const teamId of teamIds) {
      await ctx.db.insert('teamMemberMirror', {
        teamMemberId: `tm_${userId}_${teamId}`,
        userId,
        teamId,
      });
    }
  });
}

async function seedConversation(
  t: T,
  fields: Record<string, unknown> = {},
): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Application',
      status: 'open',
      channel: 'email',
      ...fields,
    }),
  );
}

async function seedAttachment(
  t: T,
  args: {
    storageId: string;
    conversationId?: string;
    fileName?: string;
    ragStatus?: string;
    lifecycleStatus?: string;
    /** Arrival time. Only a row carrying one is in the mail index at all. */
    receivedAt?: number;
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId: args.storageId,
      fileName: args.fileName ?? 'cv.pdf',
      contentType: 'application/pdf',
      size: 1024,
      source: 'imap-smtp',
      ...(args.conversationId !== undefined
        ? {
            conversationId: args.conversationId as never,
            mailReceivedAt: args.receivedAt ?? BASE_TIME,
          }
        : {}),
      ...(args.ragStatus !== undefined
        ? { ragStatus: args.ragStatus as never }
        : {}),
      ...(args.lifecycleStatus !== undefined
        ? { lifecycleStatus: args.lifecycleStatus as never }
        : {}),
    });
  });
}

async function seedUnbound(t: T, count: number): Promise<void> {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: `unbound_${index}`,
        fileName: `f${index}.pdf`,
        contentType: 'application/pdf',
        size: 100,
        source: 'imap-smtp',
      });
    }
  });
}

function list(t: T, userId: string | undefined, limit = 20) {
  return t.query(
    internal.file_metadata.internal_queries.listMailAttachmentsForChat,
    { organizationId: ORG, limit, ...(userId !== undefined ? { userId } : {}) },
  );
}

describe('listMailAttachments — who may see what', () => {
  it('shows an admin every attachment, including unassigned mail', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const unassigned = await seedConversation(t);
    const otherTeam = await seedConversation(t, { assigneeTeamId: OTHER_TEAM });
    await seedAttachment(t, { storageId: 'b1', conversationId: unassigned });
    await seedAttachment(t, { storageId: 'b2', conversationId: otherTeam });

    const result = await list(t, 'admin_1');
    expect(result.attachments.map((a) => a.ref).sort()).toEqual(['b1', 'b2']);
  });

  it("shows a member only their team's mail", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'member_1', 'member', [TEAM]);
    const mine = await seedConversation(t, { assigneeTeamId: TEAM });
    const theirs = await seedConversation(t, { assigneeTeamId: OTHER_TEAM });
    const unassigned = await seedConversation(t);
    await seedAttachment(t, { storageId: 'mine', conversationId: mine });
    await seedAttachment(t, { storageId: 'theirs', conversationId: theirs });
    await seedAttachment(t, {
      storageId: 'triage',
      conversationId: unassigned,
    });

    // Unassigned mail is admin-triage state, not org-readable.
    expect((await list(t, 'member_1')).attachments.map((a) => a.ref)).toEqual([
      'mine',
    ]);
  });

  it('shows the individual assignee their own mail', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'member_2', 'member');
    const mine = await seedConversation(t, { assigneeUserId: 'member_2' });
    await seedAttachment(t, { storageId: 'assigned', conversationId: mine });

    expect((await list(t, 'member_2')).attachments.map((a) => a.ref)).toEqual([
      'assigned',
    ]);
  });

  it('shows nothing to a caller who did not say who they are', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, { storageId: 'b1', conversationId: conv });

    expect((await list(t, undefined)).attachments).toEqual([]);
  });

  it('shows nothing to a role that cannot read mail', async () => {
    // The non-MEMBER case is not testable here: a caller absent from
    // `memberMirror` falls through to the Better Auth component, which
    // convex-test cannot register. It is covered where the shared resolver is
    // driven directly, in
    // `documents/filter_retrievable_rag_file_ids.conversation_scope.test.ts` —
    // and since both surfaces use `conversationCallerResolver`, that covers
    // this listing too.
    const t = convexTest(schema, modules);
    await seedMember(t, 'disabled_1', 'disabled', [TEAM]);
    const conv = await seedConversation(t, { assigneeTeamId: TEAM });
    await seedAttachment(t, { storageId: 'b1', conversationId: conv });

    expect((await list(t, 'disabled_1')).attachments).toEqual([]);
  });

  it("never lists an attachment whose conversation is another org's", async () => {
    // A conversationId on a row is a reference, not a permission.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const foreign = await t.run(async (ctx) =>
      ctx.db.insert('conversations', {
        organizationId: 'org_elsewhere',
        subject: 'Theirs',
        status: 'open',
        channel: 'email',
      }),
    );
    await seedAttachment(t, {
      storageId: 'b_foreign',
      conversationId: foreign,
    });

    expect((await list(t, 'admin_1')).attachments).toEqual([]);
  });
});

describe('listMailAttachments — order and cost', () => {
  it('orders by arrival, not by conversation activity', async () => {
    // The ordering this exists for: a fresh arrival on a quiet thread must not
    // sort below an older one whose conversation happened to get a reply.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const busy = await seedConversation(t, { assigneeUserId: 'admin_1' });
    const quiet = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, {
      storageId: 'older',
      conversationId: busy,
      receivedAt: 1_000,
    });
    await seedAttachment(t, {
      storageId: 'newer',
      conversationId: quiet,
      receivedAt: 9_000,
    });

    const result = await list(t, 'admin_1');
    expect(result.attachments.map((a) => a.ref)).toEqual(['newer', 'older']);
    expect(result.attachments[0]?.receivedAt).toBe(9_000);
  });

  it('reads only what it returns, however large the table', async () => {
    // The property three earlier shapes failed: cost must not grow with the
    // table. 700 unbound rows exist and none is touched, because a row without
    // an arrival time is not in the mail index at all.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, { storageId: 'wanted', conversationId: conv });
    await seedUnbound(t, 700);

    const result = await list(t, 'admin_1');
    expect(result.attachments.map((a) => a.ref)).toEqual(['wanted']);
    expect(result.truncated).toBe(false);
  });

  it('reports truncation when the page fills, and not when it does not', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    for (let index = 0; index < 4; index += 1) {
      await seedAttachment(t, {
        storageId: `a${index}`,
        conversationId: conv,
        receivedAt: BASE_TIME + index,
      });
    }

    const cut = await list(t, 'admin_1', 2);
    expect(cut.attachments).toHaveLength(2);
    expect(cut.truncated).toBe(true);

    const whole = await list(t, 'admin_1', 20);
    expect(whole.attachments).toHaveLength(4);
    expect(whole.truncated).toBe(false);
  });

  it('stops at its scan bound and says so, rather than looking empty', async () => {
    // A caller who can read little passes more rows than it keeps. Reporting
    // the bound is what stops that reading as "the inbox is empty".
    const t = convexTest(schema, modules);
    await seedMember(t, 'member_1', 'member', [TEAM]);
    const unreadable = await seedConversation(t, {
      assigneeTeamId: OTHER_TEAM,
    });
    for (let index = 0; index < 4; index += 1) {
      await seedAttachment(t, {
        storageId: `x${index}`,
        conversationId: unreadable,
        receivedAt: BASE_TIME + index,
      });
    }

    const stopped = await t.run(async (ctx) =>
      listMailAttachments(ctx, {
        organizationId: ORG,
        userId: 'member_1',
        limit: 20,
        scanCap: 2,
      }),
    );
    expect(stopped.attachments).toEqual([]);
    expect(stopped.truncated).toBe(true);
  });
});

describe('listMailAttachments — what is listed', () => {
  it('lists only attachments that arrived by mail', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, { storageId: 'bound', conversationId: conv });
    await seedUnbound(t, 3);

    expect((await list(t, 'admin_1')).attachments.map((a) => a.ref)).toEqual([
      'bound',
    ]);
  });

  it('excludes a trashed attachment', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, { storageId: 'live', conversationId: conv });
    await seedAttachment(t, {
      storageId: 'gone',
      conversationId: conv,
      lifecycleStatus: 'trashed',
    });

    expect((await list(t, 'admin_1')).attachments.map((a) => a.ref)).toEqual([
      'live',
    ]);
  });

  it('reports whether each attachment is actually indexed', async () => {
    // Received but unindexed is a real state. Listing it as if it were
    // searchable would set the model up to fetch text that is not there.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, {
      storageId: 'done',
      conversationId: conv,
      ragStatus: 'completed',
    });
    await seedAttachment(t, { storageId: 'pending', conversationId: conv });

    const byRef = new Map(
      (await list(t, 'admin_1')).attachments.map((a) => [a.ref, a.indexed]),
    );
    expect(byRef.get('done')).toBe(true);
    expect(byRef.get('pending')).toBe(false);
  });

  it('carries the corpus ref and the conversation so a row can be fetched', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, {
      storageId: 'blob_ref',
      conversationId: conv,
      ragStatus: 'completed',
    });

    const [row] = (await list(t, 'admin_1')).attachments;
    expect(row?.ref).toBe('blob_ref');
    expect(row?.conversationId).toBe(conv);
  });
});
