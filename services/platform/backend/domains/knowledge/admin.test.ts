// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KnowledgeAdminError,
  probeKnowledgeConnection,
  writeKnowledgeConnection,
  resolveEmbeddingFloor,
  writeKnowledgeEmbedding,
} from './admin.ts';

/**
 * The outbound-host policy, spoken in this domain's vocabulary. The shared
 * check refuses with a coded `AppError`; the knowledge routes map only
 * `KnowledgeAdminError`, so left untranslated a refusal reached the admin as
 * a bare 500. Every refusal here happens BEFORE any file or network I/O, so
 * no config directory and no database are involved — the handle below fails
 * the test if a refusal ever reaches the config-store write lock.
 */

function unreachableSql(): Sql {
  const begin = () => {
    throw new Error('a refused connection must not open a transaction');
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { begin } as unknown as Sql;
}

const metadataHost = {
  host: '169.254.169.254',
  port: 5432,
  database: 'knowledge',
  user: 'tale',
  sslmode: 'require',
};

async function refusal(
  run: () => Promise<unknown>,
): Promise<KnowledgeAdminError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof KnowledgeAdminError) return error;
    throw error;
  }
  throw new Error('expected a KnowledgeAdminError');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('host policy on the knowledge admin doors', () => {
  it('refuses a cloud-metadata database host as a coded 400, not a 500', async () => {
    const error = await refusal(() =>
      writeKnowledgeConnection(unreachableSql(), 'acme', {
        connection: metadataHost,
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('BLOCKED_HOST');
    expect(error.message).toContain('169.254.169.254');
  });

  it('names the env opt-in when a private host is refused', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
    const error = await refusal(() =>
      writeKnowledgeConnection(unreachableSql(), 'acme', {
        connection: { ...metadataHost, host: '10.0.0.5' },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('PRIVATE_HOST_BLOCKED');
    expect(error.message).toContain('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1');
  });

  it('refuses a blocked embedding base URL the same way', async () => {
    const error = await refusal(() =>
      writeKnowledgeEmbedding(unreachableSql(), 'acme', {
        providerSlug: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        baseUrl: 'http://metadata.google.internal/v1',
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('BLOCKED_HOST');
  });

  it('reports a refused host as a failed probe result, the way it reports every other test failure', async () => {
    const result = await probeKnowledgeConnection({ connection: metadataHost });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('169.254.169.254');
  });
});

describe('the assistant’s similarity floor on an embedding write', () => {
  it('keeps the stored floor when the body omits the key — the form does not carry it', () => {
    expect(resolveEmbeddingFloor(undefined, undefined, 0.6)).toBe(0.6);
  });

  it('takes an explicit floor over the stored one', () => {
    expect(resolveEmbeddingFloor(0.3, 0.3, 0.6)).toBe(0.3);
  });

  it('clears the floor on an explicit null, and stays absent when nothing is stored', () => {
    expect(resolveEmbeddingFloor(null, undefined, 0.6)).toBeUndefined();
    expect(
      resolveEmbeddingFloor(undefined, undefined, undefined),
    ).toBeUndefined();
  });
});
