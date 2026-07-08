import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diffAutomationInstall, preflightKey } from './install_preflight';

const ORG = 'testorg';
const SLUG = 'desk';

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
});

afterEach(async () => {
  process.env.TALE_CONFIG_DIR = prevConfig;
  process.env.TALE_CONFIG_BUILTIN_DIR = prevBuiltin;
  await rm(configDir, { recursive: true, force: true });
  await rm(builtinDir, { recursive: true, force: true });
});

async function seedBundleFile(relPath: string, content: string | Buffer) {
  const abs = path.join(builtinDir, 'automations', SLUG, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

async function seedOrgFile(relPath: string, content: string | Buffer) {
  const abs = path.join(configDir, ORG, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

/** Seed one bundle file per kind the classifier distinguishes. */
async function seedFullBundle() {
  await seedBundleFile('automation.json', '{\n  "name": "Desk"\n}\n');
  await seedBundleFile('icon.svg', '<svg>desk</svg>');
  await seedBundleFile('agents/helper.json', '{"slug":"desk/helper"}\n');
  await seedBundleFile('views/main.json', '{"id":"main"}\n');
  await seedBundleFile('messages/en.json', '{"a.b":"c"}\n');
  await seedBundleFile(
    'integrations/github/definition.json',
    '{"kind":"github"}\n',
  );
  await seedBundleFile('skills/triage/SKILL.md', '# Triage\n');
}

function entryMap(entries: Awaited<ReturnType<typeof diffAutomationInstall>>) {
  return new Map(entries.map((e) => [preflightKey(e), e]));
}

describe('diffAutomationInstall — statuses', () => {
  it("reports 'create' for every file when the org has nothing", async () => {
    await seedFullBundle();
    const entries = await diffAutomationInstall(ORG, SLUG);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.status === 'create')).toBe(true);
  });

  it("reports 'identical' for a byte-identical destination", async () => {
    await seedFullBundle();
    await seedOrgFile('skills/triage/SKILL.md', '# Triage\n');
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('skills:triage/SKILL.md')?.status).toBe('identical');
  });

  it("reports 'identical' for JSON that differs only by whitespace, key order, and dropped empty arrays", async () => {
    await seedBundleFile('automation.json', '{"name":"Desk"}');
    await seedBundleFile(
      'integrations/github/definition.json',
      '{"kind":"github","scopes":["a","b"],"title":"GitHub"}\n',
    );
    // Same data: reordered keys, different whitespace, plus a top-level empty
    // array and null — exactly what `serializeJson` drops on write.
    await seedOrgFile(
      'integrations/github/definition.json',
      '{\n  "title": "GitHub",\n  "scopes": ["a", "b"],\n  "kind": "github",\n  "labels": [],\n  "note": null\n}\n',
    );
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('integrations:github/definition.json')?.status).toBe(
      'identical',
    );
  });

  it("reports 'override' for a real JSON change", async () => {
    await seedFullBundle();
    await seedOrgFile(
      'integrations/github/definition.json',
      '{"kind":"gitlab"}\n',
    );
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('integrations:github/definition.json')?.status).toBe(
      'override',
    );
  });

  it("compares a .json destination that isn't valid JSON byte-wise → 'override'", async () => {
    await seedFullBundle();
    await seedOrgFile('integrations/github/definition.json', 'not json {{{');
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('integrations:github/definition.json')?.status).toBe(
      'override',
    );
  });

  it('compares non-JSON files as raw bytes (no normalization)', async () => {
    await seedFullBundle();
    // Same "meaning" if it were JSON-normalized, but icon.svg is byte-only.
    await seedOrgFile(`automations/${SLUG}/icon.svg`, '<svg>desk </svg>');
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('automation:icon.svg')?.status).toBe('override');
    // And a byte-identical binary file is identical.
    await seedOrgFile(`automations/${SLUG}/icon.svg`, '<svg>desk</svg>');
    const map2 = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map2.get('automation:icon.svg')?.status).toBe('identical');
  });

  it('never plans dotfiles or *.secrets.json', async () => {
    await seedFullBundle();
    await seedBundleFile('.hidden', 'x');
    await seedBundleFile('github.secrets.json', '{}');
    await seedBundleFile('integrations/github/token.secrets.json', '{}');
    const keys = (await diffAutomationInstall(ORG, SLUG)).map(preflightKey);
    expect(keys.some((k) => k.includes('.hidden'))).toBe(false);
    expect(keys.some((k) => k.includes('secrets'))).toBe(false);
  });

  it('omits shell entries for a private upload (bundle source IS the org automation dir)', async () => {
    // No builtin bundle — seed the bundle in the org's own automations dir.
    await seedOrgFile(
      `automations/${SLUG}/automation.json`,
      '{"name":"Desk"}\n',
    );
    await seedOrgFile(`automations/${SLUG}/views/main.json`, '{"id":"main"}\n');
    await seedOrgFile(`automations/${SLUG}/skills/triage/SKILL.md`, '# T\n');
    const entries = await diffAutomationInstall(ORG, SLUG);
    expect(entries.every((e) => e.domain !== 'automation')).toBe(true);
    const map = entryMap(entries);
    expect(map.get('skills:triage/SKILL.md')?.status).toBe('create');
  });
});

describe('diffAutomationInstall — override status on an edited shell file', () => {
  it("flags a changed agent file as 'override'", async () => {
    await seedFullBundle();
    await seedOrgFile(
      `automations/${SLUG}/agents/helper.json`,
      '{"slug":"desk/helper","v":"user-edited"}\n',
    );
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));
    expect(map.get('automation:agents/helper.json')?.status).toBe('override');
  });
});

describe('diffAutomationInstall — kind/slug classification', () => {
  it('classifies every planned file and derives the owning slug', async () => {
    await seedFullBundle();
    const map = entryMap(await diffAutomationInstall(ORG, SLUG));

    expect(map.get('automation:automation.json')).toMatchObject({
      kind: 'manifest',
    });
    expect(map.get('automation:icon.svg')).toMatchObject({ kind: 'icon' });
    expect(map.get('automation:agents/helper.json')).toMatchObject({
      kind: 'agent',
      slug: 'desk/helper',
    });
    expect(map.get('automation:views/main.json')).toMatchObject({
      kind: 'view',
    });
    expect(map.get('automation:messages/en.json')).toMatchObject({
      kind: 'message',
    });
    expect(map.get('integrations:github/definition.json')).toMatchObject({
      kind: 'integration',
      slug: 'github',
    });
    expect(map.get('skills:triage/SKILL.md')).toMatchObject({
      kind: 'skill',
      slug: 'triage',
    });
  });
});

describe('preflightKey', () => {
  it('is the stable domain:path identity', () => {
    expect(preflightKey({ domain: 'skills', path: 'triage/SKILL.md' })).toBe(
      'skills:triage/SKILL.md',
    );
  });
});
