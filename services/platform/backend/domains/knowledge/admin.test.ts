// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KnowledgeAdminError,
  probeKnowledgeConnection,
  writeKnowledgeConnection,
  resolveKeptEmbeddingSettings,
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

/**
 * The settings `embedding.json` holds that the Settings form does not carry
 * — the assistant's similarity floor and the model's serving limits. An
 * operator states them in the file or through the CLI; a form save must not
 * reset them.
 */
describe('the settings an embedding write keeps', () => {
  const model = {
    providerSlug: 'local-embedding',
    model: 'Example-embedding',
    dimensions: 1024,
  };
  const stored = {
    ...model,
    minSimilarity: 0.6,
    maxConcurrentRequests: 2,
    minTokensPerSecond: 750,
  };

  it('keeps every stored setting when the body omits it — the form does not carry them', () => {
    expect(resolveKeptEmbeddingSettings(model, stored)).toEqual(stored);
  });

  it('takes an explicit value over the stored one', () => {
    expect(
      resolveKeptEmbeddingSettings(
        { ...model, minSimilarity: 0.3, maxConcurrentRequests: 4 },
        stored,
      ),
    ).toEqual({
      ...stored,
      minSimilarity: 0.3,
      maxConcurrentRequests: 4,
    });
  });

  it('clears a setting on an explicit null and keeps the others', () => {
    expect(
      resolveKeptEmbeddingSettings(
        { ...model, minTokensPerSecond: null, minSimilarity: null },
        stored,
      ),
    ).toEqual({ ...model, maxConcurrentRequests: 2 });
  });

  it('stays absent when nothing is stored', () => {
    expect(resolveKeptEmbeddingSettings(model, null)).toEqual(model);
    expect(
      resolveKeptEmbeddingSettings(
        { ...model, minTokensPerSecond: null },
        null,
      ),
    ).toEqual(model);
  });

  it.each([
    { maxConcurrentRequests: 0 },
    { maxConcurrentRequests: 2.5 },
    { minTokensPerSecond: 0 },
    { minTokensPerSecond: '750' },
    { dimensions: null },
  ])('refuses %j before any file is touched', async (fields) => {
    const error = await refusal(() =>
      writeKnowledgeEmbedding(unreachableSql(), 'acme', {
        ...model,
        ...fields,
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_EMBEDDING');
  });
});
