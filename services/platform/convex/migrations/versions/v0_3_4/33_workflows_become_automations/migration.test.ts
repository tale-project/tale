// @vitest-environment node

import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/33_workflows_become_automations';

// `up` seeds from the builtin catalog. Point the env at a MINI catalog —
// two real bundles copied from the repo — instead of all ~29: the ritual
// re-seeds per phase and per org, and the full catalog's I/O starves the
// parallel suite's other workers (vitest isolates env per file).
const REAL_BUILTIN = fileURLToPath(
  new URL('../../../../../../../builtin-configs', import.meta.url),
);
const MINI_CATALOG = mkdtempSync(path.join(tmpdir(), 'wf33-catalog-'));
mkdirSync(path.join(MINI_CATALOG, 'automations'), { recursive: true });
for (const slug of ['run-assigned-task', 'reply-gmail-emails']) {
  cpSync(
    path.join(REAL_BUILTIN, 'automations', slug),
    path.join(MINI_CATALOG, 'automations', slug),
    { recursive: true },
  );
}
// Files sharing a vitest worker share process.env — scope the override to
// this file's lifecycle so neighbors never see the mini catalog.
const PREV_BUILTIN = process.env.TALE_CONFIG_BUILTIN_DIR;
beforeAll(() => {
  process.env.TALE_CONFIG_BUILTIN_DIR = MINI_CATALOG;
});
afterAll(() => {
  if (PREV_BUILTIN === undefined) delete process.env.TALE_CONFIG_BUILTIN_DIR;
  else process.env.TALE_CONFIG_BUILTIN_DIR = PREV_BUILTIN;
});

const EPOCH_WORKFLOW = JSON.stringify({
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

// Harness ritual: real fleet up, destructive gating, handler idempotency
// (re-seed is an override no-op; the wrap skips existing manifests), and down
// restoring the pre-migration automations tree from the fs snapshot.
defineMigrationTest({
  id: '0.3.4/33_workflows_become_automations',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }],

  async seedFs(root, orgs) {
    const orgRoot = path.join(root, orgs[0].slug);
    // A pre-existing ORG-AUTHORED automation the re-seed must preserve.
    await mkdir(path.join(orgRoot, 'automations', 'org-own'), {
      recursive: true,
    });
    await writeFile(
      path.join(orgRoot, 'automations', 'org-own', 'automation.json'),
      JSON.stringify({ name: 'Org own', scope: 'org' }),
      'utf8',
    );
    // The workflows tree 33 reads: one MAPPED slug (never wrapped — its
    // automation ships in the catalog), one CUSTOM slug (wrapped), one
    // INVALID file (left to the snapshot).
    const wfDir = path.join(orgRoot, 'workflows');
    await mkdir(path.join(wfDir, 'projects', 'tasks'), { recursive: true });
    await writeFile(
      path.join(wfDir, 'projects', 'tasks', 'triage-unassigned-tasks.json'),
      EPOCH_WORKFLOW,
      'utf8',
    );
    await writeFile(path.join(wfDir, 'my-flow.json'), EPOCH_WORKFLOW, 'utf8');
    await writeFile(
      path.join(wfDir, 'broken.json'),
      '{"steps": "nope"}',
      'utf8',
    );
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const autoDir = path.join(world.configRoot, org1.slug, 'automations');

    // Catalog automations seeded in (spot-check a pack member + email fold).
    expect(
      await readFileSafe(
        path.join(autoDir, 'run-assigned-task', 'automation.json'),
      ),
    ).not.toBeNull();
    const gmail = await readFileSafe(
      path.join(autoDir, 'reply-gmail-emails', 'automation.json'),
    );
    expect(gmail).not.toBeNull();
    expect(JSON.parse(gmail ?? '{}')).toHaveProperty('workflow');

    // Org-authored automation preserved by the override seed.
    expect(
      await readFileSafe(path.join(autoDir, 'org-own', 'automation.json')),
    ).not.toBeNull();

    // Custom standalone workflow wrapped; mapped + invalid ones are not.
    const wrapped = await readFileSafe(
      path.join(autoDir, 'my-flow', 'automation.json'),
    );
    expect(wrapped).not.toBeNull();
    const manifest = JSON.parse(wrapped ?? '{}') as {
      name?: string;
      scope?: string;
      workflow?: { steps?: unknown[] };
    };
    expect(manifest.name).toBe('my-flow');
    expect(manifest.scope).toBe('org');
    expect(manifest.workflow?.steps).toHaveLength(1);
    // The MAPPED workflows slug (triage) is deliberately NOT in the mini
    // catalog: the wrap must still skip it — mapped slugs never wrap.
    expect(
      await readFileSafe(path.join(autoDir, 'broken', 'automation.json')),
    ).toBeNull();

    // The workflows tree itself is untouched here — 35 removes it.
    expect(
      await readFileSafe(
        path.join(world.configRoot, org1.slug, 'workflows', 'my-flow.json'),
      ),
    ).not.toBeNull();
  },
});
