// Driven through convex-test against the real schema and indexes, because what
// matters here is not the shape of the rows but who is allowed to see them.
// An emailed attachment is visible exactly when its conversation is, and this
// listing is a WIDER door than search — search needs the caller to guess words
// that appear in the file, a listing hands over the catalogue.

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
        ? { conversationId: args.conversationId as never }
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

    const result = await list(t, 'member_1');
    // Unassigned mail is admin-triage state, not org-readable.
    expect(result.attachments.map((a) => a.ref)).toEqual(['mine']);
  });

  it('shows the individual assignee their own mail', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'member_2', 'member');
    const mine = await seedConversation(t, { assigneeUserId: 'member_2' });
    await seedAttachment(t, { storageId: 'assigned', conversationId: mine });

    const result = await list(t, 'member_2');
    expect(result.attachments.map((a) => a.ref)).toEqual(['assigned']);
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
    // and since both surfaces now call `conversationCallerResolver`, that one
    // test covers this listing too.
    const t = convexTest(schema, modules);
    await seedMember(t, 'disabled_1', 'disabled', [TEAM]);
    const conv = await seedConversation(t, { assigneeTeamId: TEAM });
    await seedAttachment(t, { storageId: 'b1', conversationId: conv });

    expect((await list(t, 'disabled_1')).attachments).toEqual([]);
  });
});

describe('a table dominated by unbound rows', () => {
  // The shape measured on a live deployment: 3,671 `fileMetadata` rows of which
  // 3 are bound. Walking every row under a scan budget meant the budget was
  // spent on rows that can never qualify, and which bound rows were reachable
  // depended on where they sat in creation order — so the listing silently
  // emptied as the table grew.
  //
  // 700 unbound rows is above the 600 budget, so this fails against a walk over
  // all rows and passes against a walk over bound rows only.
  it('finds every bound row regardless of how many unbound rows precede it', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'owner_1', 'owner');
    const conv = await seedConversation(t, { assigneeUserId: 'owner_1' });
    // Bound rows FIRST, so they are the oldest and sit behind every unbound row
    // in creation order — the position that used to make them unreachable.
    for (let index = 0; index < 3; index += 1) {
      await seedAttachment(t, {
        storageId: `bound_${index}`,
        conversationId: conv,
        ragStatus: 'completed',
      });
    }
    await t.run(async (ctx) => {
      for (let index = 0; index < 700; index += 1) {
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

    const result = await list(t, 'owner_1');
    expect(result.attachments.map((a) => a.ref).sort()).toEqual([
      'bound_0',
      'bound_1',
      'bound_2',
    ]);
    // And the walk is not reporting a partial answer, because it never touched
    // the unbound rows at all.
    expect(result.truncated).toBe(false);
  });
});

describe('listMailAttachments — what is listed', () => {
  it('lists only attachments bound to a conversation', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    await seedAttachment(t, { storageId: 'bound', conversationId: conv });
    // A Document Hub upload and an unbound mail attachment are both out.
    await seedAttachment(t, { storageId: 'unbound' });

    const result = await list(t, 'admin_1');
    expect(result.attachments.map((a) => a.ref)).toEqual(['bound']);
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

    const result = await list(t, 'admin_1');
    expect(result.attachments.map((a) => a.ref)).toEqual(['live']);
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

  it('keeps the newest when the limit bites, not the oldest', async () => {
    // The bound decides the answer, so which end it keeps is the feature.
    // Oldest-first would answer "what has come in?" with the stalest mail.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    for (let index = 0; index < 6; index += 1) {
      await seedAttachment(t, {
        storageId: `b${index}`,
        conversationId: conv,
        fileName: `f${index}.pdf`,
      });
    }

    const result = await list(t, 'admin_1', 2);
    expect(result.attachments.map((a) => a.ref)).toEqual(['b5', 'b4']);
  });

  it("never lists an attachment pointing at another organization's conversation", async () => {
    // A conversation id on a row is a reference, not a permission. Following it
    // across a tenant boundary would list one org's mail in another's.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const foreign = await t.run(async (ctx) =>
      ctx.db.insert('conversations', {
        organizationId: 'org_somewhere_else',
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

  it('stops at its scan budget and says the listing is partial', async () => {
    // The walk filters as it goes, so a caller who can read little rejects most
    // of what it touches. Without a bound on rows EXAMINED one question would
    // read the whole table.
    const t = convexTest(schema, modules);
    await seedMember(t, 'admin_1', 'admin');
    const conv = await seedConversation(t, { assigneeUserId: 'admin_1' });
    for (let index = 0; index < 4; index += 1) {
      await seedAttachment(t, { storageId: `s${index}`, conversationId: conv });
    }

    const stopped = await t.run(async (ctx) =>
      listMailAttachments(ctx, {
        organizationId: ORG,
        userId: 'admin_1',
        limit: 20,
        scanCap: 2,
      }),
    );
    expect(stopped.truncated).toBe(true);
    expect(stopped.attachments).toHaveLength(2);

    const complete = await t.run(async (ctx) =>
      listMailAttachments(ctx, {
        organizationId: ORG,
        userId: 'admin_1',
        limit: 20,
      }),
    );
    expect(complete.truncated).toBe(false);
    expect(complete.attachments).toHaveLength(4);
  });

  it('carries the corpus ref so a listed row can be fetched', async () => {
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
