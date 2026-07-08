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

// `listCatalogAutomations` is membership-gated; the gate itself is covered elsewhere,
// so stub it to a resolved member and focus this spec on the catalog
// projection/skip behaviour the discovery feature (#1979) added.
const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const mockOrgSlugFromId = vi.fn();
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromId: (...args: unknown[]) => mockOrgSlugFromId(...args),
}));

const {
  listCatalogAutomations,
  listCatalogAutomationsForAssistant,
  getAutomationSummariesBySlug,
} = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown[]>;
};
const listCatalogHandler = (listCatalogAutomations as unknown as ActionConfig)
  .handler;
const listForAssistantHandler = (
  listCatalogAutomationsForAssistant as unknown as ActionConfig
).handler;
const getSummariesHandler = (
  getAutomationSummariesBySlug as unknown as ActionConfig
).handler;

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';
const CONFIG_ENV = 'TALE_CONFIG_DIR';
const ORG_SLUG = 'org-slug-1';

let catalogRoot: string;
let configRoot: string;
let prevBuiltinDir: string | undefined;
let prevConfigDir: string | undefined;

async function writeAutomation(slug: string, manifest: string): Promise<void> {
  const dir = path.join(catalogRoot, 'automations', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), manifest, 'utf8');
}

async function writeOrgAutomation(
  slug: string,
  manifest: string,
): Promise<void> {
  const dir = path.join(configRoot, ORG_SLUG, 'automations', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), manifest, 'utf8');
}

/** A BUNDLE dir ships `bundle.json` (the marker the loader detects) instead of
 *  `automation.json`. */
async function writeBundle(slug: string, manifest: string): Promise<void> {
  const dir = path.join(catalogRoot, 'automations', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'bundle.json'), manifest, 'utf8');
}

const ctx = {} as never;
const args = { organizationId: 'org_test' } as never;

beforeEach(async () => {
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'automations-catalog-'));
  configRoot = await mkdtemp(path.join(tmpdir(), 'automations-config-'));
  prevBuiltinDir = process.env[BUILTIN_ENV];
  prevConfigDir = process.env[CONFIG_ENV];
  process.env[BUILTIN_ENV] = catalogRoot;
  process.env[CONFIG_ENV] = configRoot;
  mockRequireOrgMembershipById.mockReset();
  mockRequireOrgMembershipById.mockResolvedValue({
    orgId: 'org-123',
    orgSlug: 'default',
    userId: 'user-1',
    email: 'a@b.com',
    name: 'A',
    member: { _id: 'm-1', role: 'owner' },
  });
  mockOrgSlugFromId.mockReset();
  mockOrgSlugFromId.mockResolvedValue(ORG_SLUG);
});

afterEach(async () => {
  if (prevBuiltinDir === undefined) delete process.env[BUILTIN_ENV];
  else process.env[BUILTIN_ENV] = prevBuiltinDir;
  if (prevConfigDir === undefined) delete process.env[CONFIG_ENV];
  else process.env[CONFIG_ENV] = prevConfigDir;
  await rm(catalogRoot, { recursive: true, force: true });
  await rm(configRoot, { recursive: true, force: true });
});

describe('listCatalogAutomations', () => {
  it('projects the summary fields of a valid catalog manifest', async () => {
    await writeAutomation(
      'issue-desk',
      JSON.stringify({
        name: 'Issue Desk',
        description: 'Triage and reconcile GitHub issues.',
        icon: 'inbox',
        folder: 'github/issues',
        i18n: { de: { name: 'Issue-Schreibtisch' } },
        scope: 'project',
        workflow: { name: 'Reconcile', steps: [] },
        agents: ['triager'],
        requires: {
          integrations: ['github'],
          config: [{ key: 'repo', type: 'string', labelKey: 'config.repo' }],
        },
        capabilities: {
          functions: [
            { path: 'apps/issue-desk/queries:listIssues', mode: 'query' },
          ],
        },
      }),
    );

    const automations = await listCatalogHandler(ctx, args);

    expect(mockRequireOrgMembershipById).toHaveBeenCalledWith(ctx, 'org_test');
    expect(automations).toEqual([
      {
        slug: 'issue-desk',
        name: 'Issue Desk',
        description: 'Triage and reconcile GitHub issues.',
        scope: 'project',
        icon: 'inbox',
        folder: 'github/issues',
        i18n: { de: { name: 'Issue-Schreibtisch' } },
        kind: 'automation',
        workflows: ['issue-desk'],
        agents: ['triager'],
        skills: [],
        functions: [
          { path: 'apps/issue-desk/queries:listIssues', mode: 'query' },
        ],
        requiredIntegrations: ['github'],
        // Catalog entries carry no view docs (views materialize per-install).
        views: [],
      },
    ]);
  });

  it('projects the bundled icon.svg as a data URI and the manifest labels', async () => {
    await writeAutomation(
      'reply-gmail-emails',
      JSON.stringify({
        name: 'Reply to Gmail emails',
        icon: 'mail',
        labels: ['Email', 'Gmail'],
        requires: { integrations: ['gmail'] },
      }),
    );
    await writeFile(
      path.join(catalogRoot, 'automations', 'reply-gmail-emails', 'icon.svg'),
      '<svg></svg>',
      'utf8',
    );

    const automations = (await listCatalogHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;

    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({
      slug: 'reply-gmail-emails',
      labels: ['Email', 'Gmail'],
      iconUrl: `data:image/svg+xml;base64,${Buffer.from('<svg></svg>').toString('base64')}`,
    });
  });

  it('omits iconUrl when the bundle has no icon.svg', async () => {
    await writeAutomation('no-icon', JSON.stringify({ name: 'No Icon' }));

    const automations = (await listCatalogHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;

    expect(automations[0]).not.toHaveProperty('iconUrl');
    expect(automations[0]).not.toHaveProperty('labels');
  });

  it('defaults the optional projection fields for a minimal manifest', async () => {
    await writeAutomation('minimal', JSON.stringify({ name: 'Minimal' }));

    const automations = await listCatalogHandler(ctx, args);

    expect(automations).toEqual([
      {
        slug: 'minimal',
        name: 'Minimal',
        description: '',
        // Absent manifest `scope` resolves to the org-level back-compat default.
        scope: 'org',
        kind: 'automation',
        workflows: [],
        agents: [],
        skills: [],
        functions: [],
        requiredIntegrations: [],
        views: [],
      },
    ]);
    // No optional keys leak onto the summary when the manifest omits them.
    const [entry] = automations as Array<Record<string, unknown>>;
    expect(entry).not.toHaveProperty('icon');
    expect(entry).not.toHaveProperty('folder');
    expect(entry).not.toHaveProperty('i18n');
  });

  it('skips a malformed manifest without failing the whole catalog', async () => {
    // Valid automation sorts AFTER the broken ones, so a non-fatal skip is observable.
    await writeAutomation('zeta-automation', JSON.stringify({ name: 'Zeta' }));
    // Schema violation: `name` is required.
    await writeAutomation(
      'no-name',
      JSON.stringify({ description: 'nameless' }),
    );
    // Not even JSON.
    await writeAutomation('bad-json', '{ this is not json ');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const automations = (await listCatalogHandler(ctx, args)) as Array<{
        slug: string;
      }>;
      expect(automations.map((a) => a.slug)).toEqual(['zeta-automation']);
      // Each malformed automation produced a skip warning (one per bad manifest).
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores directory entries whose name is not a valid automation slug', async () => {
    await writeAutomation('good-automation', JSON.stringify({ name: 'Good' }));
    // Uppercase + underscore — rejected by isValidAutomationSlug, never read.
    await writeAutomation('Invalid_Slug', JSON.stringify({ name: 'Nope' }));

    const automations = (await listCatalogHandler(ctx, args)) as Array<{
      slug: string;
    }>;
    expect(automations.map((a) => a.slug)).toEqual(['good-automation']);
  });

  it('returns an empty list when the catalog dir is absent (ENOENT)', async () => {
    // catalogRoot exists but has no `automations/` child yet.
    const automations = await listCatalogHandler(ctx, args);
    expect(automations).toEqual([]);
  });

  it('sorts catalog automations by slug', async () => {
    await writeAutomation('beta', JSON.stringify({ name: 'Beta' }));
    await writeAutomation('alpha', JSON.stringify({ name: 'Alpha' }));
    await writeAutomation('gamma', JSON.stringify({ name: 'Gamma' }));

    const automations = (await listCatalogHandler(ctx, args)) as Array<{
      slug: string;
    }>;
    expect(automations.map((a) => a.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('filters out a hidden manifest (a bundle member)', async () => {
    await writeAutomation(
      'visible-automation',
      JSON.stringify({ name: 'Visible' }),
    );
    await writeAutomation(
      'hidden-member',
      JSON.stringify({ name: 'Hidden', hidden: true }),
    );

    const automations = (await listCatalogHandler(ctx, args)) as Array<{
      slug: string;
    }>;
    expect(automations.map((a) => a.slug)).toEqual(['visible-automation']);
  });

  it('projects kind: bundle + members for a bundle.json manifest', async () => {
    await writeBundle(
      'email-bundle',
      JSON.stringify({
        name: 'Email',
        bundle: { members: ['reply-gmail-emails', 'reply-outlook-emails'] },
      }),
    );
    await writeAutomation(
      'plain-automation',
      JSON.stringify({ name: 'Plain' }),
    );

    const automations = (await listCatalogHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;
    const bundle = automations.find((a) => a.slug === 'email-bundle');
    const plain = automations.find((a) => a.slug === 'plain-automation');
    expect(bundle).toMatchObject({
      kind: 'bundle',
      members: ['reply-gmail-emails', 'reply-outlook-emails'],
    });
    expect(plain).toMatchObject({ kind: 'automation' });
    expect(plain).not.toHaveProperty('members');
  });
});

describe('listCatalogAutomationsForAssistant', () => {
  it('unions the catalog with org-installed automations and INCLUDES hidden manifests', async () => {
    await writeAutomation(
      'catalog-only',
      JSON.stringify({ name: 'Catalog Only' }),
    );
    await writeAutomation(
      'hidden-member',
      JSON.stringify({ name: 'Hidden Member', hidden: true }),
    );
    await writeOrgAutomation('org-only', JSON.stringify({ name: 'Org Only' }));

    const automations = (await listForAssistantHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;
    const slugs = automations
      .map((a) => String(a.slug))
      .sort((a, b) => a.localeCompare(b));
    expect(slugs).toEqual(['catalog-only', 'hidden-member', 'org-only']);

    const hidden = automations.find((a) => a.slug === 'hidden-member');
    expect(hidden).toMatchObject({ hidden: true, kind: 'automation' });
    const catalogOnly = automations.find((a) => a.slug === 'catalog-only');
    expect(catalogOnly).toMatchObject({ hidden: false });
  });

  it('lets an org-installed manifest win over a catalog entry of the same slug', async () => {
    await writeAutomation(
      'shared-slug',
      JSON.stringify({ name: 'Catalog Version' }),
    );
    await writeOrgAutomation(
      'shared-slug',
      JSON.stringify({ name: 'Org Version' }),
    );

    const automations = (await listForAssistantHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;
    expect(automations).toEqual([
      expect.objectContaining({ name: 'Org Version' }),
    ]);
  });

  it('projects kind: bundle + members for the assistant read too', async () => {
    await writeBundle(
      'email-bundle',
      JSON.stringify({
        name: 'Email',
        bundle: { members: ['reply-gmail-emails'] },
      }),
    );

    const automations = (await listForAssistantHandler(ctx, args)) as Array<
      Record<string, unknown>
    >;
    expect(automations).toEqual([
      expect.objectContaining({
        kind: 'bundle',
        members: ['reply-gmail-emails'],
      }),
    ]);
  });
});

describe('getAutomationSummariesBySlug', () => {
  it('returns name + description for HIDDEN slugs, gated by org membership only', async () => {
    await writeAutomation(
      'reply-gmail-emails',
      JSON.stringify({
        name: 'Reply to Gmail emails',
        description: 'Read, triage, and reply to Gmail.',
        hidden: true,
        requires: { integrations: ['gmail'] },
      }),
    );
    await writeAutomation(
      'reply-outlook-emails',
      JSON.stringify({ name: 'Outlook' }),
    );

    const summaries = await getSummariesHandler(ctx, {
      organizationId: 'org_test',
      slugs: ['reply-gmail-emails', 'reply-outlook-emails'],
    } as never);

    expect(mockRequireOrgMembershipById).toHaveBeenCalledWith(ctx, 'org_test');
    expect(summaries).toEqual([
      {
        slug: 'reply-gmail-emails',
        name: 'Reply to Gmail emails',
        description: 'Read, triage, and reply to Gmail.',
        requiredIntegrations: ['gmail'],
      },
      {
        slug: 'reply-outlook-emails',
        name: 'Outlook',
        description: '',
        requiredIntegrations: [],
      },
    ]);
  });

  it('skips an unresolvable slug rather than failing the whole batch', async () => {
    await writeAutomation(
      'reply-gmail-emails',
      JSON.stringify({ name: 'Gmail' }),
    );

    const summaries = await getSummariesHandler(ctx, {
      organizationId: 'org_test',
      slugs: ['reply-gmail-emails', 'does-not-exist'],
    } as never);

    expect(summaries).toEqual([
      {
        slug: 'reply-gmail-emails',
        name: 'Gmail',
        description: '',
        requiredIntegrations: [],
      },
    ]);
  });

  it('ignores an invalid slug string', async () => {
    const summaries = await getSummariesHandler(ctx, {
      organizationId: 'org_test',
      slugs: ['Invalid_Slug'],
    } as never);
    expect(summaries).toEqual([]);
  });
});
