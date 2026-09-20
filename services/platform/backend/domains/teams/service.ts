import type { Sql, TransactionSql } from 'postgres';

import { TEAM_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { syncRagDocumentScope } from '../knowledge/service.ts';

/**
 * Team SCOPE retirement — what must happen to the rows a team scoped when
 * the team itself goes away.
 *
 * `app.projects.team_ids`, `app.folders.team_tags`, `app.documents.team_tags`
 * (the audience arrays, `core/lib/audience.ts`), `app.conversations.
 * assignee_team_id` (a queue) and the cloud-sync configs' `team_id` are
 * plain text columns with no FK to Better Auth's `"team"` table. A row
 * still naming a deleted team is a ghost: the audience predicate matches it
 * against nobody's memberships, so every non-admin loses access with no
 * explanation and the Audience picker cannot even render the missing team.
 *
 * The retirement narrows nothing and widens nothing beyond what the deleted
 * team already implied: a project, folder or document drops the team from
 * its audience and keeps the rest — and only when that team was its LAST
 * one does it become organization-wide, the same state it reaches when an
 * admin clears its audience by hand (`nowOrgWide` counts those, so the
 * delete confirmation can say so). A team queue on a conversation goes back
 * to unassigned; a sync config stops stamping the ghost on every file it
 * imports.
 *
 * Every deletion door runs this INSIDE the transaction that deletes the team
 * (`deleteTeamInTx` for the app door, SCIM `deleteGroup`, the SSO reaper);
 * `retireDeletedTeamScopes` remains for the Better Auth plugin's own
 * endpoint, whose hook can only run after the plugin's commit. With every
 * scope write validating its team ids (`assertTeamsAssignable`) there is no
 * other way for a ghost to appear, so the daily repair sweep this module
 * used to carry is gone (migration 0109 swept the last ones).
 */

/**
 * Every team's id and name of one organization, by name — the directory
 * every member may read. A team's NAME is not a secret: it is what every
 * audience badge, project row, inbox queue and skill label shows, so this
 * is the one read every surface resolves names through (the app's
 * `GET /api/app/teams/directory` and the REST `GET /api/v1/teams`), instead
 * of the caller's own teams, which left a member looking at blanks and raw
 * ids for teams they are not in — and left a machine caller with no way to
 * learn the id an audience takes (2026-09-19 evaluation, K4-1).
 */
export async function listTeamDirectory(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "team"
    WHERE "organizationId" = ${organizationId}
    ORDER BY "name" ASC
  `;
}

export interface TeamScopeRetirement {
  /** Projects that carried the team in their audience. */
  projectsRetagged: number;
  foldersRetagged: number;
  documentsRetagged: number;
  conversationsUnassigned: number;
  syncConfigsUnscoped: number;
  /** Of the retagged rows, how many lost their LAST team — visible to the
   * whole organization from now on. */
  nowOrgWide: { projects: number; folders: number; documents: number };
  /**
   * File-backed documents whose corpus scope row must be re-stamped AFTER
   * the transaction commits (`resyncRetiredDocumentScopes`) — retrieval
   * filters on the corpus copy of `team_ids`.
   */
  touchedFileDocumentIds: string[];
}

function emptyRetirement(): TeamScopeRetirement {
  return {
    projectsRetagged: 0,
    foldersRetagged: 0,
    documentsRetagged: 0,
    conversationsUnassigned: 0,
    syncConfigsUnscoped: 0,
    nowOrgWide: { projects: 0, folders: 0, documents: 0 },
    touchedFileDocumentIds: [],
  };
}

/** Anything at all changed. */
export function retirementTouchedRows(r: TeamScopeRetirement): boolean {
  return (
    r.projectsRetagged +
      r.foldersRetagged +
      r.documentsRetagged +
      r.conversationsUnassigned +
      r.syncConfigsUnscoped >
    0
  );
}

/**
 * Take `teamId` out of every scope in `organizationId`, inside the caller's
 * transaction. Idempotent: a second pass over the same team changes nothing.
 * Hints are org-wide per entity (the client invalidates by entity).
 */
export async function retireTeamScopes(
  tx: TransactionSql,
  organizationId: string,
  teamId: string,
): Promise<TeamScopeRetirement> {
  const now = Date.now();
  const result = emptyRetirement();
  const team = [teamId];

  // Projects: the audience array with its two derived mirrors. SET reads
  // the OLD row, so every expression derives from the same pre-update
  // audience (`PROJECT_TEAM_IDS_SQL` folds in a row the previous image wrote
  // with mirrors only); RETURNING reads the NEW row.
  const projects = await tx<{ id: string; nowOrgWide: boolean }[]>`
    UPDATE app.projects SET
      team_ids = array_remove(${tx.unsafe(PROJECT_TEAM_IDS_SQL)}, ${teamId}),
      team_id = (array_remove(${tx.unsafe(PROJECT_TEAM_IDS_SQL)}, ${teamId}))[1],
      shared_with_team_ids =
        (array_remove(${tx.unsafe(PROJECT_TEAM_IDS_SQL)}, ${teamId}))[2:],
      updated_at_ms = ${now}
    WHERE org_id = ${organizationId}
      AND ${tx.unsafe(PROJECT_TEAM_IDS_SQL)} @> ${team}::text[]
    RETURNING id, cardinality(team_ids) = 0 AS "nowOrgWide"
  `;
  result.projectsRetagged = projects.length;
  result.nowOrgWide.projects = projects.filter((p) => p.nowOrgWide).length;

  // Folders and documents carry the audience in `team_tags` and the first
  // tag mirrored in `team_id`: drop the team and re-derive the mirror.
  const folders = await tx<{ id: string; nowOrgWide: boolean }[]>`
    UPDATE app.folders SET
      team_tags = array_remove(team_tags, ${teamId}),
      team_id = (array_remove(team_tags, ${teamId}))[1]
    WHERE org_id = ${organizationId} AND team_tags @> ${team}::text[]
    RETURNING id, cardinality(team_tags) = 0 AS "nowOrgWide"
  `;
  result.foldersRetagged = folders.length;
  result.nowOrgWide.folders = folders.filter((f) => f.nowOrgWide).length;

  const documents = await tx<
    { id: string; fileRef: string | null; nowOrgWide: boolean }[]
  >`
    UPDATE app.documents SET
      team_tags = array_remove(team_tags, ${teamId}),
      team_id = (array_remove(team_tags, ${teamId}))[1],
      updated_at_ms = ${now}
    WHERE org_id = ${organizationId} AND team_tags @> ${team}::text[]
    RETURNING id, file_ref AS "fileRef", cardinality(team_tags) = 0 AS "nowOrgWide"
  `;
  result.documentsRetagged = documents.length;
  result.nowOrgWide.documents = documents.filter((d) => d.nowOrgWide).length;
  result.touchedFileDocumentIds = documents
    .filter((doc) => doc.fileRef !== null)
    .map((doc) => doc.id);

  const conversations = await tx<{ id: string }[]>`
    UPDATE app.conversations SET assignee_team_id = NULL
    WHERE org_id = ${organizationId} AND assignee_team_id = ${teamId}
    RETURNING id
  `;
  result.conversationsUnassigned = conversations.length;

  // A live sync keeps STAMPING its config's team on every file it imports —
  // a ghost here would mint new ghost documents forever.
  const onedrive = await tx<{ id: string }[]>`
    UPDATE app.onedrive_sync_configs SET team_id = NULL, updated_at_ms = ${now}
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
    RETURNING id
  `;
  const google = await tx<{ id: string }[]>`
    UPDATE app.google_drive_sync_configs
    SET team_id = NULL, updated_at_ms = ${now}
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
    RETURNING id
  `;
  result.syncConfigsUnscoped = onedrive.length + google.length;

  const hints: { entity: string; changed: number }[] = [
    { entity: 'project', changed: projects.length },
    { entity: 'folder', changed: folders.length },
    { entity: 'document', changed: documents.length },
    { entity: 'conversation', changed: conversations.length },
  ];
  for (const hint of hints) {
    if (hint.changed === 0) continue;
    await emitHintInTx(tx, {
      orgId: organizationId,
      entity: hint.entity,
      entityId: null,
    });
  }
  return result;
}

/**
 * Post-commit half: re-stamp the corpus scope of the file-backed documents a
 * retirement re-tagged. Best-effort by `syncRagDocumentScope`'s own
 * contract (a corpus failure logs; the next re-index is the backstop).
 */
export async function resyncRetiredDocumentScopes(
  sql: Sql,
  organizationId: string,
  retirement: TeamScopeRetirement,
): Promise<void> {
  for (const documentId of retirement.touchedFileDocumentIds) {
    await syncRagDocumentScope(sql, organizationId, documentId);
  }
}

/**
 * The whole retirement for a team that is already gone (Better Auth's
 * `afterDeleteTeam`, whose hook runs after the plugin's own commit): one
 * transaction for the rows, then the corpus re-stamp.
 */
export async function retireDeletedTeamScopes(
  sql: Sql,
  organizationId: string,
  teamId: string,
): Promise<TeamScopeRetirement> {
  const retirement = await sql.begin((tx) =>
    retireTeamScopes(tx, organizationId, teamId),
  );
  await resyncRetiredDocumentScopes(sql, organizationId, retirement);
  if (retirementTouchedRows(retirement)) {
    console.info(
      `[teams] retired scopes of deleted team ${teamId} in org ${organizationId}: ` +
        `projects=${retirement.projectsRetagged}, folders=${retirement.foldersRetagged}, ` +
        `documents=${retirement.documentsRetagged}, conversations=${retirement.conversationsUnassigned}, ` +
        `syncConfigs=${retirement.syncConfigsUnscoped}`,
    );
  }
  return retirement;
}

/**
 * What deleting a team would touch — the numbers the delete confirmation
 * shows before an admin commits. `becomeOrgWide` counts the rows whose
 * ONLY team this is: they will be visible to the whole organization.
 */
export interface TeamDeletionImpact {
  teamId: string;
  name: string;
  memberCount: number;
  projects: { scoped: number; becomeOrgWide: number };
  folders: { scoped: number; becomeOrgWide: number };
  documents: { scoped: number; becomeOrgWide: number };
  conversations: { queued: number };
  syncConfigs: { scoped: number };
}

export async function teamDeletionImpact(
  sql: Sql,
  organizationId: string,
  teamId: string,
): Promise<TeamDeletionImpact | null> {
  const team = [teamId];
  const rows = await sql<
    {
      name: string;
      memberCount: number;
      projects: number;
      projectsSole: number;
      folders: number;
      foldersSole: number;
      documents: number;
      documentsSole: number;
      conversations: number;
      syncConfigs: number;
    }[]
  >`
    SELECT t."name",
      (SELECT count(*) FROM "teamMember" tm WHERE tm."teamId" = t."id")::int
        AS "memberCount",
      (SELECT count(*) FROM app.projects p
        WHERE p.org_id = ${organizationId}
          AND ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} @> ${team}::text[])::int
        AS projects,
      (SELECT count(*) FROM app.projects p
        WHERE p.org_id = ${organizationId}
          AND ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} = ${team}::text[])::int
        AS "projectsSole",
      (SELECT count(*) FROM app.folders f
        WHERE f.org_id = ${organizationId} AND f.team_tags @> ${team}::text[])::int
        AS folders,
      (SELECT count(*) FROM app.folders f
        WHERE f.org_id = ${organizationId} AND f.team_tags = ${team}::text[])::int
        AS "foldersSole",
      (SELECT count(*) FROM app.documents d
        WHERE d.org_id = ${organizationId} AND d.team_tags @> ${team}::text[]
          AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active'))::int
        AS documents,
      (SELECT count(*) FROM app.documents d
        WHERE d.org_id = ${organizationId} AND d.team_tags = ${team}::text[]
          AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active'))::int
        AS "documentsSole",
      (SELECT count(*) FROM app.conversations c
        WHERE c.org_id = ${organizationId} AND c.assignee_team_id = t."id")::int
        AS conversations,
      ((SELECT count(*) FROM app.onedrive_sync_configs s
         WHERE s.org_id = ${organizationId} AND s.team_id = t."id")
       + (SELECT count(*) FROM app.google_drive_sync_configs s
         WHERE s.org_id = ${organizationId} AND s.team_id = t."id"))::int
        AS "syncConfigs"
    FROM "team" t
    WHERE t."id" = ${teamId} AND t."organizationId" = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    teamId,
    name: row.name,
    memberCount: row.memberCount,
    projects: { scoped: row.projects, becomeOrgWide: row.projectsSole },
    folders: { scoped: row.folders, becomeOrgWide: row.foldersSole },
    documents: { scoped: row.documents, becomeOrgWide: row.documentsSole },
    conversations: { queued: row.conversations },
    syncConfigs: { scoped: row.syncConfigs },
  };
}

/**
 * Delete a team ATOMICALLY — the app door's core: the scopes it held, its
 * identity-provider provenance, its memberships and the team row itself go
 * in ONE transaction (the caller's), so no half-deleted state can exist.
 * Answers null when the team is not this organization's. The caller
 * re-stamps the corpus copies after commit (`resyncRetiredDocumentScopes`).
 */
export async function deleteTeamInTx(
  tx: TransactionSql,
  organizationId: string,
  teamId: string,
): Promise<{ name: string; retirement: TeamScopeRetirement } | null> {
  const teams = await tx<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "team"
    WHERE "id" = ${teamId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  const team = teams[0];
  if (team === undefined) return null;
  const retirement = await retireTeamScopes(tx, organizationId, teamId);
  // An identity-provider-synced team deleted by hand: its provenance and a
  // SCIM Group link would otherwise point at a team that no longer exists
  // (the SCIM `deleteGroup` twin does the same for its own lane).
  await tx`
    DELETE FROM app.sso_synced_team_members
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
  `;
  await tx`
    DELETE FROM app.sso_synced_teams
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
  `;
  await tx`
    DELETE FROM app.sso_provisioning_links
    WHERE org_id = ${organizationId} AND internal_id = ${teamId}
      AND resource_type = 'Group'
  `;
  await tx`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
  await tx`DELETE FROM "team" WHERE "id" = ${teamId}`;
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: TEAM_HINT_ENTITY,
    entityId: teamId,
  });
  return { name: team.name, retirement };
}
