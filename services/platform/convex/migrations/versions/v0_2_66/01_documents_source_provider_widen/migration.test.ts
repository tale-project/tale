import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_66/01_documents_source_provider_widen';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// sourceProvider declared as open string so both literal + widened values
// validate (mirrors the post-widen schema).
const fixtureSchema = defineSchema({
  documents: defineTable({
    organizationId: v.string(),
    sourceProvider: v.optional(v.string()),
  }).index('by_org', ['organizationId']),
});

describe('0.2.66/01 documents_source_provider_widen (reference)', () => {
  it('up is a no-op; down coerces unknown providers to a safe old literal', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('documents', {
        organizationId: 'org_1',
        sourceProvider: 'onedrive', // in old set — must survive down unchanged
      });
      await ctx.db.insert('documents', {
        organizationId: 'org_1',
        sourceProvider: 'google_drive', // post-widen slug — down must coerce
      });
    });

    // up: no-op, values untouched
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('documents').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('documents').collect());
    expect(
      rows
        .map((r) => r.sourceProvider)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['google_drive', 'onedrive']);

    // down: old literal preserved, unknown slug coerced to 'upload'
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('documents').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('documents').collect());
    expect(
      rows
        .map((r) => r.sourceProvider)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['onedrive', 'upload']);

    // down again is a no-op (both now in the old set)
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('documents').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('documents').collect());
    expect(
      rows
        .map((r) => r.sourceProvider)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['onedrive', 'upload']);
  });
});
