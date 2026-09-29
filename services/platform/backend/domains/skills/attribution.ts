import type { Sql, TransactionSql } from 'postgres';

import type { SkillSummaryView } from '../../core/skills/views.ts';
import { SKILL_WRITE_ACTIONS } from './audit.ts';

/**
 * Who created and who last edited a skill, resolved for the doors that show
 * skills (the app's library, the REST family, the agent skill pickers). The
 * file layer stays free of SQL: it answers the frontmatter `owner` and the
 * document's tag, and this module adds the names in two batched reads per
 * listing — the way documents resolve `createdByName`.
 *
 * - `ownerName` — the owner's display name while they are a member of the
 *   organization. A departed member, or an id that names nobody in it,
 *   stays nameless: the reader shows "Former member", and a name from
 *   another organization never leaks through a declared id.
 * - `updatedBy` / `updatedByName` — the newest skill write the audit trail
 *   holds (`audit.ts`): when it is a `skill.updated` row whose resulting tag
 *   is the tag stored now, its actor edited the version on disk. Anything
 *   else — a skill nobody edited since it was created, a file changed
 *   outside Tale since, a row the retention sweep has removed — answers no
 *   editor rather than a wrong one.
 */

/** The display names of the given users who are members of the org. A
 * member without a name reads as their email. */
async function memberDisplayNames(
  sql: Sql | TransactionSql,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await sql<{ id: string; name: string | null; email: string }[]>`
    SELECT u."id", u."name", u."email"
    FROM "user" u
    JOIN "member" m ON m."userId" = u."id"
    WHERE m."organizationId" = ${organizationId}
      AND u."id" = ANY(${ids})
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      row.name !== null && row.name.trim() !== '' ? row.name : row.email,
    ]),
  );
}

/** Per slug, the actor of its newest recorded write when that write is an
 * edit that produced the given tag. */
async function lastEditors(
  sql: Sql | TransactionSql,
  organizationId: string,
  skills: ReadonlyArray<{ slug: string; etag: string }>,
): Promise<Map<string, string>> {
  if (skills.length === 0) return new Map();
  const rows = await sql<
    { slug: string; action: string; actorId: string; etag: string | null }[]
  >`
    SELECT DISTINCT ON (resource_id)
      resource_id AS "slug",
      action,
      actor_id AS "actorId",
      metadata->>'etag' AS "etag"
    FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND resource_type = 'skill'
      AND resource_id = ANY(${skills.map((skill) => skill.slug)})
      AND action = ANY(${[
        SKILL_WRITE_ACTIONS.created,
        SKILL_WRITE_ACTIONS.updated,
        'skill.deleted',
      ]})
    ORDER BY resource_id, ts DESC
  `;
  const liveTag = new Map(skills.map((skill) => [skill.slug, skill.etag]));
  const editors = new Map<string, string>();
  for (const row of rows) {
    if (
      row.action === SKILL_WRITE_ACTIONS.updated &&
      row.etag !== null &&
      row.etag === liveTag.get(row.slug)
    ) {
      editors.set(row.slug, row.actorId);
    }
  }
  return editors;
}

/**
 * The skill views with `ownerName`, `updatedBy` and `updatedByName` filled
 * in, in their input order. Each view keeps every other field as it was.
 */
export async function withSkillAttribution<T extends SkillSummaryView>(
  sql: Sql | TransactionSql,
  organizationId: string,
  skills: readonly T[],
): Promise<T[]> {
  if (skills.length === 0) return [];
  const editors = await lastEditors(sql, organizationId, skills);
  const names = await memberDisplayNames(sql, organizationId, [
    ...skills.flatMap((skill) =>
      skill.owner === undefined ? [] : [skill.owner],
    ),
    ...editors.values(),
  ]);
  return skills.map((skill) => {
    const view: T = { ...skill };
    delete view.ownerName;
    delete view.updatedBy;
    delete view.updatedByName;
    const ownerName =
      skill.owner === undefined ? undefined : names.get(skill.owner);
    if (ownerName !== undefined) view.ownerName = ownerName;
    const editor = editors.get(skill.slug);
    if (editor !== undefined) {
      view.updatedBy = editor;
      const editorName = names.get(editor);
      if (editorName !== undefined) view.updatedByName = editorName;
    }
    return view;
  });
}

/** One skill view with its attribution — see {@link withSkillAttribution}. */
export async function withOneSkillAttribution<T extends SkillSummaryView>(
  sql: Sql | TransactionSql,
  organizationId: string,
  skill: T,
): Promise<T> {
  const [view] = await withSkillAttribution(sql, organizationId, [skill]);
  return view ?? skill;
}
