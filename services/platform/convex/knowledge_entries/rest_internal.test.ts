// @vitest-environment node

/**
 * The API key's half of the knowledge-entry store, against the real tables.
 *
 * The version chain is the thing worth proving: an update inserts a NEW active
 * row, marks the old one superseded, and — on a topic rename — re-keys the whole
 * chain so history follows the entry. And an entry from another organization is
 * not editable or deletable by id: it reads as NOT FOUND, so a guessed id
 * reveals nothing.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

// The org-keyed knowledge:mutate limit is asserted by its own suite; here it
// would only drag the rate-limiter component into every case.
vi.mock('../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(),
}));

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'knowledge_entries';
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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_entries_a';
const OTHER_ORG = 'org_entries_b';
const KEY_USER = 'user_key_holder';

type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('expected the call to be refused, but it resolved');
    },
    (error: unknown) => error,
  );
}

async function create(
  t: T,
  organizationId: string,
  topic: string,
  content = 'body',
): Promise<Id<'knowledgeEntries'>> {
  return await t.mutation(
    internal.knowledge_entries.rest_api.restCreateKnowledgeEntry,
    { organizationId, createdBy: KEY_USER, topic, content },
  );
}

async function rows(t: T): Promise<Doc<'knowledgeEntries'>[]> {
  return await t.run(
    async (ctx) => await ctx.db.query('knowledgeEntries').collect(),
  );
}

describe('restCreateKnowledgeEntry', () => {
  it('creates an active entry and refuses a duplicate topic', async () => {
    const t = newWorld();
    const entryId = await create(t, ORG, 'Refund policy');
    expect(
      await t.query(internal.knowledge_entries.rest_api.restGetKnowledgeEntry, {
        organizationId: ORG,
        entryId,
      }),
    ).toMatchObject({
      topic: 'Refund policy',
      status: 'active',
      source: 'manual',
      createdBy: KEY_USER,
    });

    const error = await rejection(create(t, ORG, ' refund   POLICY '));
    expect(codeOf(error)).toBe('KNOWLEDGE_ENTRY_DUPLICATE');
  });

  it('lets a different organization hold the same topic', async () => {
    const t = newWorld();
    await create(t, ORG, 'Refund policy');
    await expect(create(t, OTHER_ORG, 'Refund policy')).resolves.toBeDefined();
    expect(await rows(t)).toHaveLength(2);
  });

  it('refuses empty and over-long fields', async () => {
    const t = newWorld();
    expect(codeOf(await rejection(create(t, ORG, '   ')))).toBe(
      'KNOWLEDGE_ENTRY_TOPIC_REQUIRED',
    );
    expect(codeOf(await rejection(create(t, ORG, 'Topic', '  ')))).toBe(
      'KNOWLEDGE_ENTRY_CONTENT_REQUIRED',
    );
    expect(codeOf(await rejection(create(t, ORG, 'x'.repeat(200))))).toBe(
      'KNOWLEDGE_ENTRY_TOPIC_TOO_LONG',
    );
  });
});

describe('restUpdateKnowledgeEntry', () => {
  it('supersedes the old row and returns the new id', async () => {
    const t = newWorld();
    const first = await create(t, ORG, 'Refund policy', 'inside 30 days');

    const updated = await t.mutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Refund policy',
        content: 'inside 14 days',
      },
    );
    expect(updated.id).not.toBe(first);

    const all = await rows(t);
    expect(all).toHaveLength(2);
    const old = all.find((row) => row._id === first);
    expect(old).toMatchObject({
      status: 'superseded',
      supersededBy: updated.id,
    });
    expect(all.find((row) => row._id === updated.id)).toMatchObject({
      status: 'active',
      content: 'inside 14 days',
    });
  });

  it('re-keys the superseded chain when the topic is renamed', async () => {
    const t = newWorld();
    const first = await create(t, ORG, 'Refund policy');
    const second = await t.mutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Returns policy',
        content: 'renamed',
      },
    );
    const keys = new Set((await rows(t)).map((row) => row.topicKey));
    expect(keys).toEqual(new Set(['returns policy']));
    expect(second.id).toBeDefined();
  });

  it('refuses an entry of another organization as not found', async () => {
    const t = newWorld();
    const mine = await create(t, ORG, 'Refund policy');
    const error = await rejection(
      t.mutation(internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry, {
        organizationId: OTHER_ORG,
        updatedBy: KEY_USER,
        entryId: mine,
        topic: 'Hijacked',
        content: 'nope',
      }),
    );
    expect(codeOf(error)).toBe('KNOWLEDGE_ENTRY_NOT_FOUND');
    expect((await rows(t))[0].topic).toBe('Refund policy');
  });

  it('refuses editing a version that has already been superseded', async () => {
    const t = newWorld();
    const first = await create(t, ORG, 'Refund policy');
    await t.mutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Refund policy',
        content: 'v2',
      },
    );
    const error = await rejection(
      t.mutation(internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry, {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Refund policy',
        content: 'v3',
      }),
    );
    expect(codeOf(error)).toBe('KNOWLEDGE_ENTRY_NOT_ACTIVE');
  });

  it('refuses a rename onto another live topic', async () => {
    const t = newWorld();
    await create(t, ORG, 'Refund policy');
    const other = await create(t, ORG, 'Shipping policy');
    const error = await rejection(
      t.mutation(internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry, {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: other,
        topic: 'Refund policy',
        content: 'collides',
      }),
    );
    expect(codeOf(error)).toBe('KNOWLEDGE_ENTRY_DUPLICATE');
  });
});

describe('restDeleteKnowledgeEntry and restListKnowledgeEntries', () => {
  it('tombstones the whole chain and hides it from the listing', async () => {
    const t = newWorld();
    const first = await create(t, ORG, 'Refund policy');
    await t.mutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Refund policy',
        content: 'v2',
      },
    );

    await t.mutation(
      internal.knowledge_entries.rest_api.restDeleteKnowledgeEntry,
      { organizationId: ORG, entryId: first },
    );

    expect((await rows(t)).every((row) => row.deletedAt !== undefined)).toBe(
      true,
    );
    const listing = await t.query(
      internal.knowledge_entries.rest_api.restListKnowledgeEntries,
      { organizationId: ORG, cursor: null, limit: 10 },
    );
    expect(listing.page).toHaveLength(0);
  });

  it('refuses a delete across the organization line', async () => {
    const t = newWorld();
    const mine = await create(t, ORG, 'Refund policy');
    const error = await rejection(
      t.mutation(internal.knowledge_entries.rest_api.restDeleteKnowledgeEntry, {
        organizationId: OTHER_ORG,
        entryId: mine,
      }),
    );
    expect(codeOf(error)).toBe('KNOWLEDGE_ENTRY_NOT_FOUND');
    expect((await rows(t))[0].deletedAt).toBeUndefined();
  });

  /** Seed an entry + its backing document directly (no scheduled
   * materialization racing the test), with an optional controlled record. */
  async function seedBackedEntry(
    t: T,
    record?: Doc<'documents'>['record'],
  ): Promise<{
    entryId: Id<'knowledgeEntries'>;
    documentId: Id<'documents'>;
  }> {
    return await t.run(async (ctx) => {
      const documentId = await ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'SOP-7.md',
        sourceProvider: 'upload',
        createdBy: KEY_USER,
        ...(record !== undefined ? { record } : {}),
      });
      const entryId = await ctx.db.insert('knowledgeEntries', {
        organizationId: ORG,
        topic: 'SOP-7',
        topicKey: 'sop-7',
        content: 'body',
        status: 'active',
        documentId,
        source: 'manual',
        createdBy: KEY_USER,
        createdAt: 0,
      });
      return { entryId, documentId };
    });
  }

  it('refuses deleting an entry whose backing document is a controlled record — nothing tombstoned', async () => {
    // The scheduled pipeline (`deleteDocumentFromRag` → `deleteDocumentById`
    // without `callerOrgId`) never runs `assertRecordTrashable`; the REST
    // delete must gate synchronously with the typed code the ConvexError→HTTP
    // mapping turns into a 409.
    const t = newWorld();
    const { entryId, documentId } = await seedBackedEntry(t, {
      state: 'approved',
      version: 1,
      controlledAt: 0,
      controlledBy: KEY_USER,
      approvedAt: 1,
      approvedBy: KEY_USER,
      approvedVersions: [
        {
          version: 1,
          fileId: 's3:acme/sop-blob',
          approvedAt: 1,
          approvedBy: KEY_USER,
        },
      ],
    });

    const error = await rejection(
      t.mutation(internal.knowledge_entries.rest_api.restDeleteKnowledgeEntry, {
        organizationId: ORG,
        entryId,
      }),
    );
    expect(codeOf(error)).toBe('DOCUMENT_RECORD_PROTECTED');
    expect((await rows(t)).every((row) => row.deletedAt === undefined)).toBe(
      true,
    );
    const doc = await t.run((ctx) => ctx.db.get(documentId));
    expect(doc?.record?.state).toBe('approved');
  });

  it('still deletes an entry backed by an uncontrolled document', async () => {
    const t = newWorld();
    const { entryId } = await seedBackedEntry(t);

    await t.mutation(
      internal.knowledge_entries.rest_api.restDeleteKnowledgeEntry,
      { organizationId: ORG, entryId },
    );

    expect((await rows(t)).every((row) => row.deletedAt !== undefined)).toBe(
      true,
    );
  });

  it('lists only its own organization entries, and pages them', async () => {
    const t = newWorld();
    await create(t, ORG, 'One');
    await create(t, ORG, 'Two');
    await create(t, OTHER_ORG, 'Theirs');

    const first = await t.query(
      internal.knowledge_entries.rest_api.restListKnowledgeEntries,
      { organizationId: ORG, cursor: null, limit: 1 },
    );
    expect(first.page).toHaveLength(1);
    expect(first.isDone).toBe(false);

    const second = await t.query(
      internal.knowledge_entries.rest_api.restListKnowledgeEntries,
      { organizationId: ORG, cursor: first.continueCursor, limit: 5 },
    );
    const topics = [...first.page, ...second.page].map((row) => row.topic);
    expect(new Set(topics)).toEqual(new Set(['One', 'Two']));
  });

  it('reads a superseded page when asked for it', async () => {
    const t = newWorld();
    const first = await create(t, ORG, 'Refund policy');
    await t.mutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: ORG,
        updatedBy: KEY_USER,
        entryId: first,
        topic: 'Refund policy',
        content: 'v2',
      },
    );
    const superseded = await t.query(
      internal.knowledge_entries.rest_api.restListKnowledgeEntries,
      { organizationId: ORG, status: 'superseded', cursor: null, limit: 10 },
    );
    expect(superseded.page).toHaveLength(1);
    expect(superseded.page[0].id).toBe(first);
  });

  it('reads a malformed entry id as absent', async () => {
    const t = newWorld();
    expect(
      await t.query(internal.knowledge_entries.rest_api.restGetKnowledgeEntry, {
        organizationId: ORG,
        entryId: 'nonsense',
      }),
    ).toBeNull();
  });
});
