import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  assertTaskAutomationEnabled,
  taskAutomationEnabled,
} from './run-start.ts';

let root: string;
let policy: string;
const tx = vi.fn(async () => [
  { slug: 'synthetic-org' },
]) as unknown as TransactionSql;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'task-start-policy-'));
  const directory = path.join(root, 'synthetic-org', 'governance');
  await mkdir(directory, { recursive: true });
  policy = path.join(directory, 'task-automation.yml');
  vi.stubEnv('TALE_CONFIG_DIR', root);
  clearOrgConfigCaches();
});

afterEach(async () => {
  clearOrgConfigCaches();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('task automation start policy', () => {
  it('allows an absent policy and observes disable and re-enable without a cached grace period', async () => {
    await expect(taskAutomationEnabled(tx, 'synthetic')).resolves.toBe(true);
    await writeFile(policy, 'enabled: false\n');
    await expect(taskAutomationEnabled(tx, 'synthetic')).resolves.toBe(false);
    await expect(
      assertTaskAutomationEnabled(tx, 'synthetic'),
    ).rejects.toMatchObject({ code: 'TASK_AUTOMATION_DISABLED', status: 403 });
    await writeFile(policy, 'enabled: true\n');
    await expect(
      assertTaskAutomationEnabled(tx, 'synthetic'),
    ).resolves.toBeUndefined();
  });

  it('refuses unreadable policy instead of silently starting paid work', async () => {
    await writeFile(policy, 'enabled: not-a-boolean\n');
    await expect(taskAutomationEnabled(tx, 'synthetic')).rejects.toMatchObject({
      code: 'TASK_AUTOMATION_UNAVAILABLE',
      status: 409,
    });
  });
});
