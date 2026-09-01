import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { isAdmin } from '../../core/lib/rls/helpers/role_helpers.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * /api/app/teams — team MEMBERSHIP over the Better Auth tables (the 0.5
 * twin of `convex/team_members/*`; the mirror machinery died with the
 * rewrite — these are direct reads/writes on `"teamMember"`). Team create/
 * rename/delete ride the Better Auth organization plugin's own endpoints.
 * Listing is member-visible; add/remove need an org admin.
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

  // The caller's own teams (the team filter's boot read on every dashboard
  // page) — the 0.4 `members/queries:getMyTeams` shape.
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

  // Org teams listing (0.4 `listOrgTeams`): admins see EVERY team, other
  // members their own — the settings Teams page's read.
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
      }[]
    >`
      SELECT t."id", t."name",
             (SELECT count(*) FROM "teamMember" c WHERE c."teamId" = t."id")::text
               AS "memberCount",
             t."createdAt"::text AS "createdAt"
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

  app.get('/:teamId/members', async (c) => {
    const team = await teamInOrg(c.req.param('teamId'), c.get('orgId'));
    if (team === null) return c.json({ members: [] });
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
          role: string;
          joinedAt: number;
          displayName?: string;
          email?: string;
        } = {
          id: row.id,
          teamId: row.teamId,
          userId: row.userId,
          role: 'member',
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
    if (!isAdminRole(c.get('orgMember').role)) {
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
      entity: 'team',
      entityId: team.id,
    });
    return c.json({ id, alreadyMember: false }, 201);
  });

  /** Remove by the teamMember ROW id (the 0.4 `removeMember` wire — the
   * settings table rows carry `_id`, not (team,user) pairs). */
  app.delete('/members/by-id/:teamMemberId', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'Only admins can remove team members' }, 403);
    }
    const removed = await deps.sql<{ id: string; teamId: string }[]>`
      DELETE FROM "teamMember" tm
      USING "team" t
      WHERE tm."id" = ${c.req.param('teamMemberId')}
        AND t."id" = tm."teamId"
        AND t."organizationId" = ${c.get('orgId')}
      RETURNING tm."id", tm."teamId" AS "teamId"
    `;
    const row = removed[0];
    if (row !== undefined) {
      await emitHintInTx(deps.sql, {
        orgId: c.get('orgId'),
        entity: 'team',
        entityId: row.teamId,
      });
    }
    return c.json({ removed: row !== undefined });
  });

  app.delete('/:teamId/members/:userId', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'Only admins can remove team members' }, 403);
    }
    const team = await teamInOrg(c.req.param('teamId'), c.get('orgId'));
    if (team === null) return c.json({ error: 'TEAM_NOT_FOUND' }, 404);
    const removed = await deps.sql<{ id: string }[]>`
      DELETE FROM "teamMember"
      WHERE "teamId" = ${team.id} AND "userId" = ${c.req.param('userId')}
      RETURNING "id"
    `;
    if (removed.length > 0) {
      await emitHintInTx(deps.sql, {
        orgId: c.get('orgId'),
        entity: 'team',
        entityId: team.id,
      });
    }
    return c.json({ removed: removed.length > 0 });
  });

  return app;
}
