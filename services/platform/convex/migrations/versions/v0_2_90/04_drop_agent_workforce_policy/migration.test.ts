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

const DIR = 'migrations/versions/v0_2_90/04_drop_agent_workforce_policy';

const POLICY = JSON.stringify({ enabled: true, maxConcurrentRunsOrg: 10 });
const OTHER = JSON.stringify({ minLength: 14 });

// Harness ritual: real fleet up, destructive gating (refused without
// allowDestructive), handler idempotency over migrated state, down restoring
// the deleted file byte-for-byte from the fs-tree snapshot.
defineMigrationTest({
  id: '0.2.90/04_drop_agent_workforce_policy',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const govDir = path.join(root, orgs[0].slug, 'governance');
    await mkdir(govDir, { recursive: true });
    await writeFile(path.join(govDir, 'agent-workforce.json'), POLICY, 'utf8');
    await writeFile(path.join(govDir, 'password-policy.json'), OTHER, 'utf8');
    // org2 gets no governance dir: the missing-file no-op path.
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const govDir = path.join(world.configRoot, org1.slug, 'governance');
    expect(
      await readFileSafe(path.join(govDir, 'agent-workforce.json')),
    ).toBeNull();
    // Sibling policies are never touched.
    expect(await readFileSafe(path.join(govDir, 'password-policy.json'))).toBe(
      OTHER,
    );
  },
});
