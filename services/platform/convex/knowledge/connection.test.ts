// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnowledgeConnection } from '../../lib/shared/schemas/knowledge';
import {
  buildConnectionUrl,
  readOrgConnection,
  readOrgEmbeddingConfig,
} from './connection';

/**
 * Two rules are tested here, and both are about REFUSING.
 *
 * An organization that configured its own database did so because its documents
 * must not sit in the shared one. A malformed configuration therefore has to
 * fail, never fall back — the fallback would write that organization's
 * documents into the shared corpus and nobody would notice until an audit.
 *
 * And an embedding configuration without an explicit vector width has to fail
 * too. A guessed width is right for the models we happen to know and silently
 * wrong for anything else, and the damage — a corpus of vectors nobody can
 * search — is invisible until retrieval quality collapses.
 */

let configRoot: string;
let previousConfigDir: string | undefined;

function writeOrgFile(orgSlug: string, name: string, content: string): void {
  const dir = path.join(configRoot, orgSlug, 'knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), content);
}

const VALID_CONNECTION = {
  host: 'acme-db.example.com',
  port: 5432,
  database: 'acme_knowledge',
  user: 'acme',
  sslmode: 'require',
} satisfies KnowledgeConnection;

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-config-'));
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
});

describe('the database connection', () => {
  it('reads a configured connection', async () => {
    writeOrgFile('acme', 'connection.json', JSON.stringify(VALID_CONNECTION));
    const resolved = await readOrgConnection('acme');
    expect(resolved?.connection.host).toBe('acme-db.example.com');
    expect(resolved?.password).toBe('');
  });

  it('reads the password from the secrets sidecar', async () => {
    writeOrgFile('acme', 'connection.json', JSON.stringify(VALID_CONNECTION));
    writeOrgFile(
      'acme',
      'connection.secrets.json',
      JSON.stringify({ password: 'hunter2-correct-horse' }),
    );
    const resolved = await readOrgConnection('acme');
    expect(resolved?.password).toBe('hunter2-correct-horse');
  });

  it('treats an absent configuration as "use the deployment default"', async () => {
    // The one case that is a configuration and not an error.
    expect(await readOrgConnection('startup')).toBeNull();
  });

  it('treats an absent sidecar as passwordless, which is a valid setup', async () => {
    writeOrgFile('acme', 'connection.json', JSON.stringify(VALID_CONNECTION));
    expect((await readOrgConnection('acme'))?.password).toBe('');
  });

  const refusals: Array<[string, string, RegExp]> = [
    ['is not JSON', '{ nope', /not valid JSON/],
    [
      'is missing the database',
      JSON.stringify({ host: 'h', user: 'u' }),
      /invalid knowledge connection config/i,
    ],
    [
      'carries an unknown field',
      JSON.stringify({ ...VALID_CONNECTION, table: 'chunks' }),
      /invalid knowledge connection config/i,
    ],
    [
      'names an sslmode that does not exist',
      JSON.stringify({ ...VALID_CONNECTION, sslmode: 'maybe' }),
      /invalid knowledge connection config/i,
    ],
  ];

  it.each(refusals)(
    'refuses, rather than falls back, when the connection %s',
    async (_name, content, message) => {
      writeOrgFile('acme', 'connection.json', content);
      await expect(readOrgConnection('acme')).rejects.toThrow(message);
    },
  );

  it('refuses an unreadable password sidecar', async () => {
    // The organization DID configure a secret. Continuing without it would
    // either fail confusingly or, if a fallback existed, use the wrong database.
    writeOrgFile('acme', 'connection.json', JSON.stringify(VALID_CONNECTION));
    writeOrgFile('acme', 'connection.secrets.json', 'not json at all');
    await expect(readOrgConnection('acme')).rejects.toThrow();
  });
});

describe('the connection URL', () => {
  it('percent-encodes the credentials and the database name', () => {
    const url = buildConnectionUrl({
      connection: {
        ...VALID_CONNECTION,
        user: 'acme user',
        database: 'acme/knowledge',
      },
      password: 'p@ss:word/with?meta',
    });
    expect(url).toContain('acme%20user');
    expect(url).toContain('p%40ss%3Aword%2Fwith%3Fmeta');
    expect(url).toContain('acme%2Fknowledge');
  });

  it('carries the requested TLS mode', () => {
    const url = buildConnectionUrl({
      connection: { ...VALID_CONNECTION, sslmode: 'verify-full' },
      password: '',
    });
    expect(url.endsWith('?sslmode=verify-full')).toBe(true);
  });
});

describe('the embedding model', () => {
  const VALID_EMBEDDING = {
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  };

  it('reads a complete configuration', async () => {
    writeOrgFile('acme', 'embedding.json', JSON.stringify(VALID_EMBEDDING));
    const config = await readOrgEmbeddingConfig('acme');
    expect(config).toEqual(VALID_EMBEDDING);
  });

  it('reports an unconfigured organization as unconfigured', async () => {
    // Retrieval then refuses with an actionable message rather than guessing.
    expect(await readOrgEmbeddingConfig('startup')).toBeNull();
  });

  it('requires the vector width, and never infers it from the model name', async () => {
    // text-embedding-3-small is a model whose width we could have guessed. It
    // is refused anyway: the guess would be right here and silently wrong for
    // the next model, and nothing about the failure would be visible.
    writeOrgFile(
      'acme',
      'embedding.json',
      JSON.stringify({
        providerSlug: 'openai',
        model: 'text-embedding-3-small',
      }),
    );
    await expect(readOrgEmbeddingConfig('acme')).rejects.toThrow(/dimensions/);
  });

  const badWidths: Array<[string, unknown]> = [
    ['zero', 0],
    ['negative', -1536],
    ['fractional', 1536.5],
    ['a string', '1536'],
    ['absurdly large', 999_999],
  ];

  it.each(badWidths)('refuses a %s vector width', async (_name, dimensions) => {
    writeOrgFile(
      'acme',
      'embedding.json',
      JSON.stringify({ ...VALID_EMBEDDING, dimensions }),
    );
    await expect(readOrgEmbeddingConfig('acme')).rejects.toThrow();
  });

  it('accepts an explicit credential and base URL', async () => {
    writeOrgFile(
      'acme',
      'embedding.json',
      JSON.stringify({
        ...VALID_EMBEDDING,
        credentialId: 'cred_123',
        baseUrl: 'https://gateway.example.com/v1',
      }),
    );
    const config = await readOrgEmbeddingConfig('acme');
    expect(config?.credentialId).toBe('cred_123');
    expect(config?.baseUrl).toBe('https://gateway.example.com/v1');
  });

  it('refuses a file that is not JSON', async () => {
    writeOrgFile('acme', 'embedding.json', 'dimensions: 1536');
    await expect(readOrgEmbeddingConfig('acme')).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
