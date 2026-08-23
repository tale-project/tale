// The read that decides an emailed attachment's corpus stamp. Driven through
// convex-test against the real schema and indexes, because the thing worth
// proving is the tenant boundary: a blob reference is caller-supplied on some
// paths, so answering it without checking the organization would let one org's
// storage id resolve to another org's conversation.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import { NO_SUBJECT } from '../conversations/ingest/constants';
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

async function seedConversation(
  t: T,
  organizationId: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert('conversations', {
      organizationId,
      subject: 'CV',
      status: 'open',
      channel: 'email',
      ...fields,
    }),
  );
}

async function seedContact(
  t: T,
  organizationId: string,
  name: string,
): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert('contacts', {
      organizationId,
      name,
      source: 'manual_import',
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

    expect(await read(t, ORG, 'blob_bound')).toMatchObject({
      conversationId,
      subject: 'CV',
    });
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
    expect(await read(t, OTHER_ORG, 'blob_foreign')).toMatchObject({
      conversationId: foreign,
    });
  });

  it("carries the mail's subject and correspondent as retrieval context", async () => {
    // A CV named for its author says nothing about the role it was sent for.
    // The subject line usually does, and the header is both embedded and
    // keyword-indexed, so this is what makes the attachment findable by role.
    const t = convexTest(schema, modules);
    const contactId = await seedContact(t, ORG, 'Hiring Inbox');
    const conversationId = await seedConversation(t, ORG, {
      subject: 'Application — Field Sales Agent',
      contactId,
    });
    await seedAttachment(t, {
      organizationId: ORG,
      storageId: 'blob_ctx',
      conversationId,
    });

    expect(await read(t, ORG, 'blob_ctx')).toEqual({
      conversationId,
      subject: 'Application — Field Sales Agent',
      correspondent: 'Hiring Inbox',
    });
  });

  it('never reports the no-subject placeholder as a subject', async () => {
    // `(no subject)` is a STORED value, not a render-time fallback. Indexing it
    // would put the placeholder into the search corpus as if it were prose.
    const t = convexTest(schema, modules);
    const conversationId = await seedConversation(t, ORG, {
      subject: NO_SUBJECT,
    });
    await seedAttachment(t, {
      organizationId: ORG,
      storageId: 'blob_nosubj',
      conversationId,
    });

    expect(await read(t, ORG, 'blob_nosubj')).toEqual({ conversationId });
  });

  it('still binds when the conversation is gone, dropping only the context', async () => {
    // Scope depends on the id; the subject and correspondent are enrichment.
    // A dangling conversation must not cost the binding.
    const t = convexTest(schema, modules);
    const conversationId = await seedConversation(t, ORG);
    await seedAttachment(t, {
      organizationId: ORG,
      storageId: 'blob_dangling',
      conversationId,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(conversationId as never);
    });

    expect(await read(t, ORG, 'blob_dangling')).toEqual({ conversationId });
  });

  it("never takes a correspondent name from another organization's contact", async () => {
    // A contact id is a reference, not a permission. Reading a foreign contact's
    // name would put it into this org's chunk header, where it becomes both
    // keyword-matchable and embedded.
    const t = convexTest(schema, modules);
    const foreignContact = await seedContact(t, OTHER_ORG, 'Foreign Contact');
    const conversationId = await seedConversation(t, ORG, {
      subject: 'Application',
      contactId: foreignContact,
    });
    await seedAttachment(t, {
      organizationId: ORG,
      storageId: 'blob_foreign_contact',
      conversationId,
    });

    expect(await read(t, ORG, 'blob_foreign_contact')).toEqual({
      conversationId,
      subject: 'Application',
    });
  });

  it('returns null for a storage id with no row', async () => {
    const t = convexTest(schema, modules);
    expect(await read(t, ORG, 'blob_missing')).toBeNull();
  });
});
