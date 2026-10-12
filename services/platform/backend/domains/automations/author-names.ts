import type { Sql, TransactionSql } from 'postgres';

import { runStarterUserId } from '../../../lib/shared/run-starter.ts';

/**
 * The names of the people behind the actors a history records — who saved a
 * version, who put one live. The app resolves them from the member list in
 * the browser; a REST client or a coding agent has no member list, so the
 * door answers them beside the actor.
 *
 * An actor names a door and a person (`api-key:<userId>`, a bare
 * `<userId>`) or something that is not a person (`system:<what>`, a
 * trigger). Only a person who is a member of the organization has a name
 * here: a former member, a system actor, a person with no name and an
 * unknown form all read as `null`. An e-mail address is never answered.
 */
export async function memberNamesOf(
  sql: Sql | TransactionSql,
  organizationId: string,
  actors: readonly string[],
): Promise<Map<string, string | null>> {
  const userOf = new Map<string, string>();
  for (const actor of new Set(actors)) {
    const userId = runStarterUserId(actor);
    if (userId !== null && userId !== '') userOf.set(actor, userId);
  }
  const names = new Map<string, string | null>(
    actors.map((actor) => [actor, null]),
  );
  if (userOf.size === 0) return names;
  const rows = await sql<{ id: string; name: string | null }[]>`
    SELECT u.id, u.name
    FROM "user" u
    JOIN "member" m ON m."userId" = u.id
    WHERE m."organizationId" = ${organizationId}
      AND u.id = ANY(${[...new Set(userOf.values())]})
  `;
  const nameOf = new Map(
    rows.map((row) => [row.id, row.name?.trim() || null] as const),
  );
  for (const [actor, userId] of userOf) {
    names.set(actor, nameOf.get(userId) ?? null);
  }
  return names;
}
