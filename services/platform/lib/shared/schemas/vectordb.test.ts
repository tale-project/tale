import { describe, expect, it } from 'vitest';

import { vectorDbConfigSchema, vectorDbSecretsSchema } from './vectordb';

describe('vectorDbConfigSchema', () => {
  it('accepts a bare pgvector config', () => {
    const result = vectorDbConfigSchema.safeParse({ backend: 'pgvector' });
    expect(result.success).toBe(true);
  });

  it('rejects qdrant without a qdrant object', () => {
    const result = vectorDbConfigSchema.safeParse({ backend: 'qdrant' });
    expect(result.success).toBe(false);
  });

  it('accepts a qdrant config and defaults the collection', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'qdrant',
      qdrant: { url: 'http://qdrant:6333' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.backend === 'qdrant') {
      expect(result.data.qdrant.collection).toBe('tale_chunks');
    }
  });

  it('rejects an invalid qdrant url', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'qdrant',
      qdrant: { url: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown backend', () => {
    const result = vectorDbConfigSchema.safeParse({ backend: 'pinecone' });
    expect(result.success).toBe(false);
  });

  it('rejects a collection name with illegal characters', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'qdrant',
      qdrant: { url: 'http://qdrant:6333', collection: 'bad name!' },
    });
    expect(result.success).toBe(false);
  });
});

describe('vectorDbSecretsSchema', () => {
  it('requires a non-empty apiKey', () => {
    expect(vectorDbSecretsSchema.safeParse({ apiKey: 'k' }).success).toBe(true);
    expect(vectorDbSecretsSchema.safeParse({ apiKey: '' }).success).toBe(false);
    expect(vectorDbSecretsSchema.safeParse({}).success).toBe(false);
  });
});
