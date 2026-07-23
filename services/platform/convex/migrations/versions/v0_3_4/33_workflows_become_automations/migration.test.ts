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

// Phase-0's real `seedDomain` (`organizations/scaffold.ts`) refuses every
// `scaffoldKind` but `flat` — `automations` is `scaffoldKind: 'bundle'`
// (`legacy/frozen/config_domains.ts`), so it throws unconditionally, by
// design (see that file's own doc comment: "the only caller that can
// currently reach a non-flat domain is the pre-rewrite v0_3_4/33 migration
// ... failing loud there is correct"). This migration's OWN test still needs
// to exercise its "catalog seeded in" path, so this mock restores JUST the
// bundle-copy behaviour `up()` needs — a recursive merge-copy from the
// catalog onto the org's automations dir (an existing org-authored bundle at
// a path the catalog doesn't have, e.g. `org-own`, is left untouched, same
// override contract the pre-rewrite `seedDomain` implemented for
// `scaffoldKind: 'bundle'`). Precedent:
// `v0_3_4/02_install_email_apps/migration.test.ts` mocks
// `automations/install_actions` the same way, for the same reason (a gutted
// dependency, not this migration's own logic).
vi.mock('../../../../organizations/scaffold', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../../organizations/scaffold')>();
  const { cp } = await import('node:fs/promises');
  const { resolveAutomationsDir } =
    await import('../../../../legacy/frozen/automations_file_utils');
  return {
    ...original,
    seedDomain: async (
      domain: { name: string },
      catalogRoot: string,
      orgSlug: string,
    ) => {
      const sourceDir = path.join(catalogRoot, domain.name);
      const targetDir = resolveAutomationsDir(orgSlug);
      await cp(sourceDir, targetDir, { recursive: true, force: true }).catch(
        (err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
        },
      );
      return { domain: domain.name, ok: true };
    },
  };
});

// The wrap-org-authored-workflows half of `up()` enumerates the org's
// workflows dir via `listCatalogArea('workflows', orgSlug, {...})`
// (`lib/config_store/catalog.ts`), which resolves the domain dir through
// `lib/config_store/resolvers.ts`'s `DOMAIN_DIR_RESOLVERS` — Phase-0-minimal
// (`governance`/`sso`/`prompts` only), so it throws `No directory resolver
// registered for config domain: workflows` for every org. `up()` swallows
// that error (`catch { return; }`, written for the "no workflows dir yet"
// case), silently no-opping the wrap step. This mock adds back JUST the
// `workflows` → `resolveWorkflowsDir` mapping (the same frozen legacy path
// helper `v0_3_4/06`'s migration.ts already uses) so `listCatalogArea` finds
// the seeded dir; every other domain still resolves through the real
// registry.
vi.mock('../../../../lib/config_store/resolvers', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../../../../lib/config_store/resolvers')
    >();
  const { resolveWorkflowsDir } =
    await import('../../../../legacy/frozen/workflows_file_utils');
  return {
    ...original,
    resolveDomainDir: (domain: string, orgSlug: string) =>
      domain === 'workflows'
        ? resolveWorkflowsDir(orgSlug)
        : original.resolveDomainDir(domain, orgSlug),
  };
});

const DIR = 'migrations/versions/v0_3_4/33_workflows_become_automations';

// `up` seeds from the builtin catalog. Point the env at a MINI catalog — two
// real bundles copied from a committed fixture — instead of all ~29: the
// ritual re-seeds per phase and per org, and the full catalog's I/O starves
// the parallel suite's other workers (vitest isolates env per file). The repo
// root `builtin-configs/` catalog was retired with the rest of the old
// backend; `testing/fixtures/builtin-catalog/` is a
// faithful copy of just the two bundles this test touches.
const REAL_BUILTIN = fileURLToPath(
  new URL('../../../testing/fixtures/builtin-catalog', import.meta.url),
);
const MINI_CATALOG = mkdtempSync(path.join(tmpdir(), 'wf33-catalog-'));
mkdirSync(path.join(MINI_CATALOG, 'automations'), { recursive: true });
for (const slug of ['projects/tasks/run-assigned', 'gmail/sync-emails']) {
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
        path.join(autoDir, 'projects/tasks/run-assigned', 'automation.json'),
      ),
    ).not.toBeNull();
    const gmail = await readFileSafe(
      path.join(autoDir, 'gmail/sync-emails', 'automation.json'),
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
