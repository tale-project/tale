// Deleting a hub folder must stop the OneDrive sync that feeds it, or the
// next sync run resurrects everything just deleted. convexTest (real
// in-memory DB) because the behaviour under test is index-filtered iteration.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../schema';
import { deactivateSyncConfigsForPath } from './deactivate_sync_configs';

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
});
