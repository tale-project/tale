// @vitest-environment node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `internalAction(config)` returns the config so `.handler` is directly
// invokable (same codegen-surface mock as actions.test.ts).
vi.mock('../_generated/server', () => ({
  internalAction: vi.fn((config) => config),
}));

// The pool and the datastore probe both import `postgres`; the file layer
// under test only needs their seams.
vi.mock('./pool', () => ({
  invalidateOrgUrl: vi.fn(),
}));
vi.mock('../deployment/test_datastore_connection', () => ({
  testDatastoreConnection: vi.fn(),
}));

import { testDatastoreConnection } from '../deployment/test_datastore_connection';
import {
  deleteConnection,
  deleteEmbedding,
  probeConnection,
  readConnection,
  readEmbedding,
  writeConnection,
  writeEmbedding,
} from './file_actions';
import { invalidateOrgUrl } from './pool';

interface ActionLike {
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
}
function run(a: unknown, args: unknown): Promise<unknown> {
  return (a as ActionLike).handler({}, args);
}

const CONNECTION = {
  orgSlug: 'acme',
  host: 'db.acme.example',
  port: 6432,
  database: 'acme_rag',
  user: 'acme',
  sslmode: 'require' as const,
};

const EMBEDDING = {
  orgSlug: 'acme',
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

let configRoot: string;
let previousConfigDir: string | undefined;
let previousSopsKey: string | undefined;
let previousSopsKeyFile: string | undefined;

function orgFile(name: string): string {
  return path.join(configRoot, 'acme', 'knowledge', name);
}

function historyEntries(key: string): string[] {
  const dir = path.join(configRoot, 'acme', 'knowledge', '.history', key);
  return existsSync(dir) ? readdirSync(dir) : [];
}

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-file-actions-'));
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
  // Force the plaintext arm of the SOPS hybrid so sidecar contents are
  // assertable regardless of the developer machine's keychain.
  previousSopsKey = process.env.SOPS_AGE_KEY;
  previousSopsKeyFile = process.env.SOPS_AGE_KEY_FILE;
  delete process.env.SOPS_AGE_KEY;
  delete process.env.SOPS_AGE_KEY_FILE;
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
  if (previousSopsKey !== undefined) process.env.SOPS_AGE_KEY = previousSopsKey;
  if (previousSopsKeyFile !== undefined)
    process.env.SOPS_AGE_KEY_FILE = previousSopsKeyFile;
});

describe('writeConnection / readConnection', () => {
  it('round-trips a connection and reports the stored password only as a flag', async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });

    const onDisk = JSON.parse(readFileSync(orgFile('connection.json'), 'utf8'));
    expect(onDisk).toEqual({
      host: 'db.acme.example',
      port: 6432,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'require',
    });
    const sidecar = JSON.parse(
      readFileSync(orgFile('connection.secrets.json'), 'utf8'),
    );
    expect(sidecar).toEqual({ password: 'hunter2' });

    const view = await run(readConnection, { orgSlug: 'acme' });
    expect(view).toEqual({
      configured: true,
      host: 'db.acme.example',
      port: 6432,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'require',
      hasPassword: true,
    });
    expect(invalidateOrgUrl).toHaveBeenCalledWith('acme');
  });

  it('reports an unconfigured org as unconfigured', async () => {
    expect(await run(readConnection, { orgSlug: 'acme' })).toEqual({
      configured: false,
    });
  });

  it('keeps the stored password when none is supplied (edit-the-host flow)', async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    await run(writeConnection, { ...CONNECTION, host: 'db2.acme.example' });
    const sidecar = JSON.parse(
      readFileSync(orgFile('connection.secrets.json'), 'utf8'),
    );
    expect(sidecar).toEqual({ password: 'hunter2' });
  });

  it('keeps the stored password on an explicit null', async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    await run(writeConnection, { ...CONNECTION, password: null });
    expect(existsSync(orgFile('connection.secrets.json'))).toBe(true);
  });

  it("removes the sidecar on '' (switch to passwordless auth)", async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    await run(writeConnection, { ...CONNECTION, password: '' });
    expect(existsSync(orgFile('connection.secrets.json'))).toBe(false);
    const view = (await run(readConnection, { orgSlug: 'acme' })) as {
      hasPassword?: boolean;
    };
    expect(view.hasPassword).toBe(false);
  });

  it('SSRF-gates the host before anything touches disk', async () => {
    await expect(
      run(writeConnection, { ...CONNECTION, host: '169.254.169.254' }),
    ).rejects.toThrow(/blocked/);
    expect(existsSync(orgFile('connection.json'))).toBe(false);
    expect(invalidateOrgUrl).not.toHaveBeenCalled();
  });

  it('snapshots the PREVIOUS config into .history/ and caps the entries', async () => {
    await run(writeConnection, CONNECTION);
    expect(historyEntries('connection')).toHaveLength(0);

    await run(writeConnection, { ...CONNECTION, port: 7000 });
    const [firstSnapshot] = historyEntries('connection');
    expect(firstSnapshot).toBeDefined();
    const snapshotContent = JSON.parse(
      readFileSync(
        path.join(
          configRoot,
          'acme',
          'knowledge',
          '.history',
          'connection',
          firstSnapshot ?? '',
        ),
        'utf8',
      ),
    ) as { port: number };
    // The snapshot preserves what was OVERWRITTEN, not the incoming config.
    expect(snapshotContent.port).toBe(6432);

    for (let i = 1; i < 22; i++) {
      await run(writeConnection, { ...CONNECTION, port: 7000 + i });
    }
    const entries = historyEntries('connection');
    expect(entries.length).toBe(20);
  });
});

describe('deleteConnection', () => {
  it('removes config, sidecar, and history, and invalidates the URL cache', async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    await run(writeConnection, { ...CONNECTION, port: 7001 });
    expect(historyEntries('connection').length).toBeGreaterThan(0);
    vi.mocked(invalidateOrgUrl).mockClear();

    await run(deleteConnection, { orgSlug: 'acme' });
    expect(existsSync(orgFile('connection.json'))).toBe(false);
    expect(existsSync(orgFile('connection.secrets.json'))).toBe(false);
    expect(historyEntries('connection')).toHaveLength(0);
    expect(invalidateOrgUrl).toHaveBeenCalledWith('acme');
  });
});

describe('probeConnection', () => {
  it('reuses the stored secret when the password field is blank (Save, then Test)', async () => {
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    vi.mocked(testDatastoreConnection).mockResolvedValue({
      ok: true,
      latency_ms: 12,
      version: 'PostgreSQL 16',
      vector_available: true,
      paradedb_available: true,
    } as never);

    const result = await run(probeConnection, {
      ...CONNECTION,
      orgSlug: 'acme',
      password: '',
    });
    expect(testDatastoreConnection).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'hunter2' }),
    );
    expect(result).toEqual({
      ok: true,
      latencyMs: 12,
      version: 'PostgreSQL 16',
      vectorAvailable: true,
      paradedbAvailable: true,
      error: undefined,
      hint: undefined,
    });
  });

  it('hints when pgvector is missing', async () => {
    vi.mocked(testDatastoreConnection).mockResolvedValue({
      ok: true,
      vector_available: false,
      paradedb_available: true,
    } as never);
    const result = (await run(probeConnection, CONNECTION)) as {
      hint?: string;
    };
    expect(result.hint).toMatch(/pgvector/);
  });

  it('reports an unreachable probe as a failure result, never a throw', async () => {
    vi.mocked(testDatastoreConnection).mockRejectedValue(
      new Error('ECONNREFUSED'),
    );
    const result = (await run(probeConnection, CONNECTION)) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('SSRF-gates the probe host', async () => {
    await expect(
      run(probeConnection, { ...CONNECTION, host: '169.254.169.254' }),
    ).rejects.toThrow(/blocked/);
    expect(testDatastoreConnection).not.toHaveBeenCalled();
  });

  it('reports an unreadable stored sidecar as a probe failure, never a throw', async () => {
    // The exact misconfiguration the probe exists to diagnose (e.g. the SOPS
    // key is absent on this node) must reach the admin form as a result —
    // a throw would be redacted to "Server Error" in production.
    await run(writeConnection, { ...CONNECTION, password: 'hunter2' });
    writeFileSync(orgFile('connection.secrets.json'), 'not json at all');

    const result = (await run(probeConnection, {
      ...CONNECTION,
      orgSlug: 'acme',
      password: '',
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stored password/);
    expect(testDatastoreConnection).not.toHaveBeenCalled();
  });
});

describe('writeEmbedding / readEmbedding / deleteEmbedding', () => {
  it('round-trips the embedding config without ever creating a sidecar', async () => {
    await run(writeEmbedding, {
      ...EMBEDDING,
      credentialId: 'cred_1',
      baseUrl: 'https://gateway.example.com/v1',
    });
    const onDisk = JSON.parse(readFileSync(orgFile('embedding.json'), 'utf8'));
    expect(onDisk).toEqual({
      providerSlug: 'openai',
      credentialId: 'cred_1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      baseUrl: 'https://gateway.example.com/v1',
    });
    expect(existsSync(orgFile('embedding.secrets.json'))).toBe(false);

    const view = await run(readEmbedding, { orgSlug: 'acme' });
    expect(view).toEqual({
      configured: true,
      providerSlug: 'openai',
      credentialId: 'cred_1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      baseUrl: 'https://gateway.example.com/v1',
    });
  });

  it('reports an unconfigured org as unconfigured', async () => {
    expect(await run(readEmbedding, { orgSlug: 'acme' })).toEqual({
      configured: false,
    });
  });

  it('SSRF-gates a custom base URL', async () => {
    await expect(
      run(writeEmbedding, {
        ...EMBEDDING,
        baseUrl: 'http://169.254.169.254/v1',
      }),
    ).rejects.toThrow(/blocked/);
    expect(existsSync(orgFile('embedding.json'))).toBe(false);
  });

  it('refuses an out-of-bounds vector width even on the internal path', async () => {
    await expect(
      run(writeEmbedding, { ...EMBEDDING, dimensions: 0 }),
    ).rejects.toThrow();
    expect(existsSync(orgFile('embedding.json'))).toBe(false);
  });

  it('snapshots the previous config on overwrite', async () => {
    await run(writeEmbedding, EMBEDDING);
    await run(writeEmbedding, { ...EMBEDDING, dimensions: 3072 });
    expect(historyEntries('embedding')).toHaveLength(1);
  });

  it('removes config and history on delete', async () => {
    await run(writeEmbedding, EMBEDDING);
    await run(writeEmbedding, { ...EMBEDDING, dimensions: 3072 });
    await run(deleteEmbedding, { orgSlug: 'acme' });
    expect(existsSync(orgFile('embedding.json'))).toBe(false);
    expect(historyEntries('embedding')).toHaveLength(0);
  });
});
