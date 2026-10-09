import { expect, test } from 'bun:test';

import {
  observedDatabaseFacts,
  OBSERVATION_APP_SQL,
  OBSERVATION_KNOWLEDGE_SQL,
} from './observation-sql';

const corpus = (schema: string) =>
  JSON.stringify({
    schema,
    chunks: 3,
    legacyVectors: 2,
    legacyVectorBytes: 64,
    chunkRelationBytes: 8192,
    vectorRelations: [{ table: 'chunk_vectors_1536', bytes: 8192 }],
  });
const app =
  JSON.stringify({ schema: 'tale', ids: ['0001_initial.sql'] }) +
  '\n' +
  JSON.stringify({ safeTable: true, unfinished: true, owned: false });
const knowledge = [
  '["1"]',
  '["2"]',
  corpus('private_knowledge'),
  corpus('public_web'),
].join('\n');
test('fixed queries are bounded read-only transactions without a cutover lock', () => {
  for (const sql of [OBSERVATION_APP_SQL, OBSERVATION_KNOWLEDGE_SQL]) {
    expect(sql.startsWith('BEGIN READ ONLY;')).toBe(true);
    expect(sql.endsWith('ROLLBACK;')).toBe(true);
    expect(sql).toContain("statement_timeout = '5s'");
    expect(sql).not.toMatch(
      /LOCK TABLE|INSERT\s|DELETE\s|UPDATE\s|ALTER\s|CREATE\s/,
    );
  }
  expect(observedDatabaseFacts(app, knowledge).legacyAutomationCensus).toEqual({
    unfinished: true,
    observerOwnsCutoverLock: false,
  });
});
test.each([
  'lock',
  'unsafe-table',
  'ledger',
  'corpus-count',
  'schema-order',
  'extra-line',
])('refuses incomplete or ambiguous database inventory: %s', (fault) => {
  const first =
    fault === 'lock'
      ? app.replace('"owned":false', '"owned":true')
      : fault === 'unsafe-table'
        ? app.replace('"safeTable":true', '"safeTable":false')
        : fault === 'ledger'
          ? app.replace('0001_initial.sql', 'unknown')
          : app;
  const second =
    fault === 'corpus-count'
      ? knowledge.replace('"chunks":3', '"chunks":-1')
      : fault === 'schema-order'
        ? knowledge.replace('private_knowledge', 'public_web')
        : fault === 'extra-line'
          ? knowledge + '\n{}'
          : knowledge;
  expect(() => observedDatabaseFacts(first, second)).toThrow(
    'incomplete or invalid',
  );
});
