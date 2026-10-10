// @vitest-environment node

import { KNOWLEDGE_VECTOR_WIDTHS } from '@tale/shared/schemas/knowledge';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from '../../../lib/knowledge/types';
import {
  assertVectorWidth,
  assertVectorWidthSupported,
  chunkVectorsTable,
  EmbeddingDimensionMismatch,
  legacyColumnWidth,
  UnsupportedVectorWidth,
} from './dimensions';

/**
 * Vectors of different widths cannot be compared, so they are never stored
 * together: each width has its own table, and a vector goes to the table of
 * the width its organization's embedding model states. These tests hold the
 * routing and the two refusals that remain — a width no table stores, and a
 * vector that is not as wide as stated.
 */

describe('a vector is stored in the table of its width [KNOW-R11]', () => {
  it.each(KNOWLEDGE_VECTOR_WIDTHS)('routes width %s to its table', (width) => {
    expect(
      chunkVectorsTable(PRIVATE_KNOWLEDGE_SCHEMA, width, 'organization "acme"'),
    ).toBe(`private_knowledge.chunk_vectors_${width}`);
    expect(
      chunkVectorsTable(PUBLIC_WEB_SCHEMA, width, 'organization "acme"'),
    ).toBe(`public_web.chunk_vectors_${width}`);
  });

  // Two organizations on one database with models of different widths used
  // to be refused: the second one's width did not match the column. Each
  // now has a table, and neither is refused.
  it('gives organizations of different widths different tables in one database', () => {
    const acme = chunkVectorsTable(
      PRIVATE_KNOWLEDGE_SCHEMA,
      1536,
      'organization "acme"',
    );
    const globex = chunkVectorsTable(
      PRIVATE_KNOWLEDGE_SCHEMA,
      1024,
      'organization "globex"',
    );
    expect(acme).not.toBe(globex);
  });
});

describe('a width no table stores is refused [KNOW-R11]', () => {
  // The table name is interpolated into SQL: nothing but a listed width may
  // ever reach it.
  it.each([0, -1, 1000, 1535, 2560, 16_000, 1536.5, Number.NaN])(
    'refuses %s before a statement exists',
    (width) => {
      expect(() =>
        chunkVectorsTable(
          PRIVATE_KNOWLEDGE_SCHEMA,
          width,
          'organization "acme"',
        ),
      ).toThrow(UnsupportedVectorWidth);
      expect(() =>
        assertVectorWidthSupported(width, 'organization "acme"'),
      ).toThrow(UnsupportedVectorWidth);
    },
  );

  it('names the organization, the width and the widths that are stored', () => {
    try {
      assertVectorWidthSupported(1000, 'organization "globex"');
      expect.unreachable('the width should have been refused');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedVectorWidth);
      expect(err).toMatchObject({ width: 1000 });
      expect(String(err)).toContain('organization "globex"');
      expect(String(err)).toContain('1000');
      expect(String(err)).toContain(KNOWLEDGE_VECTOR_WIDTHS.join(', '));
    }
  });

  it('accepts every listed width', () => {
    for (const width of KNOWLEDGE_VECTOR_WIDTHS) {
      expect(() =>
        assertVectorWidthSupported(width, 'organization "acme"'),
      ).not.toThrow();
    }
  });
});

describe('vectors are checked before they are written', () => {
  it('accepts a vector of the stated width', () => {
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
    // The table's own type check would catch it too, but only after half the
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
      expect(err).toMatchObject({ expected: 1536, received: 2 });
      expect(String(err)).toContain('mystery-embed');
      expect(String(err)).toContain('1536');
      expect(String(err)).toContain('2-dimensional');
    }
  });
});

/** A catalog that declares the previous release's column as `declared`, or
 * has no such column (null). */
function catalog(declared: string | null): {
  sql: Pick<Sql, 'unsafe'>;
  statements: { text: string; params: readonly unknown[] }[];
} {
  const statements: { text: string; params: readonly unknown[] }[] = [];
  const unsafe = (text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    return Promise.resolve(declared === null ? [] : [{ declared }]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { unsafe } as unknown as Pick<Sql, 'unsafe'>, statements };
}

/**
 * The previous release's column, `chunks.embedding`, stays for one release
 * while a deployment rolls, and the previous image reads it alone, at the
 * one width it declared it at. A vector of that width is written there too;
 * the width is read from the catalog, where that image recorded it.
 */
describe('the previous release’s column is written at the width it is declared at', () => {
  it('reads the declared width of each corpus’s column', async () => {
    const { sql, statements } = catalog('vector(1536)');

    await expect(
      legacyColumnWidth(sql, PRIVATE_KNOWLEDGE_SCHEMA),
    ).resolves.toBe(1536);
    expect(statements[0]?.text).toContain('FROM pg_attribute');
    expect(statements[0]?.params).toEqual([
      `${PRIVATE_KNOWLEDGE_SCHEMA}.chunks`,
    ]);

    await expect(legacyColumnWidth(sql, PUBLIC_WEB_SCHEMA)).resolves.toBe(1536);
    expect(statements[1]?.params).toEqual([`${PUBLIC_WEB_SCHEMA}.chunks`]);
  });

  it('is null while the column is undeclared, and once it is dropped', async () => {
    await expect(
      legacyColumnWidth(catalog('vector').sql, PRIVATE_KNOWLEDGE_SCHEMA),
    ).resolves.toBeNull();
    await expect(
      legacyColumnWidth(catalog(null).sql, PRIVATE_KNOWLEDGE_SCHEMA),
    ).resolves.toBeNull();
  });
});
