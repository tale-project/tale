/**
 * The seed's database connection and the few reads it makes outside the
 * bulk identity writes.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';

/** A pool sized for `parallelism` batches plus the occasional probe. */
export function openDatabase(url: string, parallelism: number): Sql {
  return postgres(url, {
    max: parallelism + 2,
    idle_timeout: 30,
    connect_timeout: 30,
    // Multi-row INSERTs of a fixed batch size prepare once per connection.
    prepare: true,
    onnotice: () => undefined,
  });
}

/** How many rows of `table` have an id starting with `prefix`. */
export async function countByIdPrefix(
  sql: Sql,
  table: 'user' | 'account' | 'session' | 'member',
  prefix: string,
): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM ${sql(table)}
    WHERE starts_with("id", ${prefix})
  `;
  return rows[0]?.count ?? 0;
}

/** An organization by slug, for a create call that found its slug taken. */
export async function findOrganizationBySlug(
  sql: Sql,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "organization" WHERE "slug" = ${slug} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * The states of an organization's `org.scaffold` jobs. pg-boss keeps a
 * finished job in `pgboss.job` until its retention purges it, so an empty
 * list means "finished long ago" as well as "never enqueued".
 */
export async function scaffoldJobStates(
  sql: Sql,
  slug: string,
): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT state::text AS state FROM pgboss.job
    WHERE name = 'org.scaffold' AND data ->> 'orgSlug' = ${slug}
  `;
  return rows.map((row) => row.state);
}
