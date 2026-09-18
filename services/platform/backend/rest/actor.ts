import type { Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { isAdminRole } from '../auth/membership.ts';
import { holdsCapability } from '../domains/governance/competence.ts';
import { type RestEnv, RestRefusal } from './shared.ts';

/**
 * The member a REST request acts FOR — the `actor` a machine caller names
 * when it relays a person's own gesture (an answer to a run's question, a
 * task review decision) from another application, so the record carries
 * the person and not the key.
 *
 * The person is named by verified e-mail, never by an id the caller made
 * up: the door resolves the address against the organization's members
 * with the notification export's rule — exactly one active, verified
 * membership — and refuses everything else by name. A caller that already
 * learned the member's id from an earlier answer pins it as `userId`; an
 * address that has since moved to another account then refuses
 * (`ACTOR_REBOUND`) instead of silently acting as the new holder.
 *
 * Acting for another member is itself a right: an organization owner or
 * admin has it by role, any other key holder only through a live
 * `tale:rest.act-as` capability an admin granted in the competence
 * register. The gate runs before any member row is read, so a caller
 * without the right learns nothing about the members.
 */
export const ACT_AS_CAPABILITY = 'tale:rest.act-as';

export const actorBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
    userId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export type ActorBody = z.infer<typeof actorBodySchema>;

export interface ResolvedActor {
  userId: string;
  email: string;
  role: string;
}

/** Whether the key holder may name an `actor` at all. */
export async function mayActAs(
  sql: Sql | TransactionSql,
  caller: { organizationId: string; userId: string; role: string },
  now: number,
): Promise<boolean> {
  if (isAdminRole(caller.role)) return true;
  if (caller.role.toLowerCase() === 'disabled') return false;
  return holdsCapability(
    sql,
    caller.organizationId,
    caller.userId,
    ACT_AS_CAPABILITY,
    now,
  );
}

/**
 * The one member the address names in this organization. Membership and
 * verification are judged on every call — a lookup by e-mail can never act
 * as a foreign, removed, disabled or unverified account.
 */
export async function resolveActor(
  sql: Sql | TransactionSql,
  organizationId: string,
  actor: ActorBody,
): Promise<ResolvedActor> {
  const rows = await sql<
    { id: string; email: string; emailVerified: boolean; role: string }[]
  >`
    SELECT u.id, u.email, u."emailVerified", lower(m.role) AS role
    FROM "user" u
    JOIN "member" m ON m."userId" = u.id
    WHERE m."organizationId" = ${organizationId}
      AND lower(u.email) = ${actor.email}
    LIMIT 2
  `;
  if (rows.length === 0) {
    throw new RestRefusal(
      'No member of this organization has that e-mail address',
      404,
      'ACTOR_NOT_FOUND',
    );
  }
  if (rows.length > 1) {
    throw new RestRefusal(
      'More than one member of this organization carries that e-mail address',
      409,
      'ACTOR_AMBIGUOUS',
    );
  }
  const row = rows[0];
  if (row === undefined) {
    throw new RestRefusal(
      'No member of this organization has that e-mail address',
      404,
      'ACTOR_NOT_FOUND',
    );
  }
  // The pin is judged first: an address that moved to another account is
  // a rebinding whatever that account's state — the caller must not wait
  // for the wrong person to verify.
  if (actor.userId !== undefined && actor.userId !== row.id) {
    throw new RestRefusal(
      'That e-mail address now belongs to another member than the one pinned as `userId` — confirm the new binding before acting',
      409,
      'ACTOR_REBOUND',
    );
  }
  if (!row.emailVerified) {
    throw new RestRefusal(
      'The member has not verified that e-mail address',
      403,
      'ACTOR_UNVERIFIED',
    );
  }
  if (row.role === 'disabled') {
    throw new RestRefusal(
      'The member’s access to this organization is disabled',
      403,
      'ACTOR_DISABLED',
    );
  }
  return { userId: row.id, email: row.email, role: row.role };
}

/** The refusals a project or task load raises for want of access. */
const ACCESS_REFUSALS = new Set([
  'PROJECT_NOT_FOUND',
  'PROJECT_FORBIDDEN',
  'RBAC_FORBIDDEN',
  'TASK_NOT_FOUND',
  'TEAM_ACCESS_DENIED',
]);

/**
 * A load performed with the ACTOR's access, after the key holder's own
 * load succeeded, can only fail for the actor — so its refusal names the
 * actor (403 `ACTOR_FORBIDDEN`) instead of reading as a vanished project or
 * a lacking key. Anything else (a database error, say) passes through.
 */
export function refusedForActor(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code === 'string' && ACCESS_REFUSALS.has(code)) {
    throw new RestRefusal(
      'The named member may not act here: no access to this project or task',
      403,
      'ACTOR_FORBIDDEN',
    );
  }
  throw error;
}

/**
 * Gate, then resolve. Null when the request names no actor — the caller
 * then acts as the key itself. A key holder who may not act for others is
 * refused before any member row is read.
 */
export async function resolveRequestActor(
  sql: Sql,
  c: Context<RestEnv>,
  actor: ActorBody | undefined,
): Promise<ResolvedActor | null> {
  if (actor === undefined) return null;
  const allowed = await mayActAs(
    sql,
    {
      organizationId: c.get('organizationId'),
      userId: c.get('userId'),
      role: c.get('role'),
    },
    Date.now(),
  );
  if (!allowed) {
    throw new RestRefusal(
      'Acting for another member requires an organization owner or admin, or the "tale:rest.act-as" capability granted by one.',
      403,
      'ROLE_FORBIDDEN',
    );
  }
  return resolveActor(sql, c.get('organizationId'), actor);
}

/** How a record names who acted: the person, or the key when nobody was named. */
export function actedBy(
  actor: ResolvedActor | null,
  c: Context<RestEnv>,
): string {
  return actor?.userId ?? `api-key:${c.get('userId')}`;
}
