// @vitest-environment node

/**
 * An organization's creation scaffolds its config tree in a worker job that
 * runs AFTER the create returns. Whatever the new organization is given in
 * that window — a provider, an agent or a governance file a client or an
 * automation writes right after the create — must still be there once the
 * job has run (#5437). The leftover tree of an earlier holder of the slug is
 * purged at create time instead, while no organization owns the slug.
 *
 * The scaffold runs here exactly as the job runs it for a new organization:
 * with the payload `afterCreateOrganization` queues.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Runs once just before the scaffold opens the temp file of a catalog
 *  copy — the moment after its existence check, when a config writer can
 *  still save the same file. */
let beforeTempOpen: ((tmpPath: string) => Promise<void>) | undefined;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open: typeof actual.open = async (...args) => {
    const hook = beforeTempOpen;
    if (hook && String(args[0]).endsWith('.tmp')) {
      beforeTempOpen = undefined;
      await hook(String(args[0]));
    }
    return actual.open(...args);
  };
  return { ...actual, default: { ...actual, open }, open };
});

import { scaffoldOrgFromCatalog } from '../../core/organizations/scaffold.ts';
import {
  clearOrgConfigLeftovers,
  orgCreateScaffoldPayload,
} from './scaffold.ts';

const SLUG = 'acme';
const CATALOG_RETENTION = 'auditLog:\n  default: 730\n';

let root: string;
let configRoot: string;
let catalogRoot: string;

function governanceFile(name: string): string {
  return path.join(configRoot, SLUG, 'governance', name);
}

async function write(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The scaffold job of a new organization, as the worker runs it. */
async function runCreateScaffold(): Promise<void> {
  const result = await scaffoldOrgFromCatalog(orgCreateScaffoldPayload(SLUG));
  expect(result.ok).toBe(true);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'org-scaffold-'));
  configRoot = path.join(root, 'data');
  catalogRoot = path.join(root, 'builtin');
  await mkdir(configRoot, { recursive: true });
  await write(
    path.join(catalogRoot, 'governance', 'retention.yml'),
    CATALOG_RETENTION,
  );
  vi.stubEnv('TALE_CONFIG_DIR', configRoot);
  vi.stubEnv('TALE_CONFIG_BUILTIN_DIR', catalogRoot);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  beforeTempOpen = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('creating an organization', () => {
  it('keeps a config file written right after the create, before the scaffold job runs', async () => {
    await clearOrgConfigLeftovers(SLUG);
    // The create has returned; a client writes the org's first config file
    // before the worker picks up the scaffold job.
    await write(governanceFile('custom-policy.yml'), 'mine: true\n');

    await runCreateScaffold();

    expect(await readOrNull(governanceFile('custom-policy.yml'))).toBe(
      'mine: true\n',
    );
    // The domain the client wrote into is still seeded from the catalog.
    expect(await readOrNull(governanceFile('retention.yml'))).toBe(
      CATALOG_RETENTION,
    );
  });

  it('keeps a catalog-named file the organization wrote first instead of overwriting it', async () => {
    await clearOrgConfigLeftovers(SLUG);
    await write(governanceFile('retention.yml'), 'auditLog:\n  default: 90\n');

    await runCreateScaffold();

    expect(await readOrNull(governanceFile('retention.yml'))).toBe(
      'auditLog:\n  default: 90\n',
    );
  });

  it('keeps a catalog-named file a writer saves while the scaffold job is copying it', async () => {
    await clearOrgConfigLeftovers(SLUG);
    beforeTempOpen = async () => {
      await write(
        governanceFile('retention.yml'),
        'auditLog:\n  default: 90\n',
      );
    };

    await runCreateScaffold();

    expect(beforeTempOpen).toBeUndefined();
    expect(await readOrNull(governanceFile('retention.yml'))).toBe(
      'auditLog:\n  default: 90\n',
    );
  });

  it('purges a leftover tree of the slug at create time, so the scaffold seeds a clean copy', async () => {
    await write(governanceFile('orphan.yml'), 'stale: true\n');
    await write(governanceFile('retention.yml'), 'stale: true\n');

    await clearOrgConfigLeftovers(SLUG);
    await runCreateScaffold();

    expect(await readOrNull(governanceFile('orphan.yml'))).toBeNull();
    expect(await readOrNull(governanceFile('retention.yml'))).toBe(
      CATALOG_RETENTION,
    );
  });
});

describe('creating an organization with a skill bundle in the catalog', () => {
  it('keeps a bundle the organization wrote first whole, without catalog files mixed in', async () => {
    await write(path.join(catalogRoot, 'skills', 'triage', 'SKILL.md'), 'cat');
    await write(path.join(catalogRoot, 'skills', 'triage', 'notes.md'), 'cat');
    await write(path.join(catalogRoot, 'skills', 'review', 'SKILL.md'), 'cat');
    await clearOrgConfigLeftovers(SLUG);
    const skills = path.join(configRoot, SLUG, 'skills');
    await write(path.join(skills, 'triage', 'SKILL.md'), 'mine');

    await runCreateScaffold();

    expect(await readOrNull(path.join(skills, 'triage', 'SKILL.md'))).toBe(
      'mine',
    );
    expect(
      await readOrNull(path.join(skills, 'triage', 'notes.md')),
    ).toBeNull();
    expect(await readOrNull(path.join(skills, 'review', 'SKILL.md'))).toBe(
      'cat',
    );
  });
});
