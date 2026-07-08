import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  automationExistsInBuiltinCatalog,
  installAutomationFiles,
  planAutomationFiles,
  resolveAutomationBundleSourceDir,
  uninstallAutomationFiles,
} from './install_fs';

const ORG = 'testorg';
const MANIFEST = JSON.stringify({ name: 'X' });

let configDir: string;
let builtinDir: string;
let prevConfig: string | undefined;
let prevBuiltin: string | undefined;

beforeEach(async () => {
  prevConfig = process.env.TALE_CONFIG_DIR;
  prevBuiltin = process.env.TALE_CONFIG_BUILTIN_DIR;
  configDir = await mkdtemp(path.join(os.tmpdir(), 'tale-cfg-'));
  builtinDir = await mkdtemp(path.join(os.tmpdir(), 'tale-builtin-'));
  process.env.TALE_CONFIG_DIR = configDir;
  process.env.TALE_CONFIG_BUILTIN_DIR = builtinDir;
  await mkdir(path.join(configDir, ORG, 'automations'), { recursive: true });
});

afterEach(async () => {
  process.env.TALE_CONFIG_DIR = prevConfig;
  process.env.TALE_CONFIG_BUILTIN_DIR = prevBuiltin;
  await rm(configDir, { recursive: true, force: true });
  await rm(builtinDir, { recursive: true, force: true });
});

async function seedBuiltin(slug: string): Promise<string> {
  const dir = path.join(builtinDir, 'automations', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), MANIFEST);
  return dir;
}

async function seedOrg(slug: string): Promise<string> {
  const dir = path.join(configDir, ORG, 'automations', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), MANIFEST);
  return dir;
}

/** Seed a builtin bundle with a shell file, an integration, and a skill. */
async function seedFanoutBundle(slug: string): Promise<string> {
  const dir = path.join(builtinDir, 'automations', slug);
  await mkdir(path.join(dir, 'integrations', 'github'), { recursive: true });
  await mkdir(path.join(dir, 'skills', 'triage'), { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), MANIFEST);
  await writeFile(
    path.join(dir, 'integrations', 'github', 'definition.json'),
    '{"a":1}\n',
  );
  await writeFile(path.join(dir, 'skills', 'triage', 'SKILL.md'), '# Triage\n');
  return dir;
}

describe('planAutomationFiles', () => {
  it('splits shell vs fan-out domains and skips dotfiles/secrets/subtree rules', async () => {
    const dir = await seedFanoutBundle('desk');
    await writeFile(path.join(dir, '.hidden'), 'x');
    await writeFile(path.join(dir, 'token.secrets.json'), '{}');
    await mkdir(path.join(dir, 'views'), { recursive: true });
    await writeFile(path.join(dir, 'views', 'main.json'), '{}');

    const plan = await planAutomationFiles(ORG, 'desk');
    const byKey = new Map(plan.map((p) => [`${p.domain}:${p.path}`, p]));

    expect(byKey.has('automation:automation.json')).toBe(true);
    expect(byKey.has('automation:views/main.json')).toBe(true);
    expect(byKey.has('integrations:github/definition.json')).toBe(true);
    expect(byKey.has('skills:triage/SKILL.md')).toBe(true);
    // Fan-out dirs are NOT shell; dotfiles + secrets never planned.
    expect(byKey.has('automation:integrations/github/definition.json')).toBe(
      false,
    );
    expect(byKey.has('automation:skills/triage/SKILL.md')).toBe(false);
    expect([...byKey.keys()].some((k) => k.includes('.hidden'))).toBe(false);
    expect([...byKey.keys()].some((k) => k.includes('secrets'))).toBe(false);
    // Destinations: shell under the org automation dir, fan-out under the domain dirs.
    expect(byKey.get('automation:automation.json')?.dst).toBe(
      path.join(configDir, ORG, 'automations', 'desk', 'automation.json'),
    );
    expect(byKey.get('skills:triage/SKILL.md')?.dst).toBe(
      path.join(configDir, ORG, 'skills', 'triage', 'SKILL.md'),
    );
  });

  it('omits the shell when the bundle source IS the org automation dir (private upload)', async () => {
    const dir = await seedOrg('private-automation');
    await mkdir(path.join(dir, 'skills', 'howto'), { recursive: true });
    await writeFile(path.join(dir, 'skills', 'howto', 'SKILL.md'), '# H\n');

    const plan = await planAutomationFiles(ORG, 'private-automation');
    expect(plan.every((p) => p.domain !== 'automation')).toBe(true);
    expect(plan.map((p) => `${p.domain}:${p.path}`)).toContain(
      'skills:howto/SKILL.md',
    );
  });
});

describe('installAutomationFiles — fan-out ledger + adoption', () => {
  it('fans skills out into the org skills dir and records them in the ledger', async () => {
    await seedFanoutBundle('desk');
    const { resources } = await installAutomationFiles(ORG, 'desk');

    const skillDst = path.join(configDir, ORG, 'skills', 'triage', 'SKILL.md');
    expect(await readFile(skillDst, 'utf-8')).toBe('# Triage\n');
    const keys = resources.map((r) => `${r.domain}:${r.path}`);
    expect(keys).toContain('skills:triage/SKILL.md');
    expect(keys).toContain('integrations:github/definition.json');
    // Fresh install onto a clean org: nothing adopted.
    expect(resources.every((r) => r.adopted === undefined)).toBe(true);
  });

  it('marks a fan-out file adopted when the destination pre-exists without a prior claim', async () => {
    await seedFanoutBundle('desk');
    const preexisting = path.join(
      configDir,
      ORG,
      'skills',
      'triage',
      'SKILL.md',
    );
    await mkdir(path.dirname(preexisting), { recursive: true });
    await writeFile(preexisting, '# user version\n');

    const { resources } = await installAutomationFiles(ORG, 'desk');
    const skill = resources.find((r) => r.path === 'triage/SKILL.md');
    expect(skill?.adopted).toBe(true);
    // A file the install created (no pre-existing dst) is NOT adopted.
    const integration = resources.find(
      (r) => r.path === 'github/definition.json',
    );
    expect(integration?.adopted).toBeUndefined();
    // The copy itself still happened (org file now matches the bundle).
    expect(await readFile(preexisting, 'utf-8')).toBe('# Triage\n');
  });

  it('inherits adoption from the prior ledger on reinstall — set stays set, absent stays absent', async () => {
    await seedFanoutBundle('desk');
    const prior = [
      {
        domain: 'skills',
        path: 'triage/SKILL.md',
        contentHash: 'stale',
        adopted: true,
      },
      {
        domain: 'integrations',
        path: 'github/definition.json',
        contentHash: 'stale',
      },
    ];
    // Both destinations exist after a first install — without the prior
    // ledger, BOTH would look adopted; inheritance must keep the integration
    // automation-owned.
    await installAutomationFiles(ORG, 'desk');
    const { resources } = await installAutomationFiles(ORG, 'desk', prior);
    expect(resources.find((r) => r.path === 'triage/SKILL.md')?.adopted).toBe(
      true,
    );
    expect(
      resources.find((r) => r.path === 'github/definition.json')?.adopted,
    ).toBeUndefined();
  });
});

describe('installAutomationFiles — shell files overwrite on reinstall', () => {
  async function seedAgentBundle(
    slug: string,
    content: string,
  ): Promise<string> {
    const dir = await seedFanoutBundle(slug);
    await mkdir(path.join(dir, 'agents'), { recursive: true });
    await writeFile(path.join(dir, 'agents', 'helper.json'), content);
    return dir;
  }

  function orgAgentPath(slug: string): string {
    return path.join(
      configDir,
      ORG,
      'automations',
      slug,
      'agents',
      'helper.json',
    );
  }

  it('copies a brand-new bundle file on a fresh install', async () => {
    await seedAgentBundle('desk', '{"v":1}\n');
    await installAutomationFiles(ORG, 'desk');
    expect(await readFile(orgAgentPath('desk'), 'utf-8')).toBe('{"v":1}\n');
  });

  it('overwrites an org-edited shell file with the catalog version on reinstall', async () => {
    const dir = await seedAgentBundle('desk', '{"v":1}\n');
    await installAutomationFiles(ORG, 'desk');

    // The org edited its copy; the catalog then shipped a new version.
    await writeFile(orgAgentPath('desk'), '{"v":"user-edited"}\n');
    await writeFile(path.join(dir, 'agents', 'helper.json'), '{"v":2}\n');

    await installAutomationFiles(ORG, 'desk');
    expect(await readFile(orgAgentPath('desk'), 'utf-8')).toBe('{"v":2}\n');
  });

  it('repairs a shell file a user deleted (broken install) on reinstall', async () => {
    await seedAgentBundle('desk', '{"v":1}\n');
    await installAutomationFiles(ORG, 'desk');

    const dst = orgAgentPath('desk');
    await rm(dst);

    await installAutomationFiles(ORG, 'desk');
    expect(await readFile(dst, 'utf-8')).toBe('{"v":1}\n');
  });
});

describe('uninstallAutomationFiles — adopted resources survive', () => {
  it('removes automation-owned fan-out files but leaves adopted ones in place', async () => {
    await seedFanoutBundle('desk');
    const { resources } = await installAutomationFiles(ORG, 'desk');
    const withAdoption = resources.map((r) =>
      r.path === 'triage/SKILL.md'
        ? {
            domain: r.domain,
            path: r.path,
            contentHash: r.contentHash,
            adopted: true,
          }
        : r,
    );

    await uninstallAutomationFiles(ORG, 'desk', withAdoption);

    const adopted = path.join(configDir, ORG, 'skills', 'triage', 'SKILL.md');
    await expect(readFile(adopted, 'utf-8')).resolves.toBe('# Triage\n');
    const owned = path.join(
      configDir,
      ORG,
      'integrations',
      'github',
      'definition.json',
    );
    await expect(stat(owned)).rejects.toMatchObject({ code: 'ENOENT' });
    // The shell is gone too (builtin bundle source ≠ org automation dir).
    await expect(
      stat(path.join(configDir, ORG, 'automations', 'desk')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('resolveAutomationBundleSourceDir', () => {
  it('resolves a first-party automation to the built-in catalog', async () => {
    const builtin = await seedBuiltin('desk');
    expect(await resolveAutomationBundleSourceDir(ORG, 'desk')).toBe(builtin);
    expect(await automationExistsInBuiltinCatalog('desk')).toBe(true);
  });

  it('falls back to the org automations dir for a privately-uploaded automation', async () => {
    const org = await seedOrg('private-automation');
    expect(
      await resolveAutomationBundleSourceDir(ORG, 'private-automation'),
    ).toBe(org);
    expect(await automationExistsInBuiltinCatalog('private-automation')).toBe(
      false,
    );
  });

  it('prefers the built-in catalog when both exist (no org-dir shadowing)', async () => {
    const builtin = await seedBuiltin('both');
    await seedOrg('both');
    expect(await resolveAutomationBundleSourceDir(ORG, 'both')).toBe(builtin);
  });

  it('throws when the automation is in neither source', async () => {
    await expect(
      resolveAutomationBundleSourceDir(ORG, 'ghost'),
    ).rejects.toThrow(/not found in the catalog/);
  });
});
