import type { EmbeddingModelV2 } from '@ai-sdk/provider';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getEmbeddingDimension,
  getEmbeddingTableName,
  getRecommendedEmbeddingModel,
  SUPPORTED_DIMENSIONS,
  withDimensions,
} from './embedding_config';

describe('embedding_config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('SUPPORTED_DIMENSIONS', () => {
    it('contains expected dimension values', () => {
      expect(SUPPORTED_DIMENSIONS).toEqual([
        256, 512, 1024, 1536, 2048, 2560, 4096,
      ]);
    });
  });

  describe('getEmbeddingDimension', () => {
    it('defaults to 1536 when env var not set', () => {
      vi.stubEnv('EMBEDDING_DIMENSIONS', '');
      expect(getEmbeddingDimension()).toBe(1536);
    });

    it('returns configured dimension', () => {
      vi.stubEnv('EMBEDDING_DIMENSIONS', '256');
      expect(getEmbeddingDimension()).toBe(256);
    });

    it('throws on unsupported dimension', () => {
      vi.stubEnv('EMBEDDING_DIMENSIONS', '999');
      expect(() => getEmbeddingDimension()).toThrow(
        'Invalid EMBEDDING_DIMENSIONS',
      );
    });

    it('throws on non-numeric value', () => {
      vi.stubEnv('EMBEDDING_DIMENSIONS', 'abc');
      expect(() => getEmbeddingDimension()).toThrow(
        'Invalid EMBEDDING_DIMENSIONS',
      );
    });
  });

  describe('getEmbeddingTableName', () => {
    it('returns correct table for each dimension', () => {
      const cases: Array<[string, string]> = [
        ['256', 'websitePageEmbeddings256'],
        ['512', 'websitePageEmbeddings512'],
        ['1024', 'websitePageEmbeddings1024'],
        ['1536', 'websitePageEmbeddings1536'],
        ['2048', 'websitePageEmbeddings2048'],
        ['2560', 'websitePageEmbeddings2560'],
        ['4096', 'websitePageEmbeddings4096'],
      ];

      for (const [dim, table] of cases) {
        vi.stubEnv('EMBEDDING_DIMENSIONS', dim);
        expect(getEmbeddingTableName()).toBe(table);
      }
    });
  });

  describe('getRecommendedEmbeddingModel', () => {
    it('returns env model when set', () => {
      vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'custom-model');
      expect(getRecommendedEmbeddingModel()).toBe('custom-model');
    });

    it('throws when env not set', () => {
      vi.stubEnv('OPENAI_EMBEDDING_MODEL', '');
      expect(() => getRecommendedEmbeddingModel()).toThrow(
        'OPENAI_EMBEDDING_MODEL',
      );
    });
  });

  describe('withDimensions', () => {
    function createMockModel(): EmbeddingModelV2<string> & {
      doEmbedCalls: Parameters<EmbeddingModelV2<string>['doEmbed']>[0][];
    } {
      const doEmbedCalls: Parameters<EmbeddingModelV2<string>['doEmbed']>[0][] =
        [];
      return {
        specificationVersion: 'v2',
        modelId: 'test-model',
        provider: 'test-provider',
        maxEmbeddingsPerCall: 100,
        supportsParallelCalls: true,
        doEmbedCalls,
        async doEmbed(
          options: Parameters<EmbeddingModelV2<string>['doEmbed']>[0],
        ) {
          doEmbedCalls.push(options);
          return {
            embeddings: options.values.map(() => [0.1, 0.2, 0.3]),
          };
        },
      };
    }

    it('injects dimensions into providerOptions.openai', async () => {
      const mock = createMockModel();
      const wrapped = withDimensions(mock, 1024);

      await wrapped.doEmbed({ values: ['hello'] });

      expect(mock.doEmbedCalls).toHaveLength(1);
      expect(mock.doEmbedCalls[0].providerOptions).toEqual({
        openai: { dimensions: 1024 },
      });
    });

    it('preserves existing providerOptions from caller', async () => {
      const mock = createMockModel();
      const wrapped = withDimensions(mock, 512);

      await wrapped.doEmbed({
        values: ['hello'],
        providerOptions: {
          openai: { user: 'test-user' },
          other: { key: 'value' },
        },
      });

      expect(mock.doEmbedCalls[0].providerOptions).toEqual({
        openai: { user: 'test-user', dimensions: 512 },
        other: { key: 'value' },
      });
    });

    it('preserves model properties', () => {
      const mock = createMockModel();
      const wrapped = withDimensions(mock, 256);

      expect(wrapped.specificationVersion).toBe('v2');
      expect(wrapped.modelId).toBe('test-model');
      expect(wrapped.provider).toBe('test-provider');
      expect(wrapped.maxEmbeddingsPerCall).toBe(100);
      expect(wrapped.supportsParallelCalls).toBe(true);
    });

    it('returns embeddings from the underlying model', async () => {
      const mock = createMockModel();
      const wrapped = withDimensions(mock, 1024);

      const result = await wrapped.doEmbed({ values: ['a', 'b'] });

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.1, 0.2, 0.3],
      ]);
    });
  });
});
