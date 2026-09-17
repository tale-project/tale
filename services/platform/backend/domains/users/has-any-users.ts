import type { Sql } from 'postgres';

/**
 * Whether the deployment holds an account at all.
 *
 * Its own module rather than a function in `./service.ts`, because both
 * callers sit on opposite sides of the request: the public fresh-install probe
 * (`GET /api/app/users/has-any`, which decides whether the login page offers
 * setup) and the sign-up gate in the auth before-hook
 * (`backend/auth/sign-up-gate.ts`). They must answer the same question — a
 * second copy would let the page offer a screen the backend refuses — and the
 * auth module must not drag the whole users service, whose own error codes
 * would then read as reachable from every door that touches auth
 * (`backend/rest/error-codes.test.ts` walks exactly that graph).
 */
export async function hasAnyUsers(sql: Sql): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`SELECT "id" FROM "user" LIMIT 1`;
  return rows.length > 0;
}
