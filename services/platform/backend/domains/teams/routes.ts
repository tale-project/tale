import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { TEAM_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { isAdmin } from '../../core/lib/rls/helpers/role_helpers.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  deleteTeamInTx,
  listTeamDirectory,
  resyncRetiredDocumentScopes,
  teamDeletionImpact,
} from './service.ts';

/**
 * /api/app/teams — teams and team MEMBERSHIP over the Better Auth tables
 * (the 0.5 twin of `convex/team_members/*`; the mirror machinery died with
 * the rewrite — these are direct reads/writes on `"team"`/`"teamMember"`).
 *
 * Team create and rename ride the Better Auth organization plugin's own
 * endpoints. Team DELETE is this door's: the scopes a team held (project,
 * folder and document audiences, conversation queues, sync configs), its
 * identity-provider provenance, its memberships and the team row go in ONE
 * transaction (`deleteTeamInTx`), so no half-deleted team can exist and no
 * repair sweep is needed. `/:teamId/impact` previews what that delete will
 * touch — including what becomes organization-wide.
 *
 * Reads: `/mine` and `/directory` are member-visible (the directory is
 * every team's id and name, so every surface can label a team without
 * leaking its roster); `/` lists every team for an admin and the caller's
 * own for everyone else; a roster is visible to admins and that team's own
 * members. Add/remove need an org admin, and a team never drops to zero
 * members through the admin doors (`TEAM_LAST_MEMBER`) — an identity
 * provider's own lanes (SCIM, SSO group sync) are authoritative and not
 * bound by that rule.
 */
export function createTeamRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  /** The team row, only when it belongs to the caller's org. */
  const teamInOrg = async (
    teamId: string,
    orgId: string,
  ): Promise<{ id: string } | null> => {
    const rows = await deps.sql<{ id: string }[]>`
      SELECT "id" FROM "team"
      WHERE "id" = ${teamId} AND "organizationId" = ${orgId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  };

  const callerIsAdmin = (c: Context<OrgEnv>): boolean =>
    isAdminRole(c.get('orgMember').role);

  /** Whether the caller belongs to `teamId` (admins pass without a read). */
  const callerMayReadRoster = async (
    c: Context<OrgEnv>,
    teamId: string,
  ): Promise<boolean> => {
    if (callerIsAdmin(c)) return true;
    const rows = await deps.sql<{ id: string }[]>`
      SELECT "id" FROM "teamMember"
      WHERE "teamId" = ${teamId}
        AND "userId" = ${c.get('sessionBundle').user.id}
      LIMIT 1
    `;
    return rows.length > 0;
  };

  // The caller's own teams — the 0.4 `members/queries:getMyTeams` shape.
  app.get('/mine', async (c) => {
    const rows = await deps.sql<
      {
        id: string;
        name: string;
        memberCount: string;
        createdAt: string | null;
      }[]
    >`
      SELECT t."id", t."name",
             (SELECT count(*) FROM "teamMember" c WHERE c."teamId" = t."id")::text
               AS "memberCount",
             t."createdAt"::text AS "createdAt"
      FROM "team" t
      JOIN "teamMember" tm ON tm."teamId" = t."id"
      WHERE t."organizationId" = ${c.get('orgId')}
        AND tm."userId" = ${c.get('sessionBundle').user.id}
      ORDER BY t."name" ASC
    `;
    return c.json({
      teams: rows.map((row) => ({
        id: row.id,
        name: row.name,
        memberCount: Number(row.memberCount),
        createdAt:
          row.createdAt === null ? null : new Date(row.createdAt).getTime(),
      })),
    });
  });

  /** Every team's id and name, for any member (`listTeamDirectory`). */
  app.get('/directory', async (c) => {
    return c.json({
      teams: await listTeamDirectory(deps.sql, c.get('orgId')),
    });
  });

  // Org teams listing (0.4 `listOrgTeams`): admins see EVERY team, other
  // members their own — the settings Teams page's read. `synced` marks a
  // team an identity provider provisions (SSO group sync / SCIM), whose
  // membership the provider owns.
  app.get('/', async (c) => {
    const role = c.get('orgMember').role;
    const userId = c.get('sessionBundle').user.id;
    const admin = isAdmin(role);
    const rows = await deps.sql<
      {
        id: string;
        name: string;
        memberCount: string;
        createdAt: string | null;
        synced: boolean;
      }[]
    >`
      SELECT t."id", t."name",
             (SELECT count(*) FROM "teamMember" c WHERE c."teamId" = t."id")::text
               AS "memberCount",
             t."createdAt"::text AS "createdAt",
             EXISTS (
               SELECT 1 FROM app.sso_synced_teams s
               WHERE s.org_id = t."organizationId" AND s.team_id = t."id"
             ) OR EXISTS (
               SELECT 1 FROM app.sso_provisioning_links l
               WHERE l.org_id = t."organizationId" AND l.internal_id = t."id"
                 AND l.resource_type = 'Group'
             ) AS synced
      FROM "team" t
      WHERE t."organizationId" = ${c.get('orgId')}
        AND (${admin} OR EXISTS (
          SELECT 1 FROM "teamMember" tm
          WHERE tm."teamId" = t."id" AND tm."userId" = ${userId}
        ))
      ORDER BY t."name" ASC
    `;
    return c.json({
      teams: rows.map((row) => ({
        id: row.id,
        name: row.name,
        memberCount: Number(row.memberCount),
        createdAt:
          row.createdAt === null ? null : new Date(row.createdAt).getTime(),
        synced: row.synced,
      })),
    });
  });

  /** The caller's team count (0.4 `approxCountMyTeams` — a cheap gate). */
  app.get('/count/mine', async (c) => {
    const rows = await deps.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM "teamMember" tm
      JOIN "team" t ON t."id" = tm."teamId"
      WHERE t."organizationId" = ${c.get('orgId')}
        AND tm."userId" = ${c.get('sessionBundle').user.id}
    `;
    return c.json({ count: Number(rows[0]?.count ?? '0') });
  });

  /** What deleting the team would touch — the confirm dialog's numbers. */
  app.get('/:teamId/impact', async (c) => {
    if (!callerIsAdmin(c)) {
      return c.json({ error: 'TEAM_FORBIDDEN' }, 403);
    }
    const impact = await teamDeletionImpact(
      deps.sql,
      c.get('orgId'),
      c.req.param('teamId'),
    );
    if (impact === null) return c.json({ error: 'TEAM_NOT_FOUND' }, 404);
    return c.json({ impact });
  });

  /**
   * Delete a team atomically: scopes, provenance, memberships and the row in
   * one transaction, audited, then the corpus re-stamp for the documents
   * that changed audience.
   */
  app.delete('/:teamId', async (c) => {
    if (!callerIsAdmin(c)) {
      return c.json({ error: 'TEAM_FORBIDDEN' }, 403);
    }
    const orgId = c.get('orgId');
    const teamId = c.req.param('teamId');
    const user = c.get('sessionBundle').user;
    const result = await transactSerializable(deps.sql, async (tx) => {
      const deleted = await deleteTeamInTx(tx, orgId, teamId);
      if (deleted === null) return null;
      const { touchedFileDocumentIds: _touched, ...counts } =
        deleted.retirement;
      await createAuditLog(tx, {
        organizationId: orgId,
        actorId: user.id,
        actorEmail: user.email,
        actorRole: c.get('orgMember').role,
        actorType: 'user',
        action: 'team.deleted',
        category: 'member',
        resourceType: 'team',
        resourceId: teamId,
        resourceName: deleted.name,
        metadata: counts,
        status: 'success',
      });
      return deleted;
    });
    if (result === null) return c.json({ error: 'TEAM_NOT_FOUND' }, 404);
    await resyncRetiredDocumentScopes(deps.sql, orgId, result.retirement);
    const { touchedFileDocumentIds: _touched, ...retirement } =
      result.retirement;
    return c.json({ deleted: true, retirement });
  });

  app.get('/:teamId/members', async (c) => {
    const team = await teamInOrg(c.req.param('teamId'), c.get('orgId'));
    if (team === null) return c.json({ members: [] });
    // A roster is the team's own business: its members and the admins.
    if (!(await callerMayReadRoster(c, team.id))) {
      return c.json({ error: 'TEAM_FORBIDDEN' }, 403);
    }
    const rows = await deps.sql<
      {
        id: string;
        teamId: string;
        userId: string;
        joinedAt: string | Date | null;
        displayName: string | null;
        email: string | null;
      }[]
    >`
      SELECT tm."id", tm."teamId", tm."userId", tm."createdAt" AS "joinedAt",
             u."name" AS "displayName", u."email"
      FROM "teamMember" tm
      LEFT JOIN "user" u ON u."id" = tm."userId"
      WHERE tm."teamId" = ${team.id}
      ORDER BY tm."createdAt"
    `;
    return c.json({
      members: rows.map((row) => {
        const member: {
          id: string;
          teamId: string;
          userId: string;
          joinedAt: number;
          displayName?: string;
          email?: string;
        } = {
          id: row.id,
          teamId: row.teamId,
          userId: row.userId,
          joinedAt:
            row.joinedAt === null ? 0 : new Date(row.joinedAt).getTime(),
        };
        if (row.displayName !== null) member.displayName = row.displayName;
        if (row.email !== null) member.email = row.email;
        return member;
      }),
    });
  });

  app.post('/:teamId/members', async (c) => {
    if (!callerIsAdmin(c)) {
      return c.json({ error: 'Only admins can add team members' }, 403);
    }
    const body = z
      .object({ userId: z.string().min(1).max(128) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgId = c.get('orgId');
    const team = await teamInOrg(c.req.param('teamId'), orgId);
    if (team === null) return c.json({ error: 'TEAM_NOT_FOUND' }, 404);
    // The target must already be an org member — a team never smuggles an
    // outsider into the organization.
    const member = await deps.sql<{ id: string }[]>`
      SELECT "id" FROM "member"
      WHERE "organizationId" = ${orgId} AND "userId" = ${body.data.userId}
      LIMIT 1
    `;
    if (member.length === 0) {
      return c.json({ error: 'USER_NOT_ORG_MEMBER' }, 400);
    }
    const existing = await deps.sql<{ id: string }[]>`
      SELECT "id" FROM "teamMember"
      WHERE "teamId" = ${team.id} AND "userId" = ${body.data.userId}
      LIMIT 1
    `;
    if (existing[0]) {
      return c.json({ id: existing[0].id, alreadyMember: true });
    }
    const id = randomUUID();
    await deps.sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${id}, ${team.id}, ${body.data.userId}, ${new Date()})
    `;
    await emitHintInTx(deps.sql, {
      orgId: c.get('orgId'),
      entity: TEAM_HINT_ENTITY,
      entityId: team.id,
    });
    return c.json({ id, alreadyMember: false }, 201);
  });

  /**
   * Remove one membership under the team's row lock, refusing to take the
   * LAST member (`TEAM_LAST_MEMBER`): the rule the settings UI always
   * showed, enforced where it can be relied on. `null` = no such row.
   */
  const removeMembership = async (
    orgId: string,
    locate: (
      tx: TransactionSql,
    ) => Promise<{ id: string; teamId: string } | null>,
  ): Promise<{
    removed: boolean;
    lastMember: boolean;
    teamId: string | null;
  }> =>
    deps.sql.begin(async (tx) => {
      const row = await locate(tx);
      if (row === null) {
        return { removed: false, lastMember: false, teamId: null };
      }
      await tx`SELECT "id" FROM "team" WHERE "id" = ${row.teamId} FOR UPDATE`;
      const counted = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM "teamMember"
        WHERE "teamId" = ${row.teamId}
      `;
      if (Number(counted[0]?.count ?? '0') <= 1) {
        return { removed: false, lastMember: true, teamId: row.teamId };
      }
      await tx`DELETE FROM "teamMember" WHERE "id" = ${row.id}`;
      await emitHintInTx(tx, {
        orgId,
        entity: TEAM_HINT_ENTITY,
        entityId: row.teamId,
      });
      return { removed: true, lastMember: false, teamId: row.teamId };
    });

  const lastMemberRefusal = (c: Context<OrgEnv>) =>
    c.json(
      {
        error: 'TEAM_LAST_MEMBER',
        message:
          'A team keeps at least one member. Delete the team instead, or add another member first.',
      },
      409,
    );

  /** Remove by the teamMember ROW id (the 0.4 `removeMember` wire — the
   * settings table rows carry `_id`, not (team,user) pairs). */
  app.delete('/members/by-id/:teamMemberId', async (c) => {
    if (!callerIsAdmin(c)) {
      return c.json({ error: 'Only admins can remove team members' }, 403);
    }
    const orgId = c.get('orgId');
    const teamMemberId = c.req.param('teamMemberId');
    const outcome = await removeMembership(orgId, async (tx) => {
      const rows = await tx<{ id: string; teamId: string }[]>`
        SELECT tm."id", tm."teamId"
        FROM "teamMember" tm
        JOIN "team" t ON t."id" = tm."teamId"
        WHERE tm."id" = ${teamMemberId} AND t."organizationId" = ${orgId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
    if (outcome.lastMember) return lastMemberRefusal(c);
    return c.json({ removed: outcome.removed });
  });

  app.delete('/:teamId/members/:userId', async (c) => {
    if (!callerIsAdmin(c)) {
      return c.json({ error: 'Only admins can remove team members' }, 403);
    }
    const orgId = c.get('orgId');
    const team = await teamInOrg(c.req.param('teamId'), orgId);
    if (team === null) return c.json({ error: 'TEAM_NOT_FOUND' }, 404);
    const userId = c.req.param('userId');
    const outcome = await removeMembership(orgId, async (tx) => {
      const rows = await tx<{ id: string; teamId: string }[]>`
        SELECT "id", "teamId" FROM "teamMember"
        WHERE "teamId" = ${team.id} AND "userId" = ${userId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
    if (outcome.lastMember) return lastMemberRefusal(c);
    return c.json({ removed: outcome.removed });
  });

  return app;
}
