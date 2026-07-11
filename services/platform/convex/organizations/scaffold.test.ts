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

const {
  scaffoldNewOrganization,
  cleanupOrgFilesystem,
  listMissingScaffoldDomains,
  scaffoldOrgFromCatalog,
} = await import('./scaffold');

type ActionConfig = {
  handler: (
    ctx: never,
    args: {
      orgSlug: string;
      override?: boolean;
      strict?: boolean;
      cleanFirst?: boolean;
    },
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

// Catalog source path for a given domain — the GENERIC built-in layout
// (`<catalogRoot>/<domain>/...`, no org level) the scaffold reads from.
function catSrc(...parts: string[]): string {
  return path.join(catalogRoot, ...parts);
}

// Per-org target path — `<configRoot>/<orgSlug>/<domain>/...`.
function orgDst(orgSlug: string, ...parts: string[]): string {
  return path.join(configRoot, orgSlug, ...parts);
}

// Minimal but schema-VALID catalog fixtures. The scaffolder now validates
// each `.json` catalog file against its domain schema before writing it
// (Phase 3 runtime guard — a corrupt file is skipped, never copied), so a
// throwaway `{"name":"x"}` fixture would silently be skipped instead of
// copied. These mirror the domain schemas' own test fixtures
// (agents.test.ts's baseAgent, providers.test.ts's baseProvider).
function validAgentJson(displayName: string): string {
  return JSON.stringify({
    displayName,
    systemInstructions: 'You are a test agent.',
    supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
  });
}
const VALID_AGENT_JSON = validAgentJson('x');
const VALID_PROVIDER_JSON =
  '{"displayName":"Test Provider","baseUrl":"https://api.example.com/v1","models":[{"id":"test/model-1","displayName":"Test Model 1","tags":["chat"]}]}';

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

  it('skips (warns, never throws or copies) a catalog file that fails its domain schema, while sibling files still seed', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('providers', 'good.json'), VALID_PROVIDER_JSON);
    // Missing every required field (displayName, baseUrl, models) — a
    // corrupt/hand-edited catalog file must never reach a new org's disk.
    await writeText(catSrc('providers', 'broken.json'), '{"oops":true}');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await scaffoldHandler({} as never, { orgSlug: 'acme' });
    // Read the recorded calls BEFORE restoring — mockRestore() also clears
    // `.mock.calls`.
    const messages = errSpy.mock.calls.map((c) => c.join(' '));
    errSpy.mockRestore();

    // Never throws, and the `providers` domain itself isn't marked failed —
    // one bad file inside it doesn't abort the domain (other domains in this
    // result are `ok:false` too, but only because this test's catalog fixture
    // seeds `providers` alone; see the other single-domain tests in this file).
    const providersResult = result.results.find(
      (r) => r.domain === 'providers',
    );
    expect(providersResult?.ok).toBe(true);
    // The broken file is skipped, not copied.
    expect(existsSync(orgDst('acme', 'providers', 'broken.json'))).toBe(false);
    // Its sibling still seeds normally.
    expect(existsSync(orgDst('acme', 'providers', 'good.json'))).toBe(true);
    // Warned loudly, naming the file and the field the schema rejected.
    expect(
      messages.some(
        (m) => m.includes('providers/broken.json') && m.includes('displayName'),
      ),
    ).toBe(true);
  });

  it('seeds flat domains (providers) per-file from the catalog', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('providers', 'shipped.json'), VALID_PROVIDER_JSON);

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'providers', 'shipped.json'))).toBe(true);
  });

  it('seeds the automations bundle (automations is a first-class config domain)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // An app bundle: manifest + a view + an app-scoped agent, all under the slug.
    await writeText(
      catSrc('automations', 'issue-desk', 'automation.json'),
      '{"name":"Desk"}',
    );
    await writeText(
      catSrc('automations', 'issue-desk', 'views', 'home.json'),
      '{"data":{}}',
    );
    await writeText(
      catSrc('automations', 'issue-desk', 'agents', 'implementer.json'),
      '{"slug":"implementer"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(
      existsSync(
        orgDst('acme', 'automations', 'issue-desk', 'automation.json'),
      ),
    ).toBe(true);
    // The whole bundle tree copies, including nested views/ and app-scoped agents/.
    expect(
      existsSync(
        orgDst('acme', 'automations', 'issue-desk', 'views', 'home.json'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        orgDst(
          'acme',
          'automations',
          'issue-desk',
          'agents',
          'implementer.json',
        ),
      ),
    ).toBe(true);
  });

  it('flat domains never recurse into catalog subdirs (defense if the catalog ever ships one)', async () => {
    // `agents` became a TREE domain (chat/ github/ folders) so it
    // recurses by design — see the workflows recursion test above. This guards
    // the still-flat domains (providers/prompts/governance) against an
    // unexpected subdir leaking cross-tenant content.
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('providers', 'shipped.json'), VALID_PROVIDER_JSON);
    await writeText(
      catSrc('providers', 'stray', 'nested.json'),
      VALID_PROVIDER_JSON,
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'providers', 'shipped.json'))).toBe(true);
    expect(existsSync(orgDst('acme', 'providers', 'stray'))).toBe(false);
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
    await writeText(catSrc('providers', 'openai.json'), VALID_PROVIDER_JSON);
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
    await writeText(catSrc('agents', 'shipped.json'), VALID_AGENT_JSON);

    await scaffoldHandler({} as never, { orgSlug: 'default' });

    expect(existsSync(orgDst('default', 'agents', 'shipped.json'))).toBe(true);
  });

  it('override:true overwrites flat-domain files while preserving secrets and .history', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(catSrc('agents', 'shipped.json'), validAgentJson('new'));

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
    ).toBe(validAgentJson('new'));
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

  it('override:true for the automations bundle domain rm-replaces the bundle from the catalog', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // The catalog shipped a new manifest.
    await writeText(
      catSrc('automations', 'issue-desk', 'automation.json'),
      '{"v":"new"}',
    );
    // Org state: the operator-wide reseed runs on an org that already
    // installed this app.
    await writeText(
      orgDst('acme', 'automations', 'issue-desk', 'automation.json'),
      '{"v":"old"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme', override: true });

    // The bundle (manifest, which carries the inline workflow) refreshed from
    // the catalog.
    expect(
      await readFile(
        orgDst('acme', 'automations', 'issue-desk', 'automation.json'),
        'utf-8',
      ),
    ).toBe('{"v":"new"}');
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

  it('seeds retention.json inside the governance flat domain', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // retentionDefaultsConfigSchema is `.strict()` with every category
    // optional (a partial-bounds file is the norm) — one valid category
    // bound is enough to be schema-valid while still exercising the copy.
    const retentionJson =
      '{"documents":{"min":1,"max":365,"default":30,"unit":"days"}}';
    await writeText(catSrc('governance', 'retention.json'), retentionJson);

    await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(existsSync(orgDst('acme', 'governance', 'retention.json'))).toBe(
      true,
    );
    expect(
      await readFile(orgDst('acme', 'governance', 'retention.json'), 'utf-8'),
    ).toBe(retentionJson);
  });

  it('refuses to scaffold when TALE_CONFIG_BUILTIN_DIR is unset (no fallback, no fs writes)', async () => {
    // beforeEach deletes TALE_CONFIG_BUILTIN_DIR and this test never sets it.
    // The built-in catalog is REQUIRED — scaffold must refuse rather than fall
    // back to any org's live dir (the old `resolve('default')` fallback is gone).
    await writeText(
      orgDst('acme', 'workflows', 'shopify', 'sync.json'),
      '{"name":"existing"}',
    );

    const result = await scaffoldHandler({} as never, { orgSlug: 'acme' });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.results).toEqual([]);
    // Pre-existing org content is untouched — the refusal happens before any seed.
    expect(
      await readFile(
        orgDst('acme', 'workflows', 'shopify', 'sync.json'),
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

  it('governance retention.json: override:true overwrites; override:false skips existing', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // Only the CATALOG-side file is schema-validated before being written; the
    // pre-existing per-org file below is never re-parsed by the scaffolder, so
    // it can stay a throwaway marker string.
    await writeText(
      catSrc('governance', 'retention.json'),
      '{"documents":{"min":1,"max":365,"default":90,"unit":"days"}}',
    );
    // Pre-existing per-org governance file simulates an operator edit. Its
    // presence makes the whole governance domain "already scaffolded" for
    // override:false (flat-domain skip is per-directory).
    await writeText(
      orgDst('acme', 'governance', 'retention.json'),
      '{"defaults":"existing"}',
    );

    // override:false → operator file survives.
    await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      override: false,
    });
    expect(
      await readFile(orgDst('acme', 'governance', 'retention.json'), 'utf-8'),
    ).toBe('{"defaults":"existing"}');

    // override:true → catalog file wins.
    await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      override: true,
    });
    expect(
      await readFile(orgDst('acme', 'governance', 'retention.json'), 'utf-8'),
    ).toBe('{"documents":{"min":1,"max":365,"default":90,"unit":"days"}}');
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

  // cleanFirst is the org-create path (auth.afterCreateOrganization). It purges
  // any leftover subtree for the (provably new) slug, THEN seeds — so a prior
  // org's stale/renamed files can't survive and can't trip the override:false
  // per-domain skip. This is the exact scenario behind the production
  // "Agent not found: assistant — File not found: assistant.json": a slug whose
  // agents/ dir still held the pre-rename flat layout was skipped forever.
  it('cleanFirst purges renamed orphans + stale secrets, then seeds an exact catalog copy', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    // New catalog layout: the agent was renamed + foldered (chat-agent → chat/assistant).
    await writeText(
      catSrc('agents', 'chat', 'assistant.json'),
      validAgentJson('Assistant'),
    );
    // Leftover org dir from a prior (deleted/dev-wiped) org with the OLD layout:
    // a renamed-away flat agent and a stale secret that must NOT be inherited.
    await writeText(
      orgDst('acme', 'agents', 'chat-agent.json'),
      '{"displayName":"stale"}',
    );
    await writeText(
      orgDst('acme', 'providers', 'openrouter.secrets.json'),
      '{"key":"prior-tenant"}',
    );

    await scaffoldHandler({} as never, { orgSlug: 'acme', cleanFirst: true });

    // The renamed agent now resolves.
    expect(existsSync(orgDst('acme', 'agents', 'chat', 'assistant.json'))).toBe(
      true,
    );
    // The renamed-away orphan is gone (no stray flat file shadowing the catalog).
    expect(existsSync(orgDst('acme', 'agents', 'chat-agent.json'))).toBe(false);
    // No cross-tenant secret inheritance — a fresh org starts with no secrets.
    expect(
      existsSync(orgDst('acme', 'providers', 'openrouter.secrets.json')),
    ).toBe(false);
  });

  it('cleanFirst leaves sibling orgs untouched', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      catSrc('agents', 'chat', 'assistant.json'),
      VALID_AGENT_JSON,
    );
    await writeText(orgDst('acme', 'agents', 'old.json'), '{"x":1}');
    await writeText(orgDst('other', 'agents', 'keep.json'), '{"keep":true}');

    await scaffoldHandler({} as never, { orgSlug: 'acme', cleanFirst: true });

    expect(existsSync(orgDst('acme', 'agents', 'old.json'))).toBe(false);
    expect(existsSync(orgDst('other', 'agents', 'keep.json'))).toBe(true);
  });

  it('cleanFirst refuses to purge the `default` slug (shared-template guard)', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await writeText(
      catSrc('agents', 'chat', 'assistant.json'),
      VALID_AGENT_JSON,
    );
    // Pre-existing default content: the cleanFirst purge must refuse 'default',
    // and the subsequent override:false seed skips the occupied domain — so the
    // operator file survives untouched.
    await writeText(orgDst('default', 'agents', 'keep.json'), '{"keep":true}');

    await scaffoldHandler({} as never, {
      orgSlug: 'default',
      cleanFirst: true,
    });

    expect(existsSync(orgDst('default', 'agents', 'keep.json'))).toBe(true);
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

describe('provisioning status + repair (#2636)', () => {
  const RETENTION_JSON =
    '{"documents":{"min":1,"max":365,"default":30,"unit":"days"}}';

  // A real builtin catalog ships a dir for every scaffolded domain. The
  // sparse fixtures above deliberately omit most; without the full dir set a
  // domain with no source dir reports the deploy-misconfig error and taints
  // `ok` for what this suite wants to prove (fixture artifact, not behaviour).
  async function ensureCatalogDomainDirs(): Promise<void> {
    const { CONFIG_DOMAINS } = await import('../../lib/shared/config/registry');
    for (const domain of CONFIG_DOMAINS) {
      if (domain.scaffoldKind) {
        await mkdir(catSrc(domain.name), { recursive: true });
      }
    }
  }

  it('a failed create-time scaffold is detectable, and one idempotent retry provisions EVERY domain (providers + governance included)', async () => {
    // Catalog ships content for four scaffolded domains — deliberately
    // including providers and governance, the two the per-domain catalog
    // sync (CatalogSyncDomain) cannot repair from the UI.
    await ensureCatalogDomainDirs();
    await writeText(
      catSrc('providers', 'openrouter.json'),
      VALID_PROVIDER_JSON,
    );
    await writeText(catSrc('governance', 'retention.json'), RETENTION_JSON);
    await writeText(catSrc('agents', 'helper.json'), VALID_AGENT_JSON);
    await writeText(
      catSrc('workflows', 'shopify', 'sync.json'),
      '{"name":"sync"}',
    );

    // Simulate the org-create failure mode (#2631): `org.create` succeeded
    // but the scheduled scaffold could not run — nothing lands on disk.
    // (beforeEach leaves TALE_CONFIG_BUILTIN_DIR unset.)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await scaffoldHandler({} as never, {
      orgSlug: 'acme',
      cleanFirst: true,
    });
    errSpy.mockRestore();
    expect(failed.ok).toBe(false);
    expect(failed.skipped).toBe(true);
    expect(existsSync(orgDst('acme'))).toBe(false);

    // The derived status names exactly the un-seeded domains, in registry
    // order — no persisted marker required, so it can't drift.
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    expect(await listMissingScaffoldDomains('acme')).toEqual([
      'agents',
      'providers',
      'workflows',
      'governance',
    ]);

    // One retry with the repair action's exact semantics (override:false,
    // NO cleanFirst) restores every domain from the catalog...
    const retry = await scaffoldOrgFromCatalog({
      orgSlug: 'acme',
      override: false,
      cleanFirst: false,
    });
    expect(retry.ok).toBe(true);
    expect(existsSync(orgDst('acme', 'providers', 'openrouter.json'))).toBe(
      true,
    );
    expect(existsSync(orgDst('acme', 'governance', 'retention.json'))).toBe(
      true,
    );
    expect(existsSync(orgDst('acme', 'agents', 'helper.json'))).toBe(true);
    expect(
      existsSync(orgDst('acme', 'workflows', 'shopify', 'sync.json')),
    ).toBe(true);

    // ...and the status self-clears: fully provisioned.
    expect(await listMissingScaffoldDomains('acme')).toEqual([]);
  });

  it('a partial scaffold: only the empty domains are missing, and the retry fills them WITHOUT touching user-authored files', async () => {
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    await ensureCatalogDomainDirs();
    await writeText(
      catSrc('providers', 'openrouter.json'),
      VALID_PROVIDER_JSON,
    );
    await writeText(catSrc('agents', 'helper.json'), VALID_AGENT_JSON);
    // The crash happened after providers seeded; the user has since edited it.
    const userEdit =
      '{"displayName":"Mine","baseUrl":"https://me","models":[]}';
    await writeText(orgDst('acme', 'providers', 'openrouter.json'), userEdit);

    expect(await listMissingScaffoldDomains('acme')).toEqual(['agents']);

    const retry = await scaffoldOrgFromCatalog({
      orgSlug: 'acme',
      override: false,
      cleanFirst: false,
    });
    expect(retry.ok).toBe(true);
    // The occupied domain is untouched — repair must never clobber user work.
    expect(
      await readFile(orgDst('acme', 'providers', 'openrouter.json'), 'utf-8'),
    ).toBe(userEdit);
    expect(existsSync(orgDst('acme', 'agents', 'helper.json'))).toBe(true);
    expect(await listMissingScaffoldDomains('acme')).toEqual([]);
  });

  it('returns null (unknown, never "unprovisioned") when the probe cannot run', async () => {
    // TALE_CONFIG_BUILTIN_DIR unset (beforeEach): a misconfigured deploy must
    // not flag every org as broken with an unrepairable banner.
    expect(await listMissingScaffoldDomains('acme')).toBeNull();
    // Invalid slug: refuse to probe rather than path-join it.
    process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
    expect(await listMissingScaffoldDomains('../escape')).toBeNull();
  });
});
