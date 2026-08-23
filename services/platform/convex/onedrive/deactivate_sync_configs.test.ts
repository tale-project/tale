// Deleting a hub folder must stop the OneDrive sync that feeds it, or the
// next sync run resurrects everything just deleted. convexTest (real
// in-memory DB) because the behaviour under test is index-filtered iteration.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  deactivateSyncConfigById,
  deactivateSyncConfigsForPath,
  stopSyncForDeletedDocument,
} from './deactivate_sync_configs';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/onedrive/, mirror sandbox/admission.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'onedrive';
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

type T = TestConvex<typeof schema>;

const ORG = 'org_sync';

async function seedConfig(
  t: T,
  itemPath: string,
  status: 'active' | 'inactive' = 'active',
  organizationId = ORG,
) {
  return await t.run((ctx) =>
    ctx.db.insert('onedriveSyncConfigs', {
      organizationId,
      userId: 'user-1',
      itemType: 'folder',
      itemId: `od-${itemPath}`,
      itemName: itemPath.split('/').pop() ?? itemPath,
      itemPath,
      targetBucket: 'documents',
      status,
    }),
  );
}

describe('deactivateSyncConfigsForPath', () => {
  it('deactivates configs at and below the deleted folder path', async () => {
    const t = convexTest(schema, modules);
    const exactId = await seedConfig(t, 'Meetings');
    const nestedId = await seedConfig(t, 'Meetings/2026');
    const siblingId = await seedConfig(t, 'MeetingsArchive');

    const deactivated = await t.run((ctx) =>
      deactivateSyncConfigsForPath(ctx, ORG, 'Meetings'),
    );

    expect(deactivated).toBe(2);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(exactId))?.status).toBe('inactive');
      expect((await ctx.db.get(nestedId))?.status).toBe('inactive');
      // Prefix match is per path segment — a sibling sharing the string
      // prefix must survive.
      expect((await ctx.db.get(siblingId))?.status).toBe('active');
    });
  });

  it('never touches another organization', async () => {
    const t = convexTest(schema, modules);
    const otherOrgId = await seedConfig(t, 'Meetings', 'active', 'org_other');

    const deactivated = await t.run((ctx) =>
      deactivateSyncConfigsForPath(ctx, ORG, 'Meetings'),
    );

    expect(deactivated).toBe(0);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(otherOrgId))?.status).toBe('active');
    });
  });

  it('deactivates Google Drive configs at and below the deleted folder path', async () => {
    const t = convexTest(schema, modules);
    const exactId = await t.run((ctx) =>
      ctx.db.insert('googleDriveSyncConfigs', {
        organizationId: ORG,
        userId: 'user-1',
        itemType: 'folder',
        itemId: 'gd-Meetings',
        itemName: 'Meetings',
        itemPath: 'Meetings',
        targetBucket: 'documents',
        status: 'active',
      }),
    );
    const siblingId = await t.run((ctx) =>
      ctx.db.insert('googleDriveSyncConfigs', {
        organizationId: ORG,
        userId: 'user-1',
        itemType: 'folder',
        itemId: 'gd-Archive',
        itemName: 'MeetingsArchive',
        itemPath: 'MeetingsArchive',
        targetBucket: 'documents',
        status: 'active',
      }),
    );

    const deactivated = await t.run((ctx) =>
      deactivateSyncConfigsForPath(ctx, ORG, 'Meetings'),
    );

    expect(deactivated).toBe(1);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(exactId))?.status).toBe('inactive');
      expect((await ctx.db.get(siblingId))?.status).toBe('active');
    });
  });
});

describe('deactivateSyncConfigById', () => {
  it('flips an active config to inactive', async () => {
    const t = convexTest(schema, modules);
    const id = await seedConfig(t, 'Document 1.docx');

    const flipped = await t.run((ctx) =>
      deactivateSyncConfigById(ctx, ORG, id),
    );

    expect(flipped).toBe(true);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(id))?.status).toBe('inactive');
    });
  });

  it('is a no-op for another org, an already-inactive, or a missing config', async () => {
    const t = convexTest(schema, modules);
    const otherOrg = await seedConfig(t, 'X', 'active', 'org_other');
    const already = await seedConfig(t, 'Y', 'inactive');

    await t.run(async (ctx) => {
      expect(await deactivateSyncConfigById(ctx, ORG, otherOrg)).toBe(false);
      expect(await deactivateSyncConfigById(ctx, ORG, already)).toBe(false);
      expect(
        await deactivateSyncConfigById(
          ctx,
          ORG,
          'nonexistent' as Id<'onedriveSyncConfigs'>,
        ),
      ).toBe(false);
      expect((await ctx.db.get(otherOrg))?.status).toBe('active');
    });
  });
});

describe('stopSyncForDeletedDocument', () => {
  it('stops the sync for a directly-selected single-file doc', async () => {
    const t = convexTest(schema, modules);
    const configId = await seedConfig(t, 'Document 1.docx');

    const stopped = await t.run((ctx) =>
      stopSyncForDeletedDocument(ctx, {
        organizationId: ORG,
        metadata: {
          sourceMode: 'auto',
          isDirectlySelected: true,
          syncConfigId: configId,
        },
      }),
    );

    expect(stopped).toBe(true);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(configId))?.status).toBe('inactive');
    });
  });

  it('leaves a folder-member doc alone (would stop the whole folder)', async () => {
    const t = convexTest(schema, modules);
    const configId = await seedConfig(t, 'Meetings');

    const stopped = await t.run((ctx) =>
      stopSyncForDeletedDocument(ctx, {
        organizationId: ORG,
        metadata: {
          sourceMode: 'auto',
          isDirectlySelected: false,
          syncConfigId: configId,
        },
      }),
    );

    expect(stopped).toBe(false);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(configId))?.status).toBe('active');
    });
  });

  it('ignores manual uploads and docs with no sync config', async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      expect(
        await stopSyncForDeletedDocument(ctx, {
          organizationId: ORG,
          metadata: { sourceMode: 'manual', isDirectlySelected: true },
        }),
      ).toBe(false);
      expect(
        await stopSyncForDeletedDocument(ctx, {
          organizationId: ORG,
          metadata: {},
        }),
      ).toBe(false);
    });
  });
});
