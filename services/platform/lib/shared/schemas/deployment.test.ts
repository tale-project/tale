import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_CONFIG_VERSION,
  DEPLOYMENT_SECRET_KEYS,
  convexStorageSchema,
  deploymentConfigSchema,
  deploymentSecretsSchema,
  pgConnectionSchema,
} from './deployment';

describe('deploymentConfigSchema', () => {
  it('accepts a minimal config (version only — all stores fall back to .env)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: DEPLOYMENT_CONFIG_VERSION,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a full external config (knowledge PG + S3 storage + app PG)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      dataStores: {
        knowledgePostgres: {
          host: 'pg.gematik.internal',
          database: 'tale_knowledge',
          user: 'tale_rw',
        },
        convexStorage: {
          mode: 's3',
          region: 'eu-central-1',
          buckets: {
            files: 'tale-files',
            exports: 'tale-exports',
            snapshotImports: 'tale-snap-imports',
            modules: 'tale-modules',
            search: 'tale-search',
          },
        },
        appPostgres: {
          host: 'pg.gematik.internal',
          database: 'tale',
          user: 'tale_rw',
        },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // defaults applied
      expect(r.data.dataStores?.knowledgePostgres?.port).toBe(5432);
      expect(r.data.dataStores?.knowledgePostgres?.sslmode).toBe('require');
    }
  });

  it('accepts local storage mode with no extra fields', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      dataStores: { convexStorage: { mode: 'local' } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown top-level key (strict)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      bogus: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown dataStores section (strict — protects against typos)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      dataStores: { knowledgePostgre: { host: 'x', database: 'y', user: 'z' } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a wrong version', () => {
    const r = deploymentConfigSchema.safeParse({ version: 2 });
    expect(r.success).toBe(false);
  });
});

describe('convexStorageSchema', () => {
  it('rejects s3 mode without all buckets (all-or-nothing)', () => {
    const r = convexStorageSchema.safeParse({
      mode: 's3',
      region: 'eu-central-1',
      buckets: { files: 'only-files' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts an S3-compatible endpoint + forcePathStyle (MinIO/R2)', () => {
    const r = convexStorageSchema.safeParse({
      mode: 's3',
      region: 'auto',
      endpoint: 'https://minio.gematik.internal',
      forcePathStyle: true,
      buckets: {
        files: 'f',
        exports: 'e',
        snapshotImports: 's',
        modules: 'm',
        search: 'se',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-URL endpoint', () => {
    const r = convexStorageSchema.safeParse({
      mode: 's3',
      region: 'auto',
      endpoint: 'not-a-url',
      buckets: {
        files: 'f',
        exports: 'e',
        snapshotImports: 's',
        modules: 'm',
        search: 'se',
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('pgConnectionSchema', () => {
  it('applies port/sslmode defaults', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.port).toBe(5432);
      expect(r.data.sslmode).toBe('require');
    }
  });

  it('rejects an invalid sslmode', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
      sslmode: 'totally',
    });
    expect(r.success).toBe(false);
  });

  it('accepts hostnames, IPv4, and bracketed IPv6 hosts', () => {
    for (const host of [
      'db.internal',
      'pg-1.example.com',
      '10.0.0.5',
      '[::1]',
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects hosts carrying URL metacharacters (DSN-smuggle guard)', () => {
    for (const host of [
      'good.com/?sslmode=disable&x=1', // path + query smuggle
      'a.com,169.254.169.254', // multi-host
      'evil@host', // userinfo split
      'host name', // whitespace
      'h%2f', // percent escape
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(false);
    }
  });
});

describe('deploymentSecretsSchema', () => {
  it('accepts allowlisted secret keys', () => {
    const r = deploymentSecretsSchema.safeParse({
      'dataStores.knowledgePostgres.password': 'pw',
      'dataStores.convexStorage.accessKeyId': 'AKIA...',
      'dataStores.convexStorage.secretAccessKey': 'secret',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown secret key', () => {
    const r = deploymentSecretsSchema.safeParse({
      'dataStores.unknown.password': 'pw',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty secret value', () => {
    const r = deploymentSecretsSchema.safeParse({
      'dataStores.knowledgePostgres.password': '',
    });
    expect(r.success).toBe(false);
  });

  it('every secret key is namespaced under a config section', () => {
    for (const key of DEPLOYMENT_SECRET_KEYS) {
      expect(key.split('.').length).toBeGreaterThanOrEqual(3);
      expect(key.startsWith('dataStores.')).toBe(true);
    }
  });
});
