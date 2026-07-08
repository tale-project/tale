import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/06_app_upload_claims_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const claimTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

const fixtureSchema = defineSchema({
  appUploadClaims: claimTable,
  automationUploadClaims: claimTable,
});

describe('0.2.93/06 app_upload_claims_table', () => {
  it('up copies rows; down restores', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('appUploadClaims', {
        organizationId: 'org_1',
        slug: 'inbox',
        claimedAt: 1,
        expiresAt: 2,
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appUploadClaims').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('appUploadClaims').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('automationUploadClaims').collect()),
    ).toHaveLength(1);

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('automationUploadClaims').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('automationUploadClaims').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('appUploadClaims').collect()),
    ).toHaveLength(1);
  });
});
