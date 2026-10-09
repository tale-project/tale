import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { ACCEPTANCE_SQL } from './acceptance-migrations';
import { AUTOMATION_CUTOVER_CENSUS_SQL } from './automation-cutover-sql';
import { AUTOMATION_LEDGER_QUERY } from './automation-floor';
import {
  applicationLedgerSchema,
  privateLedgerSchema,
  publicLedgerSchema,
} from './migration-model';

/** These observations never acquire the cutover lock. The census is only a
 * point-in-time fact; its `owned:false` cannot authorize a migration. */
export const OBSERVATION_APP_SQL = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '8s';
${AUTOMATION_LEDGER_QUERY.slice(0, -1)}
\\gexec
${AUTOMATION_CUTOVER_CENSUS_SQL}
ROLLBACK;`;

// Only source-owned schema literals enter this statement. Counts are exact;
// stored byte sizes describe the retained corpus, not a predicted copy budget.
const corpus = (
  schema: 'private_knowledge' | 'public_web',
) => `SELECT json_build_object(
  'schema', '${schema}', 'chunks', count(*),
  'legacyVectors', count(embedding),
  'legacyVectorBytes', coalesce(sum(pg_column_size(embedding)), 0),
  'chunkRelationBytes', pg_total_relation_size('${schema}.chunks'),
  'vectorRelations', (SELECT coalesce(json_agg(json_build_object('table', c.relname, 'bytes', pg_total_relation_size(c.oid)) ORDER BY c.relname), '[]'::json)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'r' AND c.relname ~ '^chunk_vectors_[0-9]+$'))
FROM ${schema}.chunks;`;
export const OBSERVATION_KNOWLEDGE_SQL = ACCEPTANCE_SQL['knowledge-db'].replace(
  'ROLLBACK;',
  `${corpus('private_knowledge')}\n${corpus('public_web')}\nROLLBACK;`,
);
const count = z.number().int().nonnegative().safe();
const corpusSchema = z.strictObject({
  schema: z.enum(['private_knowledge', 'public_web']),
  chunks: count,
  legacyVectors: count,
  legacyVectorBytes: count,
  chunkRelationBytes: count,
  vectorRelations: z
    .array(
      z.strictObject({
        table: z.string().regex(/^chunk_vectors_[0-9]+$/),
        bytes: count,
      }),
    )
    .max(64),
});
export function observedDatabaseFacts(app: string, knowledge: string) {
  try {
    const appLines = app.trim().split('\n');
    const knowledgeLines = knowledge.trim().split('\n');
    if (appLines.length !== 2 || knowledgeLines.length !== 4)
      throw Error('lines');
    const ledger = z
      .strictObject({
        schema: z.enum(['public', 'tale']),
        ids: applicationLedgerSchema.shape.ids,
      })
      .parse(JSON.parse(appLines[0]));
    const census = z
      .strictObject({
        safeTable: z.literal(true),
        unfinished: z.boolean(),
        owned: z.literal(false),
      })
      .parse(JSON.parse(appLines[1]));
    const privateIds = privateLedgerSchema.shape.ids.parse(
      JSON.parse(knowledgeLines[0]),
    );
    const publicIds = publicLedgerSchema.shape.ids.parse(
      JSON.parse(knowledgeLines[1]),
    );
    const corpora = knowledgeLines
      .slice(2)
      .map((line) => corpusSchema.parse(JSON.parse(line)));
    if (
      corpora[0].schema !== 'private_knowledge' ||
      corpora[1].schema !== 'public_web'
    )
      throw Error('schema');
    return {
      migrations: [
        { service: 'db', table: 'app_migrations', ...ledger },
        {
          service: 'knowledge-db',
          schema: 'private_knowledge',
          table: 'schema_migrations',
          ids: privateIds,
        },
        {
          service: 'knowledge-db',
          schema: 'public_web',
          table: 'schema_migrations',
          ids: publicIds,
        },
      ],
      legacyAutomationCensus: {
        unfinished: census.unfinished,
        observerOwnsCutoverLock: false,
      },
      corpora,
    };
  } catch {
    throw preconditionError(
      'Database observation returned an incomplete or invalid inventory.',
    );
  }
}
