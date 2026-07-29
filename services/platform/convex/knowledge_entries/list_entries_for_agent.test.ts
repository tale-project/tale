// `listEntriesForAgent` serves the workspace bridge's knowledge_entry_find:
// only LIVE entries (active, chain not soft-deleted), only this org, projected
// to the agent-facing fields — superseded versions and tombstones are audit
// history and must never surface. Real table + index via convex-test.

import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import { buildModules } from '../migrations/framework/test_helpers';
import { knowledgeEntriesTable } from './schema';

const schema = defineSchema({ knowledgeEntries: knowledgeEntriesTable });
const modules = buildModules(
  import.meta.glob('../**/*.*s'),
  'knowledge_entries',
);

const ORG = 'org_1';

function entry(overrides: {
  topic: string;
  status?: 'active' | 'superseded';
  organizationId?: string;
  deletedAt?: number;
}) {
  return {
    organizationId: overrides.organizationId ?? ORG,
    topic: overrides.topic,
    topicKey: overrides.topic.toLowerCase(),
    content: `${overrides.topic} content`,
    status: overrides.status ?? ('active' as const),
    source: 'manual' as const,
    createdBy: 'u1',
    createdAt: 1,
    ...(overrides.deletedAt !== undefined
      ? { deletedAt: overrides.deletedAt }
      : {}),
  };
}

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('knowledgeEntries', entry({ topic: 'Refund policy' }));
    await ctx.db.insert('knowledgeEntries', entry({ topic: 'Shipping times' }));
    await ctx.db.insert(
      'knowledgeEntries',
      entry({ topic: 'Old refund rules', status: 'superseded' }),
    );
    await ctx.db.insert(
      'knowledgeEntries',
      entry({ topic: 'Deleted lore', deletedAt: 99 }),
    );
    await ctx.db.insert(
      'knowledgeEntries',
      entry({ topic: 'Other org secret', organizationId: 'org_2' }),
    );
  });
}

describe('listEntriesForAgent', () => {
  it('lists only this org’s live entries, projected for the agent', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await t.query(
      internal.knowledge_entries.internal_queries.listEntriesForAgent,
      { organizationId: ORG, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(result.page.map((e) => e.topic).sort()).toEqual([
      'Refund policy',
      'Shipping times',
    ]);
    expect(result.isDone).toBe(true);
    for (const item of result.page) {
      expect(Object.keys(item).sort()).toEqual([
        'content',
        'createdAt',
        'source',
        'topic',
      ]);
    }
  });

  it('topic is a case-insensitive contains-filter', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await t.query(
      internal.knowledge_entries.internal_queries.listEntriesForAgent,
      {
        organizationId: ORG,
        topic: 'REFUND',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((e) => e.topic)).toEqual(['Refund policy']);
  });

  it('pages through with continueCursor', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const first = await t.query(
      internal.knowledge_entries.internal_queries.listEntriesForAgent,
      { organizationId: ORG, paginationOpts: { numItems: 1, cursor: null } },
    );
    expect(first.page).toHaveLength(1);
    expect(first.isDone).toBe(false);
    const second = await t.query(
      internal.knowledge_entries.internal_queries.listEntriesForAgent,
      {
        organizationId: ORG,
        paginationOpts: { numItems: 20, cursor: first.continueCursor },
      },
    );
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(second.page[0]?.topic).not.toBe(first.page[0]?.topic);
  });
});
