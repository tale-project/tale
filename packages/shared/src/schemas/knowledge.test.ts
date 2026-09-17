import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS,
  KNOWLEDGE_EMBEDDING_KEPT_KEYS,
  knowledgeConnectionSchema,
  knowledgeEmbeddingSchema,
  knowledgeEmbeddingWriteSchema,
  pgConnectionSchema,
} from './knowledge';

describe('knowledgeEmbeddingWriteSchema — what a write may clear', () => {
  const base = {
    providerSlug: 'local-embedding',
    model: 'Example-embedding',
    dimensions: 1024,
  };

  it('names the settings a write keeps when it omits them', () => {
    expect([...KNOWLEDGE_EMBEDDING_KEPT_KEYS].sort()).toEqual([
      'maxConcurrentRequests',
      'minSimilarity',
      'minTokensPerSecond',
    ]);
  });

  it('accepts null — clear — for exactly those settings', () => {
    for (const key of KNOWLEDGE_EMBEDDING_KEPT_KEYS) {
      const parsed = knowledgeEmbeddingWriteSchema.safeParse({
        ...base,
        [key]: null,
      });
      expect(parsed.success, key).toBe(true);
      expect(
        knowledgeEmbeddingSchema.safeParse({ ...base, [key]: null }).success,
        key,
      ).toBe(false);
    }
    for (const key of ['credentialId', 'baseUrl', 'dimensions']) {
      expect(
        knowledgeEmbeddingWriteSchema.safeParse({ ...base, [key]: null })
          .success,
        key,
      ).toBe(false);
    }
  });

  it('holds a written value to the file’s own bounds', () => {
    for (const fields of [
      { maxConcurrentRequests: 65 },
      { minTokensPerSecond: -1 },
      { minSimilarity: 1.5 },
    ]) {
      expect(
        knowledgeEmbeddingWriteSchema.safeParse({ ...base, ...fields }).success,
      ).toBe(false);
    }
  });
});

describe('knowledgeEmbeddingSchema — the model’s serving capacity', () => {
  const base = {
    providerSlug: 'local-embedding',
    model: 'Example-embedding',
    dimensions: 1024,
  };
  const parse = (fields: Record<string, unknown>) =>
    knowledgeEmbeddingSchema.safeParse({ ...base, ...fields });

  it('leaves both fields absent when the file states neither', () => {
    const result = knowledgeEmbeddingSchema.parse(base);
    expect(result.maxConcurrentRequests).toBeUndefined();
    expect(result.minTokensPerSecond).toBeUndefined();
    // Absent keeps the bound embedding had before it was configurable.
    expect(KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS).toBe(3);
  });

  it('accepts a whole in-flight bound from 1 to 64', () => {
    for (const bound of [1, 2, 64]) {
      expect(parse({ maxConcurrentRequests: bound }).success).toBe(true);
    }
  });

  it.each([0, -1, 1.5, 65, '2', null, Number.POSITIVE_INFINITY])(
    'refuses %s as an in-flight bound',
    (bound) => {
      expect(parse({ maxConcurrentRequests: bound }).success).toBe(false);
    },
  );

  it('accepts a positive throughput floor, fractional included', () => {
    for (const floor of [1, 750, 1349.5, 0.5]) {
      expect(parse({ minTokensPerSecond: floor }).success).toBe(true);
    }
  });

  it.each([0, -5, '750', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as a throughput floor',
    (floor) => {
      expect(parse({ minTokensPerSecond: floor }).success).toBe(false);
    },
  );
});

describe('pgConnectionSchema', () => {
  it('is the shape the per-org knowledge connection file validates against', () => {
    expect(knowledgeConnectionSchema).toBe(pgConnectionSchema);
  });

  it('applies port/sslmode defaults', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.port).toBe(5432);
      expect(r.data.sslmode).toBe('require');
    }
  });

  it('rejects an invalid sslmode', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
      sslmode: 'totally',
    });
    expect(r.success).toBe(false);
  });

  it('accepts hostnames, IPv4, and bracketed IPv6 hosts', () => {
    for (const host of [
      'db.internal',
      'pg-1.example.com',
      '10.0.0.5',
      '[::1]',
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects hosts carrying URL metacharacters (DSN-smuggle guard)', () => {
    for (const host of [
      'good.com/?sslmode=disable&x=1', // path + query smuggle
      'a.com,169.254.169.254', // multi-host
      'evil@host', // userinfo split
      'host name', // whitespace
      'h%2f', // percent escape
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(false);
    }
  });
});
