// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWLEDGE_VECTOR_WIDTHS } from '@tale/shared/schemas/knowledge';
import { describe, expect, it } from 'vitest';

import { HNSW_DIMENSION_LIMIT } from '../../backend/core/knowledge/dimensions';

/**
 * A knowledge database keeps its vectors in a table per width
 * (`<schema>.chunk_vectors_<width>`), and the platform names that table from
 * the width an organization's embedding model states. The tables are created
 * by the knowledge migrations and never at runtime, so the list the platform
 * accepts (`KNOWLEDGE_VECTOR_WIDTHS`) and the tables the migrations create
 * are two copies of one fact, in two languages. A width in the list with no
 * table saves in Settings and then fails every document at index time; a
 * table with no width in the list is storage nothing can reach.
 *
 * This guard reads the migrations and holds the two equal, for both corpus
 * schemas. Adding a width is one change: the list, and a new numbered
 * migration that creates the table in each schema.
 */

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations/knowledge-db',
);

const SCHEMAS = ['private_knowledge', 'public_web'] as const;

/** The `-- migrate:up` halves of a schema's migrations, in filename order. */
function upSql(schema: string): string {
  const dir = path.join(MIGRATIONS, schema);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const source = readFileSync(path.join(dir, name), 'utf8');
      const down = source.indexOf('-- migrate:down');
      return down < 0 ? source : source.slice(0, down);
    })
    .join('\n');
}

/** The widths of an `ARRAY[…]` literal. */
function widthsOf(list: string): number[] {
  return list
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((width) => Number.isInteger(width));
}

/**
 * The widths a statement of this kind runs for: written out
 * (`… chunk_vectors_1024 …`), or in a loop over an array
 * (`FOREACH w IN ARRAY ARRAY[…] LOOP EXECUTE format('… chunk_vectors_%s …')`).
 */
function widthsCreatedBy(sql: string, statement: RegExp): number[] {
  const widths = new Set<number>();
  const loops =
    /FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([^\]]+)\]\s+LOOP([\s\S]*?)END\s+LOOP/g;
  for (const [, list, body] of sql.matchAll(loops)) {
    if (list === undefined || body === undefined) continue;
    if (!statement.test(body) || !body.includes('chunk_vectors_%s')) continue;
    for (const width of widthsOf(list)) widths.add(width);
  }
  const literal = new RegExp(
    `${statement.source}[\\s\\S]{0,160}?chunk_vectors_(\\d+)`,
    'g',
  );
  for (const [, width] of sql.matchAll(literal)) widths.add(Number(width));
  return [...widths].sort((a, b) => a - b);
}

describe('the vector tables the migrations create are the widths the platform accepts', () => {
  it.each(SCHEMAS)(
    '%s has a table for every listed width, and no other',
    (schema) => {
      expect(
        widthsCreatedBy(upSql(schema), /CREATE TABLE IF NOT EXISTS/),
      ).toEqual([...KNOWLEDGE_VECTOR_WIDTHS]);
    },
  );

  // pgvector cannot index a `vector` above its limit; every width under it
  // gets the approximate index, or its searches scan in sequence.
  it.each(SCHEMAS)('%s indexes every width pgvector can index', (schema) => {
    expect(
      widthsCreatedBy(upSql(schema), /CREATE INDEX IF NOT EXISTS/),
    ).toEqual(
      KNOWLEDGE_VECTOR_WIDTHS.filter((width) => width <= HNSW_DIMENSION_LIMIT),
    );
  });

  it('lists the widths in ascending order, each once', () => {
    const sorted = [...new Set(KNOWLEDGE_VECTOR_WIDTHS)].sort((a, b) => a - b);
    expect([...KNOWLEDGE_VECTOR_WIDTHS]).toEqual(sorted);
  });
});
