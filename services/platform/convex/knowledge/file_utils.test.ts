import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildKnowledgeUrl,
  readOrgKnowledgeConnection,
  resolveKnowledgeConnectionFilePath,
  resolveKnowledgeConnectionSecretsFilePath,
  resolveKnowledgeDir,
  type KnowledgeConnectionFile,
} from './file_utils';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'knowledge-cfg-'));
  vi.stubEnv('TALE_CONFIG_DIR', tmpRoot);
  // No SOPS key → the plaintext secrets sidecar is read as-is.
  vi.stubEnv('SOPS_AGE_KEY', '');
  vi.stubEnv('SOPS_AGE_KEY_FILE', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

const CONN: KnowledgeConnectionFile = {
  host: 'db.acme.example',
  port: 6432,
  database: 'acme_rag',
  user: 'acme',
  sslmode: 'require',
};

async function writeConnection(
  orgSlug: string,
  conn: unknown,
  secrets?: unknown,
): Promise<void> {
  const dir = path.join(tmpRoot, orgSlug, 'knowledge');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'connection.json'), JSON.stringify(conn));
  if (secrets !== undefined) {
    await writeFile(
      path.join(dir, 'connection.secrets.json'),
      JSON.stringify(secrets),
    );
  }
}

describe('resolveKnowledge* paths', () => {
  it('resolves the domain dir + files under <org>/knowledge/', () => {
    expect(resolveKnowledgeDir('acme')).toBe(
      path.join(tmpRoot, 'acme', 'knowledge'),
    );
    expect(resolveKnowledgeConnectionFilePath('acme')).toBe(
      path.join(tmpRoot, 'acme', 'knowledge', 'connection.json'),
    );
    expect(resolveKnowledgeConnectionSecretsFilePath('acme')).toBe(
      path.join(tmpRoot, 'acme', 'knowledge', 'connection.secrets.json'),
    );
  });

  it('rejects an invalid org slug', () => {
    expect(() => resolveKnowledgeDir('../evil')).toThrow(/Invalid org slug/);
  });
});

describe('readOrgKnowledgeConnection', () => {
  it('returns null when the org has no connection.json (→ default pool)', async () => {
    expect(await readOrgKnowledgeConnection('acme')).toBeNull();
  });

  it('returns the connection + empty password when no secrets sidecar', async () => {
    await writeConnection('acme', CONN);
    const resolved = await readOrgKnowledgeConnection('acme');
    expect(resolved).not.toBeNull();
    expect(resolved?.connection).toEqual(CONN);
    expect(resolved?.password).toBe('');
  });

  it('reads the password from the plaintext secrets sidecar', async () => {
    await writeConnection('acme', CONN, { password: 's3cr3t' });
    const resolved = await readOrgKnowledgeConnection('acme');
    expect(resolved?.password).toBe('s3cr3t');
  });

  it('applies schema defaults (port, sslmode)', async () => {
    await writeConnection('acme', {
      host: 'db.acme.example',
      database: 'acme_rag',
      user: 'acme',
    });
    const resolved = await readOrgKnowledgeConnection('acme');
    expect(resolved?.connection.port).toBe(5432);
    expect(resolved?.connection.sslmode).toBe('require');
  });

  it('FAILS CLOSED: throws on an invalid connection.json (never falls back)', async () => {
    // Host with a URL metacharacter is rejected by pgConnectionSchema.
    await writeConnection('acme', { ...CONN, host: 'evil host/../x' });
    await expect(readOrgKnowledgeConnection('acme')).rejects.toThrow(
      /Invalid knowledge connection/,
    );
  });
});

describe('buildKnowledgeUrl', () => {
  it('assembles a postgresql:// URL with sslmode + encoded credentials', () => {
    const url = buildKnowledgeUrl({ connection: CONN, password: 'p@ss/w:rd' });
    expect(url).toBe(
      'postgresql://acme:p%40ss%2Fw%3Ard@db.acme.example:6432/acme_rag?sslmode=require',
    );
  });

  it('encodes an empty password (passwordless auth)', () => {
    const url = buildKnowledgeUrl({ connection: CONN, password: '' });
    expect(url).toBe(
      'postgresql://acme:@db.acme.example:6432/acme_rag?sslmode=require',
    );
  });

  it('carries the chosen sslmode through the query param', () => {
    const url = buildKnowledgeUrl({
      connection: { ...CONN, sslmode: 'disable' },
      password: 'x',
    });
    expect(url).toContain('?sslmode=disable');
  });
});
