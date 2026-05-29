import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the codegen surface so `internalAction(config)` returns the config
// itself — that exposes `.handler` for direct invocation, matching the
// pattern used by agents/file_actions.test.ts.
vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

const { scaffoldNewOrganization, cleanupOrgFilesystem } =
  await import('./scaffold');

type ActionConfig = {
  handler: (
    ctx: never,
    args: { orgSlug: string; override?: boolean; strict?: boolean },
  ) => Promise<{
    ok: boolean;
    skipped: boolean;
    results: Array<{ domain: string; ok: boolean; error?: string }>;
  }>;
};
const scaffoldHandler = (scaffoldNewOrganization as unknown as ActionConfig)
  .handler;
const cleanupHandler = (cleanupOrgFilesystem as unknown as ActionConfig)
  .handler;

// Under org-first only TALE_CONFIG_DIR + TALE_CONFIG_BUILTIN_DIR remain;
// per-domain env overrides (AGENTS_DIR / WORKFLOWS_DIR / PROVIDERS_DIR /
// INTEGRATIONS_DIR / SKILLS_DIR) were dropped. Still save/restore the
// legacy keys defensively so a stale shell-env value can't leak across.
const ENV_KEYS = [
  'TALE_CONFIG_DIR',
  'TALE_CONFIG_BUILTIN_DIR',
  'AGENTS_DIR',
  'WORKFLOWS_DIR',
  'PROVIDERS_DIR',
  'INTEGRATIONS_DIR',
  'SKILLS_DIR',
] as const;

let configRoot: string;
let catalogRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  configRoot = await mkdtemp(path.join(tmpdir(), 'scaffold-cfg-'));
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'scaffold-cat-'));
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
  await rm(configRoot, { recursive: true, force: true });
  await rm(catalogRoot, { recursive: true, force: true });
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

// Catalog source path for a given domain — mirrors the org-first builtin
// layout (`<catalogRoot>/default/<domain>/...`) the scaffold reads from.
function catSrc(...parts: string[]): string {
  return path.join(catalogRoot, 'default', ...parts);
}

// Per-org target path — `<configRoot>/<orgSlug>/<domain>/...`.
function orgDst(orgSlug: string, ...parts: string[]): string {
  return path.join(configRoot, orgSlug, ...parts);
}

describe('scaffoldNewOrganization (org-first)', () => {
  it('seeds workflows from the catalog into the org-first target', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      catSrc('workflows', 'shopify', 'sync.json'),
      '{"name":"sync"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(
      existsSync(orgDst('acme', 'workflows', 'shopify', 'sync.json')),
    ).toBe(true);
  });

  it('seeds flat domains (agents) per-file from the catalog', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents', 'shipped.json'), '{"displayName":"x"}');

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'agents', 'shipped.json'))).toBe(true);
  });

  it('flat domains never recurse into catalog subdirs (defense if the catalog ever ships one)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents', 'shipped.json'), '{"displayName":"x"}');
    // A subdir inside the agents catalog is unexpected (agents is file-only).
    await writeText(
      catSrc('agents', 'stray', 'nested.json'),
      '{"displayName":"nested"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'agents', 'shipped.json'))).toBe(true);
    expect(existsSync(orgDst('acme', 'agents', 'stray'))).toBe(false);
  });

  it('skips symlinks in the catalog rather than following them', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    const evilPayloadDir = await mkdtemp(path.join(tmpdir(), 'scaffold-evil-'));
    const evilFile = path.join(evilPayloadDir, 'payload.json');
    await writeFile(evilFile, '{"name":"escaped"}', 'utf-8');

    await mkdir(catSrc('workflows'), { recursive: true });
    await symlink(evilFile, path.join(catSrc('workflows'), 'evil.json'));
    await writeText(catSrc('workflows', 'legit.json'), '{"name":"legit"}');

    try {
      await scaffoldHandler({} as never, { orgSlug: 'acme' });

      expect(existsSync(orgDst('acme', 'workflows', 'evil.json'))).toBe(false);
      expect(existsSync(orgDst('acme', 'workflows', 'legit.json'))).toBe(true);
    } finally {
      await rm(evilPayloadDir, { recursive: true, force: true });
    }
  });

  it('always skips *.secrets.json and .history/ at the catalog source', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('providers', 'openai.json'), '{"name":"openai"}');
    await writeText(
      catSrc('providers', 'openai.secrets.json'),
      '{"key":"redacted"}',
    );
    await writeText(catSrc('providers', '.history', 'snapshot.json'), '{}');

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'providers', 'openai.json'))).toBe(true);
    expect(existsSync(orgDst('acme', 'providers', 'openai.secrets.json'))).toBe(
      false,
    );
    expect(existsSync(orgDst('acme', 'providers', '.history'))).toBe(false);
  });

  it('is per-domain idempotent: a domain dir that already has files is skipped (override:false)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('workflows', 'shipped.json'), '{"name":"shipped"}');
    // Pre-existing org content — scaffold must not overwrite without override.
    await writeText(
      orgDst('acme', 'workflows', 'existing.json'),
      '{"name":"existing"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(
      await readFile(orgDst('acme', 'workflows', 'existing.json'), 'utf-8'),
    ).toBe('{"name":"existing"}');
    expect(existsSync(orgDst('acme', 'workflows', 'shipped.json'))).toBe(false);
  });

  it('treats a target containing only .history/ as occupied (no re-seed on top of user edit trail)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('workflows', 'shipped.json'), '{"name":"shipped"}');
    await writeText(
      orgDst('acme', 'workflows', '.history', 'old.json'),
      '{"snapshot":1}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'workflows', 'shipped.json'))).toBe(false);
    expect(
      existsSync(orgDst('acme', 'workflows', '.history', 'old.json')),
    ).toBe(true);
  });

  it('ignores atomicWrite tmp orphans so a crashed scaffold can retry', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('workflows', 'shipped.json'), '{"name":"shipped"}');
    // Simulate the residue a prior crashed scaffold would leave behind:
    // atomicWrite uses `.<basename>.<ts>.<uuid>.tmp` and cleans up on
    // success, but a crash mid-write leaves the tmp orphan in place.
    await writeText(
      orgDst('acme', 'workflows', '.shipped.json.1700000000000.deadbeef.tmp'),
      'partial',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'workflows', 'shipped.json'))).toBe(true);
  });

  it('logs error when TALE_CONFIG_BUILTIN_DIR points at a missing path (deploy misconfig)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = path.join(catalogRoot, 'missing');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await scaffoldHandler({} as never, { orgSlug: 'acme' });

      const calls = errSpy.mock.calls.map((c) => c.join(' '));
      expect(
        calls.some(
          (m) =>
            m.includes('TALE_CONFIG_BUILTIN_DIR') &&
            m.includes('does not exist'),
        ),
      ).toBe(true);
      expect(existsSync(orgDst('acme', 'workflows'))).toBe(false);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('default org IS scaffold-able under org-first (no longer early-returned)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents', 'shipped.json'), '{"displayName":"x"}');

    await scaffoldHandler({} as never, { orgSlug: 'default' });

    expect(existsSync(orgDst('default', 'agents', 'shipped.json'))).toBe(true);
  });

  it('override:true overwrites flat-domain files while preserving secrets and .history', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents', 'shipped.json'), '{"displayName":"new"}');

    // Pre-existing org state: user-edited shipped, user-added file, secret, history.
    await writeText(
      orgDst('acme', 'agents', 'shipped.json'),
      '{"displayName":"user-edited"}',
    );
    await writeText(
      orgDst('acme', 'agents', 'user-added.json'),
      '{"displayName":"keep me"}',
    );
    await writeText(
      orgDst('acme', 'agents', 'openai.secrets.json'),
      '{"key":"keep-me-too"}',
    );
    await writeText(
      orgDst('acme', 'agents', '.history', 'shipped', '1.json'),
      '{"rev":1}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme', override: true });

    // Catalog file overwritten.
    expect(
      await readFile(orgDst('acme', 'agents', 'shipped.json'), 'utf-8'),
    ).toBe('{"displayName":"new"}');
    // User-added file survived.
    expect(existsSync(orgDst('acme', 'agents', 'user-added.json'))).toBe(true);
    // Secret + history survived.
    expect(
      await readFile(orgDst('acme', 'agents', 'openai.secrets.json'), 'utf-8'),
    ).toBe('{"key":"keep-me-too"}');
    expect(
      existsSync(orgDst('acme', 'agents', '.history', 'shipped', '1.json')),
    ).toBe(true);
  });

  it('override:true for dir-bundle domains (skills) rm-replaces the bundle but preserves dir-level secrets/.history', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('skills', 'code-reviewer', 'SKILL.md'), 'new');

    // Pre-existing bundle: user-edited SKILL.md + a user-added file inside
    // the bundle (gets wiped); domain-level .history + secrets survive.
    await writeText(
      orgDst('acme', 'skills', 'code-reviewer', 'SKILL.md'),
      'user-edited',
    );
    await writeText(
      orgDst('acme', 'skills', 'code-reviewer', 'user-extra.txt'),
      'gone after override',
    );
    await writeText(
      orgDst('acme', 'skills', '.history', 'code-reviewer', '1.md'),
      'old rev',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme', override: true });

    expect(
      await readFile(
        orgDst('acme', 'skills', 'code-reviewer', 'SKILL.md'),
        'utf-8',
      ),
    ).toBe('new');
    expect(
      existsSync(orgDst('acme', 'skills', 'code-reviewer', 'user-extra.txt')),
    ).toBe(false);
    expect(
      existsSync(orgDst('acme', 'skills', '.history', 'code-reviewer', '1.md')),
    ).toBe(true);
  });

  it('override:true for workflows preserves user-only folders', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      catSrc('workflows', 'shopify', 'sync.json'),
      '{"name":"new"}',
    );

    await writeText(
      orgDst('acme', 'workflows', 'shopify', 'sync.json'),
      '{"name":"old"}',
    );
    await writeText(
      orgDst('acme', 'workflows', 'my-folder', 'custom.json'),
      '{"name":"custom"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme', override: true });

    expect(
      await readFile(
        orgDst('acme', 'workflows', 'shopify', 'sync.json'),
        'utf-8',
      ),
    ).toBe('{"name":"new"}');
    expect(
      existsSync(orgDst('acme', 'workflows', 'my-folder', 'custom.json')),
    ).toBe(true);
  });

  it('seeds retention as a single file at <org>/retention.json', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      catSrc('retention.json'),
      '{"version":"v1","categories":{}}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'retention.json'))).toBe(true);
    expect(await readFile(orgDst('acme', 'retention.json'), 'utf-8')).toBe(
      '{"version":"v1","categories":{}}',
    );
  });

  it('copy-onto-self guard fires for default-org reseed in dev fallback (catalog env unset)', async () => {
    // No TALE_CONFIG_BUILTIN_DIR → fallback source = domain.resolve('default')
    // = `<root>/default/<domain>`, which is the same dir as the reseed
    // target. realpath-based guard must catch this even though path strings
    // are syntactically identical.
    await writeText(
      orgDst('default', 'workflows', 'shopify', 'sync.json'),
      '{"name":"existing"}',
    );

    // Should be a no-op (skip with warn), not a destructive copy-onto-self.
    await scaffoldHandler({} as never, {
      orgSlug: 'default',
      override: true,
    });

    expect(
      await readFile(
        orgDst('default', 'workflows', 'shopify', 'sync.json'),
        'utf-8',
      ),
    ).toBe('{"name":"existing"}');
  });

  it('refuses invalid org slugs with skipped:true (no fs writes)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // Populate something the scaffolder would normally seed so we can
    // be sure the refusal happens BEFORE any writes.
    await writeText(catSrc('agents', 'a.json'), '{}');

    const result = await scaffoldHandler({} as never, {
      orgSlug: '../escape',
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.results).toEqual([]);
    // Nothing under the (invalid) slug should exist on disk.
    expect(existsSync(orgDst('../escape'))).toBe(false);
  });

  it('seedRetention override:true overwrites; override:false skips existing', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('retention.json'), '{"defaults":"new"}');
    // Pre-existing per-org retention.json simulates an operator edit.
    await writeText(
      orgDst('acme', 'retention.json'),
      '{"defaults":"existing"}',
    );

    // override:false → operator file survives.
    await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      override: false,
    });
    expect(await readFile(orgDst('acme', 'retention.json'), 'utf-8')).toBe(
      '{"defaults":"existing"}',
    );

    // override:true → catalog file wins.
    await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      override: true,
    });
    expect(await readFile(orgDst('acme', 'retention.json'), 'utf-8')).toBe(
      '{"defaults":"new"}',
    );
  });

  it('strict:true throws with aggregated per-domain failure detail', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // Make the catalog's agents/ source unreadable by replacing the
    // expected directory with a regular file — the scaffolder's
    // per-domain copy will fail and the strict gate aggregates it.
    await writeText(catSrc('agents'), 'not-a-directory');
    await writeText(catSrc('workflows', 'general', 'a.json'), '{"ok":true}');

    let threw: Error | null = null;
    try {
      await scaffoldHandler({} as never, {
        orgSlug: 'acme',
        strict: true,
      });
    } catch (err) {
      threw = err as Error;
    }

    expect(threw).not.toBeNull();
    // Aggregated message must name the failing domain so operators
    // can act on it without trawling logs. Non-strict mode (covered
    // below) folds the same shape into a result without throwing.
    expect(threw?.message ?? '').toMatch(/scaffold "acme"/);
    expect(threw?.message ?? '').toMatch(/agents/);
  });

  it('non-strict aggregates failures into result without throwing', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents'), 'not-a-directory');
    await writeText(catSrc('workflows', 'general', 'a.json'), '{"ok":true}');

    const result = await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      // strict defaults to false — caller gets the result object back.
    });

    expect(result.ok).toBe(false);
    const failedDomains = result.results
      .filter((r) => !r.ok)
      .map((r) => r.domain);
    expect(failedDomains).toContain('agents');
  });
});

describe('cleanupOrgFilesystem (symlink + traversal defense)', () => {
  it('refuses the literal `default` slug', async () => {
    await writeText(orgDst('default', 'agents', 'x.json'), '{}');
    await cleanupHandler({} as never, { orgSlug: 'default' });
    expect(existsSync(orgDst('default', 'agents', 'x.json'))).toBe(true);
  });

  it('removes the entire <org>/ subtree for a valid non-default slug', async () => {
    await writeText(orgDst('acme', 'agents', 'x.json'), '{}');
    await writeText(orgDst('acme', 'providers', 'p.json'), '{}');
    await writeText(orgDst('other', 'agents', 'keep.json'), '{}');

    await cleanupHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme'))).toBe(false);
    expect(existsSync(orgDst('other', 'agents', 'keep.json'))).toBe(true);
  });

  it('ENOENT on the org dir is idempotent (no throw)', async () => {
    // Org dir doesn't exist; cleanup should silently succeed.
    await expect(
      cleanupHandler({} as never, { orgSlug: 'never-existed' }),
    ).resolves.toBeNull();
  });

  it('refuses invalid org slugs (would have already failed at validateOrgSlug too)', async () => {
    // Slugs that don't match ORG_SLUG_REGEX. cleanup must warn-and-skip.
    await cleanupHandler({} as never, { orgSlug: '../escape' });
    await cleanupHandler({} as never, { orgSlug: 'UPPER' });
    // No assertion needed on filesystem — we're verifying no throw.
  });

  it('refuses a symlinked org dir (would otherwise rm the symlink target)', async () => {
    // Create a directory outside configRoot, then place a symlink at
    // configRoot/acme pointing to it. cleanup must lstat → detect symlink → refuse.
    const outside = await mkdtemp(path.join(tmpdir(), 'cleanup-outside-'));
    const outsideFile = path.join(outside, 'precious.json');
    await writeFile(outsideFile, '{"keep":"me"}', 'utf-8');

    await symlink(outside, orgDst('acme'));

    try {
      await cleanupHandler({} as never, { orgSlug: 'acme' });
      // The symlink target's file MUST survive.
      expect(existsSync(outsideFile)).toBe(true);
    } finally {
      await rm(orgDst('acme'), { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
