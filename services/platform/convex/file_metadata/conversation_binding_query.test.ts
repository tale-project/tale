// The read that decides an emailed attachment's corpus stamp. Driven through
// convex-test against the real schema and indexes, because the thing worth
// proving is the tenant boundary: a blob reference is caller-supplied on some
// paths, so answering it without checking the organization would let one org's
// storage id resolve to another org's conversation.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

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

const ORG = 'org_binding';
const OTHER_ORG = 'org_binding_other';
type T = TestConvex<typeof schema>;

async function seedConversation(t: T, organizationId: string): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert('conversations', {
      organizationId,
      subject: 'CV',
      status: 'open',
      channel: 'email',
    }),
  );
}

async function seedAttachment(
  t: T,
  args: { organizationId: string; storageId: string; conversationId?: string },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: 'cv.pdf',
      contentType: 'application/pdf',
      size: 1024,
      ...(args.conversationId !== undefined
        ? { conversationId: args.conversationId as never }
        : {}),
    });
  });
}

function read(t: T, organizationId: string, storageId: string) {
  return t.query(
    internal.file_metadata.internal_queries.getConversationBindingForBlob,
    { organizationId, storageId },
  );
}

describe('getConversationBindingForBlob', () => {
  it('returns the conversation a bound attachment arrived on', async () => {
    const t = convexTest(schema, modules);
    const conversationId = await seedConversation(t, ORG);
    await seedAttachment(t, {
      organizationId: ORG,
      storageId: 'blob_bound',
      conversationId,
    });

    expect(await read(t, ORG, 'blob_bound')).toBe(conversationId);
  });

  it('returns null for a file that arrived any other way', async () => {
    const t = convexTest(schema, modules);
    await seedAttachment(t, { organizationId: ORG, storageId: 'blob_plain' });

    expect(await read(t, ORG, 'blob_plain')).toBeNull();
  });

  it("never answers with another organization's binding", async () => {
    const t = convexTest(schema, modules);
    const foreign = await seedConversation(t, OTHER_ORG);
    await seedAttachment(t, {
      organizationId: OTHER_ORG,
      storageId: 'blob_foreign',
      conversationId: foreign,
    });

    // The row exists and is bound; it just is not this org's.
    expect(await read(t, ORG, 'blob_foreign')).toBeNull();
    expect(await read(t, OTHER_ORG, 'blob_foreign')).toBe(foreign);
  });

  it('returns null for a storage id with no row', async () => {
    const t = convexTest(schema, modules);
    expect(await read(t, ORG, 'blob_missing')).toBeNull();
  });
});
