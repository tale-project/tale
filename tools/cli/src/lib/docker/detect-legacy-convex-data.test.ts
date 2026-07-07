import { describe, expect, test } from 'bun:test';

import { findOrphanedConvexDataVolumes } from './detect-legacy-convex-data';

/** Injectable probe: `true` exactly for the given volume names. */
function existsOnly(...names: string[]) {
  const set = new Set(names);
  return (name: string) => Promise.resolve(set.has(name));
}

describe('findOrphanedConvexDataVolumes (P1-8, #1755)', () => {
  test('flags a pre-0.3.2 prod volume whose convex-data does not exist', async () => {
    const orphaned = await findOrphanedConvexDataVolumes(
      'myproj',
      existsOnly('myproj_platform-data'),
    );
    expect(orphaned).toEqual([
      { legacy: 'myproj_platform-data', target: 'myproj_convex-data' },
    ]);
  });

  test('stays silent once the destination volume exists', async () => {
    // Modern deploys pre-create convex-data (and keep a platform-data
    // stub), so an already-migrated or fresh project must not warn.
    const orphaned = await findOrphanedConvexDataVolumes(
      'myproj',
      existsOnly(
        'myproj_platform-data',
        'myproj_convex-data',
        'myproj-dev_platform-data',
        'myproj-dev_convex-data',
      ),
    );
    expect(orphaned).toEqual([]);
  });

  test('stays silent when no legacy volume exists at all', async () => {
    const orphaned = await findOrphanedConvexDataVolumes(
      'myproj',
      existsOnly(),
    );
    expect(orphaned).toEqual([]);
  });

  test('covers the dev scope independently of prod', async () => {
    const orphaned = await findOrphanedConvexDataVolumes(
      'myproj',
      existsOnly(
        'myproj_platform-data',
        'myproj_convex-data',
        'myproj-dev_platform-data',
      ),
    );
    expect(orphaned).toEqual([
      {
        legacy: 'myproj-dev_platform-data',
        target: 'myproj-dev_convex-data',
      },
    ]);
  });

  test('detects pre-0.2.33 fixed-name volumes against the current project', async () => {
    const orphaned = await findOrphanedConvexDataVolumes(
      'myproj',
      existsOnly('tale_platform-data', 'tale-dev_platform-data'),
    );
    expect(orphaned).toEqual([
      { legacy: 'tale_platform-data', target: 'myproj_convex-data' },
      { legacy: 'tale-dev_platform-data', target: 'myproj-dev_convex-data' },
    ]);
  });

  test('a project literally named tale reports each volume once', async () => {
    const orphaned = await findOrphanedConvexDataVolumes(
      'tale',
      existsOnly('tale_platform-data'),
    );
    expect(orphaned).toEqual([
      { legacy: 'tale_platform-data', target: 'tale_convex-data' },
    ]);
  });
});
