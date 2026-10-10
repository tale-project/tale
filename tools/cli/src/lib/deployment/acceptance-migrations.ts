import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { stableJson, valueHash } from '../config/releases/identity';
import {
  migrationInventorySchema,
  type MigrationInventory,
} from './migration-model';

// These are fixed source-owned read-only statements; no declaration, user input,
// credential or application row is interpolated into SQL.
const TRANSACTION = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '8s';`;
// dbmate historically stores padded decimal IDs. Other numeric syntax must
// never be normalized into an otherwise valid source identity.
const KNOWLEDGE_ID = `CASE WHEN version ~ '^[0-9]{1,14}$' THEN version::numeric::text ELSE NULL END`;
export const ACCEPTANCE_SQL = {
  db: `${TRANSACTION}
SELECT coalesce(json_agg(name ORDER BY name COLLATE "C"), '[]'::json) FROM (SELECT name FROM public.app_migrations ORDER BY name COLLATE "C" LIMIT 2049) AS inventory;
ROLLBACK;`,
  'knowledge-db': `${TRANSACTION}
SELECT coalesce(json_agg(id ORDER BY id COLLATE "C"), '[]'::json) FROM (SELECT ${KNOWLEDGE_ID} AS id FROM private_knowledge.schema_migrations ORDER BY version COLLATE "C" LIMIT 2049) AS inventory;
SELECT coalesce(json_agg(id ORDER BY id COLLATE "C"), '[]'::json) FROM (SELECT ${KNOWLEDGE_ID} AS id FROM public_web.schema_migrations ORDER BY version COLLATE "C" LIMIT 2049) AS inventory;
ROLLBACK;`,
} as const;

/** Credentials stay inside their existing DB container. Ignore ambient psql
 * options/startup files and use the local socket; emit ledger identities only. */
export function acceptanceMigrationScript(
  service: 'db' | 'knowledge-db',
): string {
  return migrationReadScript(service, ACCEPTANCE_SQL[service]);
}

/** Internal source-owned read-only SQL only; never pass deployment/user input. */
export function migrationReadScript(
  service: 'db' | 'knowledge-db',
  sql: string,
): string {
  return `${migrationSessionCommand(service)} <<'TALE_ACCEPTANCE_SQL'
${sql}
TALE_ACCEPTANCE_SQL
`;
}

/** A held cutover transaction uses the same local credential boundary. */
export function migrationSessionCommand(
  service: 'db' | 'knowledge-db',
): string {
  const database = service === 'db' ? 'tale_app' : 'tale_knowledge';
  return `set -eu
user="\${DB_USER:-\${POSTGRES_USER:-}}"
case "$user" in ''|*[!a-zA-Z0-9_]*) exit 1;; esac
unset PGHOST PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS PGPASSFILE
export PGCONNECT_TIMEOUT=5
exec psql -X -q -A -t -v ON_ERROR_STOP=1 -h /var/run/postgresql -U "$user" -d ${database}`;
}
export function acceptedMigrations(
  expected: MigrationInventory,
  app: string,
  knowledge: string,
) {
  try {
    const appLines = app.trim().split('\n');
    const knowledgeLines = knowledge.trim().split('\n');
    if (appLines.length !== 1 || knowledgeLines.length !== 2)
      throw new Error('ledger lines');
    const lines = [...appLines, ...knowledgeLines];
    const actual = migrationInventorySchema.parse(
      expected.map((ledger, index) => ({
        service: ledger.service,
        schema: ledger.schema,
        table: ledger.table,
        ids: z.array(z.string()).parse(JSON.parse(lines[index])),
      })),
    );
    if (stableJson(actual) !== stableJson(expected))
      throw new Error('ledger difference');
    // Bind the exact source-derived inventory with compact sorted JSON.
    return actual.map((ledger) => ({
      service: ledger.service,
      schema: ledger.schema,
      table: ledger.table,
      ids: ledger.ids,
      inventorySha256: valueHash(ledger),
    }));
  } catch {
    throw preconditionError(
      'Current migration ledgers differ from the complete source inventory.',
    );
  }
}
