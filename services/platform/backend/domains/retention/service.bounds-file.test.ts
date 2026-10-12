// @vitest-environment node

/**
 * The bounds file an organization's retention editor reads. A file that
 * exists but does not parse reads as no file — the editor shows no bounds
 * and every save is refused — so its reason has to reach the log: an
 * operator who set a floor below its compliance floor has nothing else to
 * go on.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOrgRetentionConfig } from './service.ts';

let configRoot: string;
/** The built-in catalog a test controls; it holds nothing until a test
 * writes one. */
let catalogRoot: string;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'retention-bounds-'));
  catalogRoot = path.join(configRoot, 'builtin');
  vi.stubEnv('TALE_CONFIG_DIR', configRoot);
  vi.stubEnv('TALE_CONFIG_BUILTIN_DIR', catalogRoot);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(configRoot, { recursive: true, force: true });
});

async function writeAuditLogFloor(min: number): Promise<void> {
  const dir = path.join(configRoot, 'acme', 'governance');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'retention.yml'),
    `auditLog:\n  min: ${min}\n  max: 3650\n  default: 730\n  unit: days\n`,
  );
}

async function writeCatalog(file: string): Promise<void> {
  const dir = path.join(catalogRoot, 'governance');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'retention.yml'), file);
}

const CATALOG_WITH_VERSIONS = [
  '_metadata:',
  '  envPrefix: TALE_RETENTION_',
  '  envNames:',
  '    VERSIONS_MAX: automationVersions.max',
  'auditLog:',
  '  min: 180',
  '  max: 3650',
  '  default: 730',
  '  unit: days',
  'automationVersions:',
  '  min: 90',
  '  max: 3650',
  '  default: 3650',
  '  unit: days',
  '',
].join('\n');

describe('loadOrgRetentionConfig', () => {
  it('reads an audit-log floor of 180 days [RETAIN-R5]', async () => {
    await writeAuditLogFloor(180);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadOrgRetentionConfig('acme')).resolves.toMatchObject({
      auditLog: { min: 180, max: 3650 },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs why a floor below its compliance floor reads as no bounds [RETAIN-R5]', async () => {
    await writeAuditLogFloor(179);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadOrgRetentionConfig('acme')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    const [line] = warn.mock.calls[0] ?? [];
    expect(line).toContain('bounds file unreadable for org acme');
    expect(line).toContain('compliance floor violation: auditLog.min >= 180');
  });

  it('gives an organization seeded before a category existed the built-in catalog’s bounds for it', async () => {
    await writeAuditLogFloor(365);
    await writeCatalog(CATALOG_WITH_VERSIONS);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = await loadOrgRetentionConfig('acme');
    // The org's own file wins where it speaks; the catalog fills the rest.
    expect(config?.auditLog).toMatchObject({ min: 365 });
    expect(config?.automationVersions).toEqual({
      min: 90,
      max: 3650,
      default: 3650,
      unit: 'days',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('adds nothing when no catalog can be reached, and says nothing about it', async () => {
    await writeAuditLogFloor(365);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = await loadOrgRetentionConfig('acme');
    expect(config?.automationVersions).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs an unreadable catalog and keeps the organization’s own bounds', async () => {
    await writeAuditLogFloor(365);
    await writeCatalog(
      'auditLog:\n  min: 1\n  max: 3650\n  default: 730\n  unit: days\n',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = await loadOrgRetentionConfig('acme');
    expect(config?.auditLog).toMatchObject({ min: 365 });
    expect(config?.automationVersions).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(
      'built-in bounds catalog unreadable',
    );
  });

  it('stays quiet when the organization has no bounds file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadOrgRetentionConfig('acme')).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
