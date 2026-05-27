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

const { scaffoldNewOrganization } = await import('./scaffold');

type ActionConfig = {
  handler: (ctx: never, args: { orgSlug: string }) => Promise<unknown>;
};
const scaffoldHandler = (scaffoldNewOrganization as unknown as ActionConfig)
  .handler;

// All env vars the scaffold code path or the per-domain resolvers consult.
// Save + clear them in beforeEach so each test starts from a known-empty
// state, then restore in afterEach so we don't poison other test files.
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

describe('scaffoldNewOrganization', () => {
  it('seeds workflows from the catalog and ignores the default org workspace', async () => {
    // Catalog: a shipped template under workflows/shopify/sync.json.
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'workflows', 'shopify', 'sync.json'),
      '{"name":"sync"}',
    );

    // Default-org workspace: a junk workflow that must NOT propagate.
    await writeText(
      path.join(configRoot, 'workflows', 'junk.json'),
      '{"name":"junk"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    const acmeDir = path.join(configRoot, 'workflows', '@acme');
    expect(existsSync(path.join(acmeDir, 'shopify', 'sync.json'))).toBe(true);
    expect(existsSync(path.join(acmeDir, 'junk.json'))).toBe(false);
  });

  it('closes the agents cross-tenant leak: raw-slug subdirs in the source are not copied', async () => {
    // Agents catalog contains only the shipped template.
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'agents', 'shipped.json'),
      '{"displayName":"shipped"}',
    );

    // Default-org workspace contains another tenant's raw-slug subdir.
    // Pre-fix scaffolding (which sourced from this dir) would recursively
    // copy `competitor/` into the new org because the @-skip in copyTree
    // doesn't catch raw slugs. Sourcing from the catalog instead must
    // not see this at all.
    await writeText(
      path.join(configRoot, 'agents', 'competitor', 'secret.json'),
      '{"displayName":"leak"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    const acmeDir = path.join(configRoot, 'agents', 'acme');
    expect(existsSync(path.join(acmeDir, 'shipped.json'))).toBe(true);
    expect(existsSync(path.join(acmeDir, 'competitor'))).toBe(false);
    expect(existsSync(path.join(acmeDir, 'competitor', 'secret.json'))).toBe(
      false,
    );
  });

  it('skips symlinks rather than following them', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    const targetPayload = await mkdtemp(path.join(tmpdir(), 'scaffold-evil-'));
    const targetFile = path.join(targetPayload, 'payload.json');
    await writeFile(targetFile, '{"name":"escaped"}', 'utf-8');

    await mkdir(path.join(catalogRoot, 'workflows'), { recursive: true });
    await symlink(targetFile, path.join(catalogRoot, 'workflows', 'evil.json'));
    // Also drop a real file beside it so we know the copy loop kept running.
    await writeText(
      path.join(catalogRoot, 'workflows', 'legit.json'),
      '{"name":"legit"}',
    );

    try {
      await scaffoldHandler({} as never, { orgSlug: 'acme' });

      const acmeDir = path.join(configRoot, 'workflows', '@acme');
      expect(existsSync(path.join(acmeDir, 'evil.json'))).toBe(false);
      expect(existsSync(path.join(acmeDir, 'legit.json'))).toBe(true);
    } finally {
      await rm(targetPayload, { recursive: true, force: true });
    }
  });

  it('falls back to domain.resolve(default) when the catalog env is unset (dev)', async () => {
    // No TALE_CONFIG_BUILTIN_DIR set. Default-org workspace becomes the
    // catalog — historical behavior, preserved for local dev.
    await writeText(
      path.join(configRoot, 'workflows', 'shopify', 'sync.json'),
      '{"name":"sync"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    const acmeDir = path.join(configRoot, 'workflows', '@acme');
    expect(existsSync(path.join(acmeDir, 'shopify', 'sync.json'))).toBe(true);
  });

  it('still applies the @-prefix, .history, and *.secrets.json skips when copying', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'providers', 'openai.json'),
      '{"name":"openai"}',
    );
    await writeText(
      path.join(catalogRoot, 'providers', 'openai.secrets.json'),
      '{"key":"redacted"}',
    );
    await writeText(
      path.join(catalogRoot, 'providers', '.history', 'snapshot.json'),
      '{}',
    );
    await writeText(
      path.join(catalogRoot, 'providers', '@stale-tenant', 'leak.json'),
      '{}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    const acmeDir = path.join(configRoot, 'providers', 'acme');
    expect(existsSync(path.join(acmeDir, 'openai.json'))).toBe(true);
    expect(existsSync(path.join(acmeDir, 'openai.secrets.json'))).toBe(false);
    expect(existsSync(path.join(acmeDir, '.history'))).toBe(false);
    expect(existsSync(path.join(acmeDir, '@stale-tenant'))).toBe(false);
  });

  it('is per-domain idempotent: a domain dir that already has files is skipped', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'workflows', 'shipped.json'),
      '{"name":"shipped"}',
    );
    // Pre-existing org content — scaffold must not overwrite.
    const acmeDir = path.join(configRoot, 'workflows', '@acme');
    await writeText(path.join(acmeDir, 'existing.json'), '{"name":"existing"}');

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(await readFile(path.join(acmeDir, 'existing.json'), 'utf-8')).toBe(
      '{"name":"existing"}',
    );
    expect(existsSync(path.join(acmeDir, 'shipped.json'))).toBe(false);
  });

  it('treats a target containing only .history/ as occupied (no re-seed on top of user edit trail)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'workflows', 'shipped.json'),
      '{"name":"shipped"}',
    );
    // Realistic state: user created the org, edited a workflow (writing
    // `.history/<slug>/<rev>.json`), then deleted the visible workflow.
    // Re-scaffolding (e.g., via the backfill migration) must NOT silently
    // re-seed the catalog on top of the surviving edit trail.
    const acmeDir = path.join(configRoot, 'workflows', '@acme');
    await writeText(
      path.join(acmeDir, '.history', 'old.json'),
      '{"snapshot":1}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(path.join(acmeDir, 'shipped.json'))).toBe(false);
    expect(existsSync(path.join(acmeDir, '.history', 'old.json'))).toBe(true);
  });

  it('ignores atomicWrite tmp orphans so a crashed scaffold can retry', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      path.join(catalogRoot, 'workflows', 'shipped.json'),
      '{"name":"shipped"}',
    );
    // Simulate the residue a prior crashed scaffold would leave behind:
    // atomicWrite uses `.<basename>.<ts>.<uuid>.tmp` and cleans up on
    // success, but a crash mid-write leaves the tmp orphan in place.
    const acmeDir = path.join(configRoot, 'workflows', '@acme');
    await writeText(
      path.join(acmeDir, '.shipped.json.1700000000000.deadbeef.tmp'),
      'partial',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(path.join(acmeDir, 'shipped.json'))).toBe(true);
  });

  it('logs error when TALE_CONFIG_BUILTIN_DIR points at a missing path (deploy misconfig)', async () => {
    // Builtin root configured but the directory doesn't exist on disk —
    // simulates platform/convex image version skew or a missing volume mount.
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
      // Target should remain empty — no silent fallback to default-org dir.
      expect(existsSync(path.join(configRoot, 'workflows', '@acme'))).toBe(
        false,
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('returns null without scaffolding the default org', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(path.join(catalogRoot, 'workflows', 'shipped.json'), '{}');

    const result = await scaffoldHandler({} as never, { orgSlug: 'default' });

    expect(result).toBeNull();
    // Default org's workspace must not have been touched by scaffold.
    expect(existsSync(path.join(configRoot, 'workflows', 'shipped.json'))).toBe(
      false,
    );
  });
});
