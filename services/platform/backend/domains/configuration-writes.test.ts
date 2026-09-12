// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readGovernancePolicySnapshot,
  writeGovernancePolicyFile,
} from '../lib/governance-policy-write';
import { readBrandingConfig, saveBranding } from './branding/service';
import {
  readDeploymentConfigView,
  saveDeploymentConfig,
} from './deployment/service';
import {
  readKnowledgeEmbeddingView,
  writeKnowledgeEmbedding,
} from './knowledge/admin';
import {
  readProviderDefinition,
  saveProviderDefinition,
} from './providers/config';

const { audit } = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));
vi.mock('./audit_logs/service', () => ({ createAuditLog: audit }));

/** PostgreSQL advisory-lock fixture: queues the exact native lock key and
 * holds it to transaction completion. Real file readers/writers remain active. */
function lockedSql(): Sql {
  const tails = new Map<string, Promise<void>>();
  const tag = async () => [];
  const begin = async (work: (tx: unknown) => Promise<unknown>) => {
    const release: (() => void)[] = [];
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('').includes('pg_advisory_xact_lock')) {
        const key = String(values[0]);
        const prior = tails.get(key) ?? Promise.resolve();
        let done!: () => void;
        const next = new Promise<void>((resolve) => {
          done = resolve;
        });
        tails.set(
          key,
          prior.then(() => next),
        );
        await prior;
        release.push(done);
      }
      return [];
    };
    try {
      return await work(tx);
    } finally {
      for (const done of release) done();
    }
  };
  return Object.assign(tag, { begin }) as unknown as Sql;
}

let directory: string;
const scope = { organizationId: 'org-a', orgSlug: 'north', userId: 'operator' };
const provider = providerDefinitionSchema.parse({
  name: 'local-chat',
  displayName: 'Local chat',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.test/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'env' }],
});
const embedding = {
  providerSlug: 'local-chat',
  model: 'model-a',
  dimensions: 16,
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'native-config-cas-'));
  vi.stubEnv('TALE_CONFIG_DIR', directory);
  audit.mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('native file configuration preconditions', () => {
  it('does not publish a provider when its native audit write fails', async () => {
    audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      saveProviderDefinition(lockedSql(), scope, provider.name, provider, null),
    ).rejects.toThrow('audit unavailable');
    expect(await readProviderDefinition('north', provider.name)).toEqual({
      config: null,
      hash: null,
    });
  });

  it('creates, updates and archives exact custom provider bytes without changing another org', async () => {
    const sql = lockedSql();
    expect(await readProviderDefinition('north', provider.name)).toEqual({
      config: null,
      hash: null,
    });
    const first = await saveProviderDefinition(
      sql,
      scope,
      provider.name,
      provider,
      null,
    );
    const original = await readFile(
      join(directory, 'north/providers/local-chat.yml'),
      'utf8',
    );
    expect(await readProviderDefinition('south', provider.name)).toEqual({
      config: null,
      hash: null,
    });
    await expect(
      saveProviderDefinition(
        sql,
        scope,
        provider.name,
        { ...provider, displayName: 'Changed' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    const second = await saveProviderDefinition(
      sql,
      scope,
      provider.name,
      { ...provider, displayName: 'Changed' },
      first.hash,
    );
    expect(second.config?.displayName).toBe('Changed');
    const history = join(directory, 'north/providers/.history/local-chat');
    expect(
      await readFile(join(history, (await readdir(history))[0]!), 'utf8'),
    ).toBe(original);
    await saveProviderDefinition(
      sql,
      scope,
      provider.name,
      second.config!,
      second.hash,
    );
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it('refuses malformed/current provider identities and blocked endpoints without overwrite', async () => {
    const sql = lockedSql();
    await mkdir(join(directory, 'north/providers'), { recursive: true });
    const file = join(directory, 'north/providers/local-chat.yml');
    await writeFile(file, 'secret: [ malformed');
    await expect(
      saveProviderDefinition(sql, scope, provider.name, provider, null),
    ).rejects.toMatchObject({ code: 'CONFIG_UNREADABLE' });
    expect(await readFile(file, 'utf8')).toBe('secret: [ malformed');
    await expect(
      readProviderDefinition('north', '../escape'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readProviderDefinition('north', 'openai'),
    ).rejects.toMatchObject({ code: 'PROVIDER_NAME_RESERVED' });
    await expect(
      saveProviderDefinition(sql, scope, 'other', provider, null),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveProviderDefinition(
        sql,
        scope,
        provider.name,
        { ...provider, baseUrl: 'https://user:private@models.example.test' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_ENDPOINT_INVALID' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('allows one of two reviewed branding writers and holds stale plans after an ordinary UI save', async () => {
    const sql = lockedSql();
    await saveBranding(sql, 'north', { accentColor: '#111111' }, null);
    const first = await readBrandingConfig('north');
    const outcomes = await Promise.allSettled([
      saveBranding(sql, 'north', { accentColor: '#222222' }, first.hash),
      saveBranding(sql, 'north', { accentColor: '#333333' }, first.hash),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const second = await readBrandingConfig('north');
    await saveBranding(sql, 'north', { accentColor: '#444444' });
    await expect(
      saveBranding(sql, 'north', { accentColor: '#555555' }, second.hash),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect((await readBrandingConfig('north')).config?.accentColor).toBe(
      '#444444',
    );
  });

  it('reads the exact legacy policy preimage and preserves it when a guarded write is stale', async () => {
    const sql = lockedSql();
    await mkdir(join(directory, 'north/governance'), { recursive: true });
    await writeFile(
      join(directory, 'north/governance/vision-model.json'),
      '{"providerSlug":"local-chat","modelId":"old"}\n',
    );
    const first = await readGovernancePolicySnapshot('north', 'vision_model');
    await writeGovernancePolicyFile(
      sql,
      'north',
      'vision_model',
      { providerSlug: 'local-chat', modelId: 'new' },
      first.hash,
    );
    await expect(
      writeGovernancePolicyFile(
        sql,
        'north',
        'vision_model',
        { providerSlug: 'local-chat', modelId: 'stale' },
        first.hash,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(
      (await readGovernancePolicySnapshot('north', 'vision_model')).config,
    ).toEqual({ providerSlug: 'local-chat', modelId: 'new' });
  });

  it('updates existing embedding configuration only for its exact reviewed hash', async () => {
    const sql = lockedSql();
    expect(await readKnowledgeEmbeddingView('north')).toEqual({
      configured: false,
      config: null,
      hash: null,
    });
    await writeKnowledgeEmbedding(sql, 'north', embedding, null);
    const first = await readKnowledgeEmbeddingView('north');
    await writeKnowledgeEmbedding(
      sql,
      'north',
      { ...embedding, model: 'model-b' },
      first.hash,
    );
    await expect(
      writeKnowledgeEmbedding(sql, 'north', embedding, first.hash),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect((await readKnowledgeEmbeddingView('north')).config?.model).toBe(
      'model-b',
    );
    expect(await readKnowledgeEmbeddingView('south')).toEqual({
      configured: false,
      config: null,
      hash: null,
    });
  });

  it('supports explicit absence CAS for instance deployment configuration', async () => {
    const sql = lockedSql();
    const auth = {
      userId: 'operator',
      email: 'operator@example.test',
      organizationId: 'org-a',
      role: 'admin',
    };
    const first = await readDeploymentConfigView(auth);
    expect(first.hash).toBeNull();
    await saveDeploymentConfig(sql, auth, {
      config: { version: 1 },
      expectedHash: null,
    });
    await expect(
      saveDeploymentConfig(sql, auth, {
        config: { version: 1, sandboxRuntime: { tier: 'sysbox' } },
        expectedHash: null,
      }),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_VERSION_CONFLICT' });
  });

  it('does not treat a malformed concurrent instance file as absent', async () => {
    const file = join(directory, 'deployment.yml');
    const bytes = 'sandboxRuntime: [\n';
    await writeFile(file, bytes);
    await expect(
      saveDeploymentConfig(
        lockedSql(),
        {
          userId: 'operator',
          email: 'operator@example.test',
          organizationId: 'org-a',
          role: 'admin',
        },
        { config: { version: 1 }, expectedHash: null },
      ),
    ).rejects.toMatchObject({
      code: 'DEPLOYMENT_CONFIG_UNREADABLE',
    });
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect(audit).not.toHaveBeenCalled();
  });
});
