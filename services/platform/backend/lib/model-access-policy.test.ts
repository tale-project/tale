import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serializePolicyYaml } from '../core/governance/file_utils';
import { evaluateModelAccess } from '../core/governance/model_access_enforcement';
import { readGovernancePolicySnapshot } from './governance-policy-write';
import { clearOrgConfigCaches, readGovernancePolicy } from './org-config';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'model-access-policy-'));
  await mkdir(path.join(root, 'synthetic-org', 'governance'), {
    recursive: true,
  });
  vi.stubEnv('TALE_CONFIG_DIR', root);
  clearOrgConfigCaches();
});

afterEach(async () => {
  clearOrgConfigCaches();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('legacy model access policies', () => {
  it.each(['json', 'yml'])(
    'preserves targetless rules and valid neighboring restrictions in %s reads and snapshots',
    async (extension) => {
      const config = {
        enabled: true,
        mode: 'blocklist',
        modelApi: { enabled: true },
        rules: [
          {
            scope: 'default',
            allowedModels: [],
            blockedModels: ['fixture/model'],
          },
          {
            scope: 'user',
            allowedModels: [],
            blockedModels: ['fixture/model'],
          },
          {
            scope: 'team',
            scopeId: '   ',
            allowedModels: [],
            blockedModels: ['fixture/model'],
          },
        ],
      };
      const filename = path.join(
        root,
        'synthetic-org',
        'governance',
        `model-access.${extension}`,
      );
      const original = JSON.stringify(config);
      await writeFile(filename, original);
      const read = await readGovernancePolicy('synthetic-org', 'model_access');
      expect(read).toEqual(config);
      expect(
        evaluateModelAccess(
          read,
          { userId: 'member-proof', teamIds: [] },
          'fixture/model',
        ).allowed,
      ).toBe(false);
      expect(
        await readGovernancePolicySnapshot('synthetic-org', 'model_access'),
      ).toMatchObject({ config });
      expect(() => serializePolicyYaml('model_access', config)).toThrow();
      expect(await readFile(filename, 'utf8')).toBe(original);
      const repaired = { ...config, rules: config.rules.slice(0, 1) };
      expect(() => serializePolicyYaml('model_access', repaired)).not.toThrow();
    },
  );
});
