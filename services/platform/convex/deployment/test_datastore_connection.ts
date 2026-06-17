'use node';

/**
 * In-process datastore connectivity probe.
 *
 * Port of the external RAG service's
 * `POST /api/v1/admin/datastore/test-connection`
 * (`services/rag/app/routes/admin.ts`). Opens a short-lived postgres.js
 * connection to an operator-supplied candidate datastore and reports
 * reachability + whether the `vector` (pgvector) and `pg_search` (ParadeDB)
 * extensions are available/installed — used by the deployment UI to validate a
 * datastore before switching to it.
 *
 * Connection fields are passed as discrete postgres.js options (NOT a DSN
 * string) so a host carrying URL metacharacters can't smuggle libpq params.
 */

import postgres from 'postgres';

export type SslMode =
  | 'disable'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full';

export interface DatastoreTestRequest {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  sslmode: SslMode;
}

export interface DatastoreTestResult {
  ok: boolean;
  latency_ms: number | null;
  version: string | null;
  vector_available: boolean | null;
  paradedb_available: boolean | null;
  vector_installed: boolean | null;
  paradedb_installed: boolean | null;
  error: string | null;
}

function sslOption(sslmode: SslMode): postgres.Options<{}>['ssl'] {
  switch (sslmode) {
    case 'disable':
      return false;
    case 'prefer':
      return 'prefer';
    case 'require':
      return 'require';
    case 'verify-ca':
    case 'verify-full':
      return 'verify-full';
    default:
      return 'require';
  }
}

export async function testDatastoreConnection(
  req: DatastoreTestRequest,
): Promise<DatastoreTestResult> {
  const t0 = performance.now();
  const sql = postgres({
    host: req.host,
    port: req.port,
    user: req.user,
    password: req.password ?? '',
    database: req.database,
    ssl: sslOption(req.sslmode),
    max: 1,
    idle_timeout: 1,
    connect_timeout: 8,
  });

  try {
    const versionRows = await sql.unsafe<{ version: string }[]>(
      'SELECT version() AS version',
    );
    const vector = await sql.unsafe<{ exists: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS exists",
    );
    const paradedb = await sql.unsafe<{ exists: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_search') AS exists",
    );
    const vectorInst = await sql.unsafe<{ exists: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists",
    );
    const paradedbInst = await sql.unsafe<{ exists: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_search') AS exists",
    );

    return {
      ok: true,
      latency_ms: Math.round((performance.now() - t0) * 10) / 10,
      version: versionRows[0]?.version ?? null,
      vector_available: vector[0]?.exists ?? false,
      paradedb_available: paradedb[0]?.exists ?? false,
      vector_installed: vectorInst[0]?.exists ?? false,
      paradedb_installed: paradedbInst[0]?.exists ?? false,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.info(
      `[testDatastoreConnection] failed for ${req.host}:${req.port}: ${message}`,
    );
    return {
      ok: false,
      latency_ms: null,
      version: null,
      vector_available: null,
      paradedb_available: null,
      vector_installed: null,
      paradedb_installed: null,
      error: message,
    };
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch (closeErr) {
      console.warn(
        `[testDatastoreConnection] close failed for ${req.host}: ${
          closeErr instanceof Error ? closeErr.message : String(closeErr)
        }`,
      );
    }
  }
}
