import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Convex codegen wrapper is unavailable in a unit test — passthrough the
// `action({...})` config so we can call its `handler` directly.
vi.mock('../_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
}));

// `listCatalogApps` is membership-gated; the gate itself is covered elsewhere,
// so stub it to a resolved member and focus this spec on the catalog
// projection/skip behaviour the discovery feature (#1979) added.
const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const { listCatalogApps } = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown[]>;
};
const listCatalogHandler = (listCatalogApps as unknown as ActionConfig).handler;

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

let catalogRoot: string;
let prevBuiltinDir: string | undefined;

async function writeApp(slug: string, manifest: string): Promise<void> {
  const dir = path.join(catalogRoot, 'apps', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'app.json'), manifest, 'utf8');
}

const ctx = {} as never;
const args = { organizationId: 'org_test' } as never;

beforeEach(async () => {
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'apps-catalog-'));
  prevBuiltinDir = process.env[BUILTIN_ENV];
  process.env[BUILTIN_ENV] = catalogRoot;
  mockRequireOrgMembershipById.mockReset();
  mockRequireOrgMembershipById.mockResolvedValue({
    orgId: 'org-123',
    orgSlug: 'default',
    userId: 'user-1',
    email: 'a@b.com',
    name: 'A',
    member: { _id: 'm-1', role: 'owner' },
  });
});

afterEach(async () => {
  if (prevBuiltinDir === undefined) delete process.env[BUILTIN_ENV];
  else process.env[BUILTIN_ENV] = prevBuiltinDir;
  await rm(catalogRoot, { recursive: true, force: true });
});

describe('listCatalogApps', () => {
  it('projects the summary fields of a valid catalog manifest', async () => {
    await writeApp(
      'issue-desk',
      JSON.stringify({
        name: 'Issue Desk',
        description: 'Triage and reconcile GitHub issues.',
        icon: 'inbox',
        messageNamespace: 'issueDesk',
        scope: 'project',
        workflows: ['reconcile'],
        agents: ['triager'],
        requires: {
          integrations: ['github'],
          config: [
            { key: 'repo', type: 'string', labelKey: 'issueDesk.config.repo' },
          ],
        },
        capabilities: {
          functions: [
            { path: 'apps/issue-desk/queries:listIssues', mode: 'query' },
          ],
        },
      }),
    );

    const apps = await listCatalogHandler(ctx, args);

    expect(mockRequireOrgMembershipById).toHaveBeenCalledWith(ctx, 'org_test');
    expect(apps).toEqual([
      {
        slug: 'issue-desk',
        name: 'Issue Desk',
        description: 'Triage and reconcile GitHub issues.',
        scope: 'project',
        icon: 'inbox',
        messageNamespace: 'issueDesk',
        workflows: ['reconcile'],
        agents: ['triager'],
        functions: [
          { path: 'apps/issue-desk/queries:listIssues', mode: 'query' },
        ],
        requiredIntegrations: ['github'],
        requiredConfig: [
          { key: 'repo', type: 'string', labelKey: 'issueDesk.config.repo' },
        ],
        // Catalog entries carry no view docs (views materialize per-install).
        views: [],
      },
    ]);
  });

  it('defaults the optional projection fields for a minimal manifest', async () => {
    await writeApp('minimal', JSON.stringify({ name: 'Minimal' }));

    const apps = await listCatalogHandler(ctx, args);

    expect(apps).toEqual([
      {
        slug: 'minimal',
        name: 'Minimal',
        description: '',
        // Absent manifest `scope` resolves to the org-level back-compat default.
        scope: 'org',
        workflows: [],
        agents: [],
        functions: [],
        requiredIntegrations: [],
        requiredConfig: [],
        views: [],
      },
    ]);
    // No optional keys leak onto the summary when the manifest omits them.
    const [app] = apps as Array<Record<string, unknown>>;
    expect(app).not.toHaveProperty('icon');
    expect(app).not.toHaveProperty('messageNamespace');
  });

  it('skips a malformed manifest without failing the whole catalog', async () => {
    // Valid app sorts AFTER the broken ones, so a non-fatal skip is observable.
    await writeApp('zeta-app', JSON.stringify({ name: 'Zeta' }));
    // Schema violation: `name` is required.
    await writeApp('no-name', JSON.stringify({ description: 'nameless' }));
    // Not even JSON.
    await writeApp('bad-json', '{ this is not json ');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apps = (await listCatalogHandler(ctx, args)) as Array<{
        slug: string;
      }>;
      expect(apps.map((a) => a.slug)).toEqual(['zeta-app']);
      // Each malformed app produced a skip warning (one per bad manifest).
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores directory entries whose name is not a valid app slug', async () => {
    await writeApp('good-app', JSON.stringify({ name: 'Good' }));
    // Uppercase + underscore — rejected by isValidAppSlug, never read.
    await writeApp('Invalid_Slug', JSON.stringify({ name: 'Nope' }));

    const apps = (await listCatalogHandler(ctx, args)) as Array<{
      slug: string;
    }>;
    expect(apps.map((a) => a.slug)).toEqual(['good-app']);
  });

  it('returns an empty list when the catalog dir is absent (ENOENT)', async () => {
    // catalogRoot exists but has no `apps/` child yet.
    const apps = await listCatalogHandler(ctx, args);
    expect(apps).toEqual([]);
  });

  it('sorts catalog apps by slug', async () => {
    await writeApp('beta', JSON.stringify({ name: 'Beta' }));
    await writeApp('alpha', JSON.stringify({ name: 'Alpha' }));
    await writeApp('gamma', JSON.stringify({ name: 'Gamma' }));

    const apps = (await listCatalogHandler(ctx, args)) as Array<{
      slug: string;
    }>;
    expect(apps.map((a) => a.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
