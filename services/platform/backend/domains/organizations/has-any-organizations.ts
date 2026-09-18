import type { Sql } from 'postgres';

/**
 * Whether the deployment holds an organization at all.
 *
 * The organization-creation gate (`backend/auth/organization-creation-gate.ts`)
 * asks this from Better Auth's before-hook and the capability route asks it
 * for the UI, so both must read the same table the organization plugin
 * writes — its own module, like `users/has-any-users.ts`, so the auth module
 * imports one query and not the organizations service with its error codes.
 */
export async function hasAnyOrganizations(sql: Sql): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" LIMIT 1
  `;
  return rows.length > 0;
}
