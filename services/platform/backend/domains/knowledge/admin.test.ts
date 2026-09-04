// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KnowledgeAdminError,
  probeKnowledgeConnection,
  writeKnowledgeConnection,
  writeKnowledgeEmbedding,
} from './admin.ts';

/**
 * The outbound-host policy, spoken in this domain's vocabulary. The shared
 * check refuses with a coded `AppError`; the knowledge routes map only
 * `KnowledgeAdminError`, so left untranslated a refusal reached the admin as
 * a bare 500. Every refusal here happens BEFORE any file or network I/O, so
 * no config directory and no database are involved.
 */

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
      writeKnowledgeConnection('acme', { connection: metadataHost }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('BLOCKED_HOST');
    expect(error.message).toContain('169.254.169.254');
  });

  it('names the env opt-in when a private host is refused', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
    const error = await refusal(() =>
      writeKnowledgeConnection('acme', {
        connection: { ...metadataHost, host: '10.0.0.5' },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('PRIVATE_HOST_BLOCKED');
    expect(error.message).toContain('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1');
  });

  it('refuses a blocked embedding base URL the same way', async () => {
    const error = await refusal(() =>
      writeKnowledgeEmbedding('acme', {
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
