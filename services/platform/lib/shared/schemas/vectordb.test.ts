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

  it('rejects pgvector_external without a pgvectorExternal object', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'pgvector_external',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a pgvector_external config and defaults port/sslmode/table', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'pgvector_external',
      pgvectorExternal: {
        host: 'db.example.com',
        database: 'tale',
        user: 'tale_rw',
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.backend === 'pgvector_external') {
      expect(result.data.pgvectorExternal.port).toBe(5432);
      expect(result.data.pgvectorExternal.sslmode).toBe('require');
      expect(result.data.pgvectorExternal.table).toBe('tale_vectors');
    }
  });

  it('rejects a pgvector_external table with illegal characters', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'pgvector_external',
      pgvectorExternal: {
        host: 'db.example.com',
        database: 'tale',
        user: 'tale_rw',
        table: 'drop table;',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a pgvector_external port out of range', () => {
    const result = vectorDbConfigSchema.safeParse({
      backend: 'pgvector_external',
      pgvectorExternal: {
        host: 'db.example.com',
        database: 'tale',
        user: 'tale_rw',
        port: 70_000,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('vectorDbSecretsSchema', () => {
  it('accepts a non-empty apiKey or password', () => {
    expect(vectorDbSecretsSchema.safeParse({ apiKey: 'k' }).success).toBe(true);
    expect(vectorDbSecretsSchema.safeParse({ password: 'p' }).success).toBe(
      true,
    );
  });

  it('rejects empty secret values', () => {
    expect(vectorDbSecretsSchema.safeParse({ apiKey: '' }).success).toBe(false);
    expect(vectorDbSecretsSchema.safeParse({ password: '' }).success).toBe(
      false,
    );
  });

  it('allows an empty object (the merge layer enforces at-least-one)', () => {
    expect(vectorDbSecretsSchema.safeParse({}).success).toBe(true);
  });
});
