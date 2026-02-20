import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getEmbeddingDimension,
  getEmbeddingTableName,
  getRecommendedEmbeddingModel,
  SUPPORTED_DIMENSIONS,
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
});
