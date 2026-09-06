// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertVectorWidth,
  EmbeddingDimensionMismatch,
  forgetPinnedDimensions,
  pinDimensions,
} from './dimensions';

/**
 * A corpus stores vectors of ONE width. Mixing widths is not a crash — it is a
 * corpus where part of the content is unreachable from part of the queries,
 * with no symptom until someone notices retrieval has stopped finding things
 * and no repair short of re-embedding everything. So the refusal is the
 * feature, and these tests are mostly about it firing.
 *
 * The database is a recording double: what matters is which statements the pin
 * issues and when it refuses, not that PostgreSQL can run them.
 */

const SCHEMA = 'private_knowledge';

interface FakeDb {
  sql: Sql;
  statements: string[];
}

/**
 * A database double.
 *
 * `columnType` is what `format_type` reports for the embedding column —
 * `'vector'` is the unpinned state a fresh corpus starts in.
 */
function fakeDb(
  options: { columnType?: string | null; cacheColumnType?: string | null } = {},
): FakeDb {
  const statements: string[] = [];
  const unsafe = (text: string, params?: string[]): Promise<unknown[]> => {
    statements.push(text.trim());
    if (text.includes('format_type')) {
      const target = (params ?? [])[0] ?? '';
      const type = target.endsWith('.chunks')
        ? (options.columnType ?? 'vector')
        : (options.cacheColumnType ?? null);
      return Promise.resolve(type === null ? [] : [{ format_type: type }]);
    }
    return Promise.resolve([]);
  };
  const sql = { unsafe } as unknown as Sql;
  return { sql, statements };
}

afterEach(() => {
  forgetPinnedDimensions();
});

describe('pinning a fresh corpus', () => {
  it('narrows the column to the configured width and builds the index', async () => {
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://fresh',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(1536)',
    );
    expect(db.statements.join('\n')).toContain('create_chunks_hnsw_index');
    // Pinned: the same width asks nothing more of the database.
    const before = db.statements.length;
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://fresh',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.length).toBe(before);
  });

  it('does nothing when the column already has the right width', async () => {
    const db = fakeDb({ columnType: 'vector(1536)' });
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://already',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).not.toContain('ALTER COLUMN');
  });

  it('leaves nothing pinned when the corpus does not exist yet', async () => {
    // No table, no ALTER — and therefore no pin on record: recording one
    // here would make every later write skip the ALTER for the process
    // lifetime, leaving the column untyped once the table appears.
    const missing = {
      unsafe: () =>
        Promise.reject(Object.assign(new Error('no table'), { code: '42P01' })),
    } as unknown as Sql;
    await pinDimensions({
      sql: missing,
      dbUrl: 'postgresql://empty',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    // Nothing on record: another width is not refused from memory, and the
    // column is narrowed to it once the table is there.
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://empty',
      schema: SCHEMA,
      dimensions: 768,
      context: 'organization "globex"',
    });
    expect(db.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(768)',
    );
  });

  it('pins once the corpus table appears after a missed first attempt', async () => {
    // A knowledge database that migrates after the platform boots: the
    // first write finds no table, the next one (same database) must still
    // narrow the column and build the index rather than trust a stale memo.
    const missing = {
      unsafe: () =>
        Promise.reject(Object.assign(new Error('no table'), { code: '42P01' })),
    } as unknown as Sql;
    await pinDimensions({
      sql: missing,
      dbUrl: 'postgresql://late',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://late',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(1536)',
    );
    expect(db.statements.join('\n')).toContain('create_chunks_hnsw_index');
    // And the width now holds: another one is refused.
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://late',
        schema: SCHEMA,
        dimensions: 768,
        context: 'organization "globex"',
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionMismatch);
  });

  it('accepts a corpus too wide to index, rather than refusing documents', async () => {
    // A sequential scan is slow. A corpus that will not accept documents is
    // unusable, so the missing index is a warning and not an error.
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://wide',
      schema: SCHEMA,
      dimensions: 4096,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(4096)',
    );
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://wide',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "globex"',
      }),
    ).rejects.toMatchObject({ expected: 4096, received: 1536 });
  });

  it('discards cached query embeddings of a different width', async () => {
    // A cached query vector of another width cannot be compared to new queries;
    // keeping it would return similarity scores that mean nothing.
    const db = fakeDb({ cacheColumnType: 'vector(768)' });
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://recache',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).toContain('TRUNCATE TABLE');
  });
});

describe('a width that disagrees is refused', () => {
  it('refuses a corpus already declared at another width, and never re-types it', async () => {
    // Pinned by another organization on the shared database before this
    // process started: the memo is empty, so the column itself is the
    // contract. Re-typing it locked every tenant's chunks table and, on an
    // empty table, silently re-pinned the whole corpus.
    const db = fakeDb({ columnType: 'vector(1536)' });
    const attempt = pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://restarted',
      schema: SCHEMA,
      dimensions: 768,
      context: 'organization "globex"',
    });
    await expect(attempt).rejects.toBeInstanceOf(EmbeddingDimensionMismatch);
    await expect(attempt).rejects.toMatchObject({
      expected: 1536,
      received: 768,
    });
    expect(db.statements.join('\n')).not.toContain('ALTER');
    expect(db.statements.join('\n')).not.toContain('TRUNCATE');
    expect(db.statements.join('\n')).not.toContain('create_chunks_hnsw_index');

    // The persisted width is now the memo: the next mismatch is refused
    // without touching the database, and the matching width proceeds.
    const before = db.statements.length;
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://restarted',
        schema: SCHEMA,
        dimensions: 768,
        context: 'organization "globex"',
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionMismatch);
    expect(db.statements.length).toBe(before);
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://restarted',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    expect(db.statements.join('\n')).not.toContain('ALTER COLUMN');
    expect(db.statements.join('\n')).toContain('create_chunks_hnsw_index');
  });

  it('refuses a column of a type it cannot read as a width', async () => {
    const db = fakeDb({ columnType: 'halfvec(1536)' });
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://odd',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "acme"',
      }),
    ).rejects.toThrow(/halfvec\(1536\)/);
    expect(db.statements.join('\n')).not.toContain('ALTER');
    // Nothing on record: the next caller reads the column again rather than
    // being answered from memory.
    const before = db.statements.length;
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://odd',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "acme"',
      }),
    ).rejects.toThrow(/halfvec\(1536\)/);
    expect(db.statements.length).toBeGreaterThan(before);
  });

  it('refuses a second organization asking for a different width', async () => {
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://shared',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });

    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://shared',
        schema: SCHEMA,
        dimensions: 768,
        context: 'organization "globex"',
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionMismatch);
  });

  it('explains what to do about it', async () => {
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://shared',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://shared',
        schema: SCHEMA,
        dimensions: 768,
        context: 'organization "globex"',
      }),
    ).rejects.toThrow(/own knowledge database/);
  });

  it('lets organizations on different databases pin independently', async () => {
    const acme = fakeDb();
    const globex = fakeDb();
    await pinDimensions({
      sql: acme.sql,
      dbUrl: 'postgresql://acme',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    await pinDimensions({
      sql: globex.sql,
      dbUrl: 'postgresql://globex',
      schema: SCHEMA,
      dimensions: 768,
      context: 'organization "globex"',
    });
    expect(acme.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(1536)',
    );
    expect(globex.statements.join('\n')).toContain(
      'ALTER COLUMN embedding TYPE vector(768)',
    );
  });

  it('pins each schema of a database, not just the first one touched', async () => {
    // The width memo is per database, but the ALTER is per schema — pinning
    // private_knowledge first must not leave public_web.chunks unpinned (and
    // its HNSW index unbuilt) when the web corpus takes its first write.
    const db = fakeDb();
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://two-schemas',
      schema: SCHEMA,
      dimensions: 1536,
      context: 'organization "acme"',
    });
    await pinDimensions({
      sql: db.sql,
      dbUrl: 'postgresql://two-schemas',
      schema: 'public_web',
      dimensions: 1536,
      context: 'organization "acme"',
    });
    const alters = db.statements.filter((s) => s.includes('ALTER COLUMN'));
    expect(alters.some((s) => s.includes('private_knowledge.chunks'))).toBe(
      true,
    );
    expect(alters.some((s) => s.includes('public_web.chunks'))).toBe(true);
    await expect(
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://two-schemas',
        schema: 'public_web',
        dimensions: 768,
        context: 'organization "globex"',
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionMismatch);
  });

  it('pins once when two callers race', async () => {
    const db = fakeDb();
    const [first, second] = await Promise.allSettled([
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://race',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "acme"',
      }),
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://race',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "globex"',
      }),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');
    const alters = db.statements.filter((s) => s.includes('ALTER COLUMN'));
    expect(alters.length).toBe(1);
  });

  it('refuses the loser of a race that wanted a different width', async () => {
    const db = fakeDb();
    const [, second] = await Promise.allSettled([
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://race2',
        schema: SCHEMA,
        dimensions: 1536,
        context: 'organization "acme"',
      }),
      pinDimensions({
        sql: db.sql,
        dbUrl: 'postgresql://race2',
        schema: SCHEMA,
        dimensions: 3072,
        context: 'organization "globex"',
      }),
    ]);
    expect(second.status).toBe('rejected');
  });
});

describe('vectors are checked before they are written', () => {
  it('accepts a vector of the pinned width', () => {
    expect(() =>
      assertVectorWidth(new Array<number>(4).fill(0), 4, 'the model "m"'),
    ).not.toThrow();
  });

  const wrong: Array<[string, number[]]> = [
    ['a shorter vector', [0, 0]],
    ['a longer vector', [0, 0, 0, 0, 0, 0]],
    ['an empty vector', []],
  ];

  it.each(wrong)('refuses %s', (_name, vector) => {
    // The database's own type check would catch it too, but only after half the
    // batch is written and with an error that names no model.
    expect(() => assertVectorWidth(vector, 4, 'the model "m"')).toThrow(
      EmbeddingDimensionMismatch,
    );
  });

  it('names both widths and the model that produced the wrong one', () => {
    try {
      assertVectorWidth([0, 0], 1536, 'the embedding model "mystery-embed"');
      expect.unreachable('the mismatch should have been refused');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbeddingDimensionMismatch);
      expect(String(err)).toContain('mystery-embed');
      expect(String(err)).toContain('1536');
      expect(String(err)).toContain('2-dimensional');
    }
  });
});
