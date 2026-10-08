import { describe, expect, it } from 'vitest';

import {
  isKnowledgeVectorWidth,
  KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS,
  KNOWLEDGE_EMBEDDING_KEPT_KEYS,
  KNOWLEDGE_VECTOR_WIDTHS,
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
      'maxRequestsPerMinute',
      'maxTokensPerMinute',
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

describe('the vector widths a knowledge database stores', () => {
  const base = {
    providerSlug: 'local-embedding',
    model: 'Example-embedding',
  };

  it('takes a write of every listed width', () => {
    for (const dimensions of KNOWLEDGE_VECTOR_WIDTHS) {
      expect(isKnowledgeVectorWidth(dimensions)).toBe(true);
      expect(
        knowledgeEmbeddingWriteSchema.safeParse({ ...base, dimensions })
          .success,
        String(dimensions),
      ).toBe(true);
    }
  });

  // A width with no table would save and then fail every document at index
  // time, so the write is where it is refused — with the list in the message.
  it.each([1, 1000, 1535, 2560, 16_000])(
    'refuses a write of %s, which has no table, and names the list',
    (dimensions) => {
      expect(isKnowledgeVectorWidth(dimensions)).toBe(false);
      const result = knowledgeEmbeddingWriteSchema.safeParse({
        ...base,
        dimensions,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['dimensions']);
      expect(result.error?.issues[0]?.message).toContain(
        KNOWLEDGE_VECTOR_WIDTHS.join(', '),
      );
    },
  );

  // A file stored before the widths were a list must still open in Settings,
  // or the admin could not see what to correct.
  it('still reads a stored file of another width', () => {
    expect(
      knowledgeEmbeddingSchema.safeParse({ ...base, dimensions: 1000 }).success,
    ).toBe(true);
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
