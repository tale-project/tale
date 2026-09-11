import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../core/lib/ctx.ts';
import { resolveTurnVisionModel } from '../../core/lib/providers/resolve_vision_model.ts';
import {
  clearOrgConfigCaches,
  readGovernancePolicy,
} from '../../lib/org-config.ts';
import { governanceShimHandlers } from './shim.ts';

let root: string;
let directory: string;
let slug: string | null;
let sql: Sql;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vision-policy-read-'));
  directory = path.join(root, 'synthetic-org', 'governance');
  await mkdir(directory, { recursive: true });
  vi.stubEnv('TALE_CONFIG_DIR', root);
  slug = 'synthetic-org';
  sql = vi.fn(async () => (slug === null ? [] : [{ slug }])) as unknown as Sql;
  clearOrgConfigCaches();
});

afterEach(async () => {
  clearOrgConfigCaches();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function read(policyType = 'vision_model') {
  const handler =
    governanceShimHandlers(sql)[
      'governance/internal_queries:getPolicyConfigInternal'
    ];
  if (!handler) throw new Error('missing governance shim');
  return handler({ organizationId: 'synthetic-id', policyType });
}

describe('native vision policy file admission', () => {
  it('carries a real corrupt policy through the shim to a safe managed-turn failure', async () => {
    await writeFile(
      path.join(directory, 'vision-model.yml'),
      'providerSlug: local\nprivate: token-do-not-disclose\n',
    );
    const handler =
      governanceShimHandlers(sql)[
        'governance/internal_queries:getPolicyConfigInternal'
      ];
    if (!handler) throw new Error('missing governance shim');
    const runQuery = vi.fn(async (_ref: unknown, args: unknown) =>
      handler(args),
    );
    const ctx = { runQuery } as unknown as ActionCtx;
    const error = await resolveTurnVisionModel(ctx, 'synthetic-id', {
      providerSlug: 'local',
      modelId: 'text-model',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'VISION_MODEL_POLICY_UNAVAILABLE' });
    expect(String(error)).not.toContain('token-do-not-disclose');
    expect(runQuery).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      organizationId: 'synthetic-id',
      policyType: 'vision_model',
    });
  });

  it.each([
    '{ broken: [',
    'providerSlug: local\n',
    'modelId: exact-vision\n',
    'providerSlug: local\nmodelId: 42\n',
  ])(
    'refuses malformed persisted YAML instead of the stale JSON or Auto',
    async (content) => {
      await writeFile(path.join(directory, 'vision-model.yml'), content);
      await writeFile(path.join(directory, 'vision-model.json'), '{}');
      await expect(read()).rejects.toThrow('Governance policy');
    },
  );

  it('refuses a symlink and a file over the policy size cap', async () => {
    const other = path.join(root, 'private-provider.yml');
    await writeFile(other, 'providerSlug: other\nmodelId: other-vision\n');
    const file = path.join(directory, 'vision-model.yml');
    await symlink(other, file);
    await expect(read()).rejects.toThrow('Governance policy');
    await rm(file);
    await writeFile(file, '#'.repeat(256 * 1024 + 1));
    await expect(read()).rejects.toThrow('Governance policy');
  });

  it('keeps absent and explicit empty policy as Auto, and supports a legacy JSON pin', async () => {
    await expect(read()).resolves.toBeNull();
    await writeFile(
      path.join(directory, 'vision-model.json'),
      JSON.stringify({ providerSlug: 'local', modelId: 'exact-vision' }),
    );
    await expect(read()).resolves.toEqual({
      providerSlug: 'local',
      modelId: 'exact-vision',
    });
    await writeFile(path.join(directory, 'vision-model.yml'), '{}\n');
    await expect(read()).resolves.toEqual({});
  });

  it('cannot reuse a permissive cached Auto result or an older valid pin', async () => {
    await expect(
      readGovernancePolicy('synthetic-org', 'vision_model'),
    ).resolves.toBeNull();
    const file = path.join(directory, 'vision-model.yml');
    await writeFile(file, 'providerSlug: local\nmodelId: exact-vision\n');
    await expect(read()).resolves.toEqual({
      providerSlug: 'local',
      modelId: 'exact-vision',
    });
    await writeFile(file, 'providerSlug: local\n');
    await expect(read()).rejects.toThrow('Governance policy');
    await writeFile(file, 'providerSlug: local\nmodelId: restored-vision\n');
    await expect(read()).resolves.toEqual({
      providerSlug: 'local',
      modelId: 'restored-vision',
    });
  });

  it('reads the current organization slug and refuses an unresolved organization', async () => {
    await expect(read()).resolves.toBeNull();
    const renamed = path.join(root, 'renamed-org', 'governance');
    await mkdir(renamed, { recursive: true });
    await writeFile(
      path.join(renamed, 'vision-model.yml'),
      'providerSlug: renamed-local\nmodelId: exact-vision\n',
    );
    slug = 'renamed-org';
    await expect(read()).resolves.toEqual({
      providerSlug: 'renamed-local',
      modelId: 'exact-vision',
    });
    slug = null;
    await expect(read()).rejects.toThrow('Governance policy');
  });

  it.each(['unset', 'absent', 'not-directory'])(
    'refuses a %s configuration root',
    async (kind) => {
      if (kind === 'unset') vi.stubEnv('TALE_CONFIG_DIR', '');
      else {
        const unusable = path.join(root, 'unusable');
        if (kind === 'not-directory')
          await writeFile(unusable, 'private configuration');
        vi.stubEnv('TALE_CONFIG_DIR', unusable);
      }
      await expect(read()).rejects.toThrow('Governance policy');
    },
  );

  it('keeps another policy’s established best-effort default unchanged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(path.join(directory, 'task-automation.yml'), '{ broken: [');
    await expect(read('task_automation')).resolves.toBeNull();
  });
});
