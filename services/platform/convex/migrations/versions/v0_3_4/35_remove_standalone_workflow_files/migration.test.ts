// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/35_remove_standalone_workflow_files';

const WORKFLOW_JSON = JSON.stringify({
  steps: [
    {
      config: {},
      name: 'Start',
      nextSteps: {},
      stepSlug: 'start',
      stepType: 'start',
    },
  ],
});

// Harness ritual: destructive gate, idempotent up (an already-removed tree is
// a no-op), down restoring the whole workflows tree — files AND the
// `.history/` trail — from the fs snapshot byte-for-byte.
defineMigrationTest({
  id: '0.3.4/35_remove_standalone_workflow_files',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const wfDir = path.join(root, orgs[0].slug, 'workflows');
    await mkdir(path.join(wfDir, 'projects', 'tasks'), { recursive: true });
    await mkdir(path.join(wfDir, '.history', 'my-flow'), { recursive: true });
    await writeFile(
      path.join(wfDir, 'projects', 'tasks', 'run-assigned-task.json'),
      WORKFLOW_JSON,
      'utf8',
    );
    await writeFile(path.join(wfDir, 'my-flow.json'), WORKFLOW_JSON, 'utf8');
    await writeFile(
      path.join(wfDir, '.history', 'my-flow', '100.json'),
      WORKFLOW_JSON,
      'utf8',
    );
    // org2 has no workflows dir at all — the no-op path.
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const wfDir = path.join(world.configRoot, org1.slug, 'workflows');
    expect(
      await readFileSafe(
        path.join(wfDir, 'projects', 'tasks', 'run-assigned-task.json'),
      ),
    ).toBeNull();
    expect(await readFileSafe(path.join(wfDir, 'my-flow.json'))).toBeNull();
    expect(
      await readFileSafe(path.join(wfDir, '.history', 'my-flow', '100.json')),
    ).toBeNull();
  },
});
