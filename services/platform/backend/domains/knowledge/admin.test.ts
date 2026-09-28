// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KnowledgeAdminError,
  listEmbeddingRecommendationsForOrg,
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

/** Run with an empty org config tree: the org defines no providers. */
async function withEmptyConfigDir<T>(
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tale-embedding-support-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

/**
 * The recommendations read also carries every provider's declared embedding
 * support, so the form can tell "cannot embed" (refused) from "no curated
 * width here" (typed by hand). The shipped connector tree is the fixture;
 * the org has no providers of its own, and only static catalogs are read.
 */
describe('embedding recommendations with declared support', () => {
  function key(providerSlug: string) {
    return { status: 'active', authMethod: 'api-key', providerSlug };
  }

  it('reports Anthropic as unable to embed and never recommends it', async () => {
    const view = await withEmptyConfigDir(() =>
      listEmbeddingRecommendationsForOrg('acme', [
        key('anthropic'),
        key('deepseek'),
        key('openai'),
      ]),
    );
    const support = new Map(
      view.providers.map((entry) => [entry.providerSlug, entry.support]),
    );

    expect(support.get('anthropic')).toBe('unsupported');
    // No curated width ships for DeepSeek, and its docs say nothing either
    // way: enter the model and dimensions by hand, never refused.
    expect(support.get('deepseek')).toBe('unknown');
    expect(support.get('openai')).toBe('supported');
    expect(view.recommendations).toEqual([
      {
        providerSlug: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        recommended: true,
      },
    ]);
  });

  it('reports every provider the org can choose, even without a direct key', async () => {
    const view = await withEmptyConfigDir(() =>
      listEmbeddingRecommendationsForOrg('acme', [
        {
          status: 'active',
          authMethod: 'subscription-broker',
          providerSlug: 'anthropic',
        },
      ]),
    );

    expect(view.recommendations).toEqual([]);
    expect(view.providers).toContainEqual({
      providerSlug: 'anthropic',
      support: 'unsupported',
    });
    // Declared `supported`, but with no direct key there is no width to
    // offer here — the manual path, not a refusal.
    expect(view.providers).toContainEqual({
      providerSlug: 'openai',
      support: 'unknown',
    });
  });
});

/**
 * The declaration is the authority over a curated width: a pick whose
 * provider does not declare `supported` is never offered as a one-click
 * fill, while the provider is still reported with what it does declare. The
 * shipped tree holds no such pick (a guard keeps every curated width beside
 * a `supported` declaration), so the fixture is a system tree of its own.
 */
describe('a curated width without the declaration behind it', () => {
  const MODELS = (provider: string) =>
    [
      `- id: ${provider}-embed`,
      `  provider: ${provider}`,
      '  tags:',
      '    - embedding',
      '  supportsTools: false',
      '  supportsVision: false',
      '  contextWindow: 8191',
      '  embedding:',
      '    dimensions: 1024',
      '    recommended: true',
      '',
    ].join('\n');
  const PROVIDER = (provider: string, embedding: string) =>
    [
      `name: ${provider}`,
      `displayName: ${provider}`,
      'apiFormat: openai',
      'baseUrl: https://api.example.test/v1',
      'catalog:',
      '  source: static',
      `embedding: ${embedding}`,
      'auth:',
      '  - method: api-key',
      '',
    ].join('\n');

  async function withSystemTree<T>(
    declarations: Record<string, string>,
    run: () => Promise<T>,
  ): Promise<T> {
    const root = await mkdtemp(path.join(tmpdir(), 'tale-embedding-system-'));
    try {
      for (const [provider, embedding] of Object.entries(declarations)) {
        await mkdir(path.join(root, 'providers', provider), {
          recursive: true,
        });
        await writeFile(
          path.join(root, 'providers', provider, 'provider.yml'),
          PROVIDER(provider, embedding),
        );
        await mkdir(path.join(root, 'models', provider), { recursive: true });
        await writeFile(
          path.join(root, 'models', provider, 'models.yml'),
          MODELS(provider),
        );
      }
      vi.stubEnv('TALE_CONFIG_SYSTEM_DIR', root);
      return await withEmptyConfigDir(run);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('offers only the pick of a provider declared supported', async () => {
    const view = await withSystemTree(
      {
        'declares-supported': 'supported',
        'declares-unknown': 'unknown',
        'declares-unsupported': 'unsupported',
      },
      () =>
        listEmbeddingRecommendationsForOrg(
          'acme',
          [
            'declares-supported',
            'declares-unknown',
            'declares-unsupported',
          ].map((providerSlug) => ({
            status: 'active',
            authMethod: 'api-key',
            providerSlug,
          })),
        ),
    );

    // Every provider carries a curated width, and all three are unlocked by
    // a direct key — only the declaration tells them apart.
    expect(view.recommendations).toEqual([
      {
        providerSlug: 'declares-supported',
        model: 'declares-supported-embed',
        dimensions: 1024,
        recommended: true,
      },
    ]);
    expect(view.providers).toEqual([
      { providerSlug: 'declares-supported', support: 'supported' },
      { providerSlug: 'declares-unknown', support: 'unknown' },
      { providerSlug: 'declares-unsupported', support: 'unsupported' },
    ]);
  });
});

/**
 * The write door holds the same line as the form: a provider declared unable
 * to embed is refused before any file is touched, whether the declaration is
 * shipped or the organization's own. The form's refusal alone let a direct
 * call — or a save racing the declarations read — store a config that then
 * failed every document at index time.
 */
describe('the embedding write door and the embedding declaration', () => {
  const model = { model: 'example-embed', dimensions: 1024 };

  it('refuses a shipped provider declared unable to embed', async () => {
    const error = await withEmptyConfigDir(() =>
      refusal(() =>
        writeKnowledgeEmbedding(unreachableSql(), 'acme', {
          providerSlug: 'anthropic',
          ...model,
        }),
      ),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('EMBEDDING_PROVIDER_UNSUPPORTED');
    expect(error.message).toContain('anthropic');
  });

  it("refuses an organization's own provider declared unable to embed", async () => {
    const error = await withEmptyConfigDir(async (dir) => {
      await mkdir(path.join(dir, 'acme', 'providers'), { recursive: true });
      await writeFile(
        path.join(dir, 'acme', 'providers', 'chat-gateway.yml'),
        [
          'name: chat-gateway',
          'displayName: Chat gateway',
          'apiFormat: openai',
          'baseUrl: https://gateway.example.test/v1',
          'catalog:',
          '  source: models-endpoint',
          'embedding: unsupported',
          'auth:',
          '  - method: api-key',
          '',
        ].join('\n'),
      );
      return refusal(() =>
        writeKnowledgeEmbedding(unreachableSql(), 'acme', {
          providerSlug: 'chat-gateway',
          ...model,
        }),
      );
    });
    expect(error.code).toBe('EMBEDDING_PROVIDER_UNSUPPORTED');
  });

  it.each(['deepseek', 'openai', 'not-a-provider'])(
    'lets %s through to the write — only a declared refusal refuses',
    async (providerSlug) => {
      // The test double opens no transaction: reaching it proves the door
      // passed the declaration check.
      await expect(
        withEmptyConfigDir(() =>
          writeKnowledgeEmbedding(unreachableSql(), 'acme', {
            providerSlug,
            ...model,
          }),
        ),
      ).rejects.toThrow('a refused connection must not open a transaction');
    },
  );
});
