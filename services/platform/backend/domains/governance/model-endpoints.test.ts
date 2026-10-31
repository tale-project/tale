import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => 'audit_1'),
}));

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import {
  modelEndpointShimHandlers,
  readModelEndpointPolicyForOrg,
  recordModelEndpointRefusal,
} from './model-endpoints.ts';

let root: string;
let file: string;
let sql: Sql;
const tx = { tx: true };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'model-endpoints-'));
  const directory = path.join(root, 'synthetic-org', 'governance');
  await mkdir(directory, { recursive: true });
  file = path.join(directory, 'model-access.yml');
  vi.stubEnv('TALE_CONFIG_DIR', root);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the slug read and `begin` are all these paths use
  sql = Object.assign(
    vi.fn(async () => [{ slug: 'synthetic-org' }]),
    { begin: vi.fn(async (run: (t: unknown) => Promise<unknown>) => run(tx)) },
  ) as unknown as Sql;
  clearOrgConfigCaches();
  vi.mocked(createAuditLog).mockClear();
});

afterEach(async () => {
  clearOrgConfigCaches();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('readModelEndpointPolicyForOrg', () => {
  it('is open without a model access policy [GOV-R17]', async () => {
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'open' });
  });

  it('is open while the switch is off [GOV-R17]', async () => {
    await writeFile(
      file,
      'enabled: true\nmode: allowlist\nrules: []\neuProcessing:\n  enabled: false\n',
    );
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'open' });
  });

  it('carries the attested hosts while the switch is on [GOV-R17]', async () => {
    await writeFile(
      file,
      [
        'enabled: false',
        'mode: allowlist',
        'rules: []',
        'euProcessing:',
        '  enabled: true',
        '  hosts:',
        '    - llm.example.eu',
        '    - contoso-se.openai.azure.com',
        '',
      ].join('\n'),
    );
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({
      kind: 'eu',
      attestedHosts: ['contoso-se.openai.azure.com', 'llm.example.eu'],
    });
  });

  it('reads the file as it is now, not as a cache remembers it [GOV-R17]', async () => {
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'open' });
    await writeFile(
      file,
      'enabled: false\nmode: allowlist\nrules: []\neuProcessing:\n  enabled: true\n',
    );
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'eu', attestedHosts: [] });
  });

  it('is unreadable, never open, while the file is corrupt [GOV-R17]', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(file, 'euProcessing: yes please\n');
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'unreadable' });
    expect(error).toHaveBeenCalledOnce();
  });

  it('is unreadable while the organization cannot be resolved [GOV-R17]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the slug read is used
    const noOrg = vi.fn(async () => []) as unknown as Sql;
    await expect(
      readModelEndpointPolicyForOrg(noOrg, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'unreadable' });
  });

  it('is open on a deployment without a config root [GOV-R17]', async () => {
    vi.stubEnv('TALE_CONFIG_DIR', '');
    await expect(
      readModelEndpointPolicyForOrg(sql, 'synthetic-id'),
    ).resolves.toEqual({ kind: 'open' });
  });
});

describe('recordModelEndpointRefusal', () => {
  it('writes a denied security entry naming the surface and the reason [GOV-R17]', async () => {
    await recordModelEndpointRefusal(sql, {
      organizationId: 'synthetic-id',
      surface: 'chat',
      provider: 'openrouter',
      model: 'openai/gpt-5',
      host: 'openrouter.ai',
      reason: 'vendor-global',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      message: 'This organization processes prompts only in the EU/EEA, …',
      actor: { id: 'user_1', type: 'user' },
    });
    expect(createAuditLog).toHaveBeenCalledExactlyOnceWith(tx, {
      organizationId: 'synthetic-id',
      actorId: 'user_1',
      actorType: 'user',
      action: 'model_access.denied',
      category: 'security',
      resourceType: 'provider',
      resourceId: 'openrouter',
      resourceName: 'openrouter',
      status: 'denied',
      errorMessage: 'This organization processes prompts only in the EU/EEA, …',
      metadata: {
        rule: 'eu_processing',
        surface: 'chat',
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        model: 'openai/gpt-5',
        host: 'openrouter.ai',
        reason: 'vendor-global',
      },
    });
  });

  it('names the platform when no person asked [GOV-R17]', async () => {
    await recordModelEndpointRefusal(sql, {
      organizationId: 'synthetic-id',
      surface: 'embedding',
      provider: 'openai',
      code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
      message: 'The model access policy cannot be read, …',
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        metadata: {
          rule: 'eu_processing',
          surface: 'embedding',
          code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
        },
      }),
    );
  });
});

describe('modelEndpointShimHandlers', () => {
  it('answers both seams through every credential shim [GOV-R17]', async () => {
    const handlers = credentialShimHandlers(sql);
    const policy =
      handlers['governance/internal_queries:getModelEndpointPolicyInternal'];
    const record =
      handlers['governance/internal_mutations:recordModelEndpointRefusal'];
    if (policy === undefined || record === undefined) {
      throw new Error('the credential shim lost the EU/EEA seams');
    }
    await expect(policy({ organizationId: 'synthetic-id' })).resolves.toEqual({
      kind: 'open',
    });
    await expect(
      record({
        organizationId: 'synthetic-id',
        surface: 'chat',
        provider: 'openrouter',
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        message: 'refused',
      }),
    ).resolves.toBeNull();
    expect(createAuditLog).toHaveBeenCalledOnce();
  });

  it('refuses a malformed write rather than auditing half of it', async () => {
    const record =
      modelEndpointShimHandlers(sql)[
        'governance/internal_mutations:recordModelEndpointRefusal'
      ];
    await expect(
      record?.({ organizationId: 'synthetic-id', surface: 'chat' }),
    ).rejects.toThrow();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
