// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/34_retire_github_pack_agents';

const AGENT_JSON = JSON.stringify({ metadata: { labels: ['Triage'] } });

// Harness ritual: destructive gate, idempotent up (missing dirs are no-ops),
// down restoring the agents tree from the fs snapshot byte-for-byte.
defineMigrationTest({
  id: '0.3.4/34_retire_github_pack_agents',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const agentsDir = path.join(root, orgs[0].slug, 'agents');
    await mkdir(path.join(agentsDir, 'github'), { recursive: true });
    await mkdir(path.join(agentsDir, 'workforce'), { recursive: true });
    await mkdir(path.join(agentsDir, 'chat'), { recursive: true });
    await writeFile(
      path.join(agentsDir, 'github', 'issue-triager.json'),
      AGENT_JSON,
      'utf8',
    );
    await writeFile(
      path.join(agentsDir, 'workforce', 'software-developer.json'),
      AGENT_JSON,
      'utf8',
    );
    await writeFile(
      path.join(agentsDir, 'chat', 'assistant.json'),
      AGENT_JSON,
      'utf8',
    );
    // org2: agents dir without the retired folders (the no-op path).
    await mkdir(path.join(root, orgs[1].slug, 'agents', 'chat'), {
      recursive: true,
    });
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const agentsDir = path.join(world.configRoot, org1.slug, 'agents');
    expect(
      await readFileSafe(path.join(agentsDir, 'github', 'issue-triager.json')),
    ).toBeNull();
    expect(
      await readFileSafe(
        path.join(agentsDir, 'workforce', 'software-developer.json'),
      ),
    ).toBeNull();
    expect(
      await readFileSafe(path.join(agentsDir, 'chat', 'assistant.json')),
    ).not.toBeNull();
  },
});
