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

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'retention-bounds-'));
  vi.stubEnv('TALE_CONFIG_DIR', configRoot);
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

  it('stays quiet when the organization has no bounds file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadOrgRetentionConfig('acme')).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
