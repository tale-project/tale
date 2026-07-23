// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import { brokerCredentialDataSchema } from '../../../../../lib/shared/schemas/providers';
import {
  decryptSecret,
  type EncryptedSecret,
} from '../../../../lib/secret_box';
import { buildModules } from '../../../framework/test_helpers';
import type { WorldHandle } from '../../../testing/harness.testkit';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/02_provider_credentials_from_files';
const MARKER = 'migration:0.4.0/02_provider_credentials_from_files';

// Seeded old-world fixtures for org1 (org2 stays empty — the per-org no-op
// path). Covers a provider with every credential source of the retired
// format (provider env ref, sidecar api key, per-model file key, per-model
// env ref), a corrupt provider config, a fully-mapped token source with a
// stored broker secret, and a token source that cannot map (http endpoint).
const PROVIDER_API_KEY = 'sk-live-openai-0123456789';
const MODEL_API_KEY = 'sk-model-gpt4o-9876543210';
const BROKER_SECRET = 'broker-secret-abcdef123456';

const OPENAI_PROVIDER = {
  displayName: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  secretsEnv: 'TALE_PROVIDER_KEY_OPENAI',
  models: [
    { id: 'gpt-4o', displayName: 'GPT-4o', tags: ['chat'] },
    {
      id: 'whisper-1',
      displayName: 'Whisper',
      tags: ['transcription'],
      secretsEnv: 'TALE_PROVIDER_KEY_WHISPER',
    },
  ],
};
const OPENAI_SECRETS = {
  apiKey: PROVIDER_API_KEY,
  modelKeys: { 'gpt-4o': MODEL_API_KEY },
};
const CLAUDE_POOL = {
  slug: 'claude-pool',
  displayName: 'Claude Pool',
  endpoint: 'https://broker.example.com/api/tokens',
  method: 'GET',
  auth: { method: 'bearer', secretEnv: 'TALE_TOKEN_SOURCE_POOL' },
  responseMapping: {
    tokensPath: '$.tokens',
    tokenField: 'access_token',
    statusField: 'status',
    statusActiveValue: 'active',
    expiryField: 'expires_at',
  },
  targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  selection: 'round-robin',
  timeoutMs: 5000,
};
const INSECURE_POOL = {
  slug: 'insecure',
  displayName: 'Insecure Pool',
  endpoint: 'http://broker.internal/tokens',
  responseMapping: { tokensPath: '$.tokens', tokenField: 'token' },
  targetEnvVar: 'SOME_TOKEN',
};

interface CredentialRow {
  organizationId: string;
  providerSlug: string;
  authMethod: string;
  name: string;
  encryptedData?: EncryptedSecret;
  envName?: string;
  maskedPreview?: string;
  modelAllowlist?: string[];
  isDefault: boolean;
  status: string;
  createdBy: string;
}

async function credentialRows(world: WorldHandle): Promise<CredentialRow[]> {
  return await world.run(async (ctx) => {
    const rows = (await ctx.db
      .query('providerCredentials')
      .collect()) as CredentialRow[];
    return rows;
  });
}

function rowsOf(
  rows: readonly CredentialRow[],
  organizationId: string,
): CredentialRow[] {
  return rows.filter((row) => row.organizationId === organizationId);
}

function byName(rows: readonly CredentialRow[], name: string): CredentialRow {
  const row = rows.find((entry) => entry.name === name);
  expect(row, `expected a credential named "${name}"`).toBeDefined();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the expect above guarantees presence
  return row as CredentialRow;
}

async function seedOrgFiles(root: string, orgSlug: string): Promise<void> {
  const json = (data: unknown): string => JSON.stringify(data, null, 2) + '\n';
  const providers = path.join(root, orgSlug, 'providers');
  const tokenSources = path.join(root, orgSlug, 'token-sources');
  await mkdir(providers, { recursive: true });
  await mkdir(tokenSources, { recursive: true });

  await writeFile(path.join(providers, 'openai.json'), json(OPENAI_PROVIDER));
  await writeFile(
    path.join(providers, 'openai.secrets.json'),
    json(OPENAI_SECRETS),
  );
  // A config no parser accepts — the retired loader skipped it with a
  // warning; the migration must do the same, not fail the org.
  await writeFile(path.join(providers, 'broken.json'), '{ not json\n');

  await writeFile(
    path.join(tokenSources, 'claude-pool.json'),
    json(CLAUDE_POOL),
  );
  await writeFile(
    path.join(tokenSources, 'claude-pool.secrets.json'),
    json({ authSecret: BROKER_SECRET }),
  );
  await writeFile(
    path.join(tokenSources, 'insecure.json'),
    json(INSECURE_POOL),
  );
}

// Harness ritual: real fleet up, handler idempotency over migrated state,
// down restoring the seed digest (rows removed, files untouched), ledger
// coverage per org. Everything migration-specific is asserted in expectUp
// and the cases below.
defineMigrationTest({
  id: '0.4.0/02_provider_credentials_from_files',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 with NO files exercises the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    await seedOrgFiles(root, orgs[0].slug);
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const all = await credentialRows(world);
    const rows = rowsOf(all, org1.id);

    // Five rows for org1: four from the provider file, one from the
    // mappable token source. Nothing from the corrupt config or the
    // http-endpoint source; org2 untouched.
    expect(rows).toHaveLength(5);
    expect(rowsOf(all, org2.id)).toHaveLength(0);
    for (const row of rows) {
      expect(row.createdBy).toBe(MARKER);
      expect(row.status).toBe('active');
    }

    // Provider-level env ref: first inserted, so the openai default —
    // matching the retired resolution order (env preferred over file key).
    const envRow = byName(rows, 'Environment key');
    expect(envRow.providerSlug).toBe('openai');
    expect(envRow.authMethod).toBe('env');
    expect(envRow.envName).toBe('TALE_PROVIDER_KEY_OPENAI');
    expect(envRow.isDefault).toBe(true);
    expect(envRow.encryptedData).toBeUndefined();
    expect(envRow.modelAllowlist).toBeUndefined();

    // Sidecar api key: re-encrypted with secret_box, masked at write time.
    const apiRow = byName(rows, 'API key');
    expect(apiRow.providerSlug).toBe('openai');
    expect(apiRow.authMethod).toBe('api-key');
    expect(apiRow.isDefault).toBe(false);
    expect(apiRow.maskedPreview).toBe('sk-l…89');
    expect(apiRow.envName).toBeUndefined();
    expect(decryptSecret(apiRow.encryptedData as EncryptedSecret)).toBe(
      PROVIDER_API_KEY,
    );

    // Model-scoped sources carry the allowlist restriction.
    const modelKeyRow = byName(rows, 'Model key — gpt-4o');
    expect(modelKeyRow.authMethod).toBe('api-key');
    expect(modelKeyRow.modelAllowlist).toEqual(['gpt-4o']);
    expect(decryptSecret(modelKeyRow.encryptedData as EncryptedSecret)).toBe(
      MODEL_API_KEY,
    );
    const modelEnvRow = byName(rows, 'Model env key — whisper-1');
    expect(modelEnvRow.authMethod).toBe('env');
    expect(modelEnvRow.envName).toBe('TALE_PROVIDER_KEY_WHISPER');
    expect(modelEnvRow.modelAllowlist).toEqual(['whisper-1']);

    // The token source becomes an anthropic subscription-broker credential;
    // its whole document (old fields renamed, defaults filled, sidecar
    // secret folded in) rides the encrypted envelope.
    const brokerRow = byName(rows, 'Claude Pool');
    expect(brokerRow.providerSlug).toBe('anthropic');
    expect(brokerRow.authMethod).toBe('subscription-broker');
    expect(brokerRow.isDefault).toBe(true);
    expect(brokerRow.maskedPreview).toBe('brok…56');
    const broker = brokerCredentialDataSchema.parse(
      JSON.parse(decryptSecret(brokerRow.encryptedData as EncryptedSecret)),
    );
    expect(broker).toEqual({
      endpoint: 'https://broker.example.com/api/tokens',
      httpMethod: 'GET',
      auth: { method: 'bearer', secretEnv: 'TALE_TOKEN_SOURCE_POOL' },
      responseMapping: {
        tokensPath: '$.tokens',
        tokenField: 'access_token',
        statusField: 'status',
        activeValue: 'active',
        expiresField: 'expires_at',
      },
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      selection: 'round-robin',
      timeoutMs: 5000,
      maxResponseBytes: 262_144,
      expirySkewMs: 300_000,
      authSecret: BROKER_SECRET,
    });
  },

  cases: {
    'a name the user already holds is skipped, never overwritten': async (
      world,
    ) => {
      const [org1] = world.orgs;
      const userCipher = {
        ciphertext: 'user-cipher',
        nonce: 'user-nonce',
        authTag: 'user-tag',
        keyFingerprint: 'user-fp',
      };
      await world.run(async (ctx) => {
        await ctx.db.insert('providerCredentials', {
          organizationId: org1.id,
          providerSlug: 'openai',
          authMethod: 'api-key',
          // Clashes case-insensitively with the migrated "API key" row.
          name: 'api KEY',
          encryptedData: userCipher,
          maskedPreview: 'user…xx',
          isDefault: true,
          status: 'active',
          createdBy: 'user_1',
          createdAt: 1,
          updatedAt: 1,
        });
      });

      await world.applyUpOnly();
      const rows = rowsOf(await credentialRows(world), org1.id);

      // The user's row is untouched and keeps the default; the migration's
      // own api-key row was skipped, everything else still landed.
      const userRow = byName(rows, 'api KEY');
      expect(userRow.createdBy).toBe('user_1');
      expect(userRow.isDefault).toBe(true);
      expect(userRow.encryptedData).toEqual(userCipher);
      expect(rows.some((row) => row.name === 'API key')).toBe(false);
      const envRow = byName(rows, 'Environment key');
      expect(envRow.createdBy).toBe(MARKER);
      expect(envRow.isDefault).toBe(false);

      // Down removes only the marker rows — the user's credential survives.
      await world.applyDownOnly();
      const after = rowsOf(await credentialRows(world), org1.id);
      expect(after).toHaveLength(1);
      expect(after[0].name).toBe('api KEY');
    },

    'an unreadable secrets sidecar skips only the key rows': async (world) => {
      const [, org2] = world.orgs;
      const providers = path.join(world.configRoot, org2.slug, 'providers');
      await mkdir(providers, { recursive: true });
      await writeFile(
        path.join(providers, 'acme.json'),
        JSON.stringify(
          {
            displayName: 'Acme',
            baseUrl: 'https://api.acme.test/v1',
            secretsEnv: 'TALE_PROVIDER_KEY_ACME',
            models: [{ id: 'acme-1', displayName: 'Acme One', tags: ['chat'] }],
          },
          null,
          2,
        ),
      );
      await writeFile(path.join(providers, 'acme.secrets.json'), '{ nope\n');

      await world.applyUpOnly();
      const rows = rowsOf(await credentialRows(world), org2.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Environment key');
      expect(rows[0].authMethod).toBe('env');
      expect(rows[0].isDefault).toBe(true);
    },
  },
});
