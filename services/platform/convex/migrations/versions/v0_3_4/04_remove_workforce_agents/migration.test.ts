// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_90/05_remove_workforce_agents';

const ANALYST = JSON.stringify({ slug: 'analyst', supportedModels: [] });
const CHAT = JSON.stringify({ slug: 'assistant', supportedModels: [] });

// Harness ritual: real fleet up, destructive gating, handler idempotency over
// migrated state (a re-run finds no workforce/ folder), down restoring the
// deleted subtree byte-for-byte from the fs-tree snapshot.
defineMigrationTest({
  id: '0.3.4/04_remove_workforce_agents',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const agentsDir = path.join(root, orgs[0].slug, 'agents');
    await mkdir(path.join(agentsDir, 'workforce'), { recursive: true });
    await mkdir(path.join(agentsDir, 'chat'), { recursive: true });
    await writeFile(
      path.join(agentsDir, 'workforce', 'analyst.json'),
      ANALYST,
      'utf8',
    );
    await writeFile(
      path.join(agentsDir, 'chat', 'assistant.json'),
      CHAT,
      'utf8',
    );
    // org2 gets no agents dir: the missing-folder no-op path.
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const agentsDir = path.join(world.configRoot, org1.slug, 'agents');
    expect(
      await readFileSafe(path.join(agentsDir, 'workforce', 'analyst.json')),
    ).toBeNull();
    // Other agent folders are never touched.
    expect(
      await readFileSafe(path.join(agentsDir, 'chat', 'assistant.json')),
    ).toBe(CHAT);
  },
});
