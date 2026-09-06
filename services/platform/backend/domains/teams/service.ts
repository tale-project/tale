import type { Sql, TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { syncRagDocumentScope } from '../knowledge/service.ts';

/**
 * Team SCOPE retirement — what must happen to the rows a team scoped when
 * the team itself goes away.
 *
 * `app.projects.team_id` / `shared_with_team_ids`, `app.folders` and
 * `app.documents` `team_id` / `team_tags`, `app.conversations.assignee_team_id`
 * and the cloud-sync configs' `team_id` are plain text columns with no FK to
 * Better Auth's `"team"` table, and every team-deletion door (the Better Auth
 * `remove-team` endpoint the settings UI calls, SCIM `deleteGroup`, the SSO
 * sync's reaper, the org delete cascade) deletes the team row alone. A row
 * scoped to a deleted team is a ghost: the visibility predicates match it
 * against nobody's memberships, so every non-admin loses access with no
 * explanation and the Sharing select cannot even render the missing team.
 *
 * The retirement narrows nothing and widens nothing beyond what the deleted
 * team already implied: a project OWNED by the team hands ownership to the
 * first team it was shared with (same audience minus the gone team — the
 * `normalizeSharing` invariant says an ownerless project has no shared
 * list), and only when no shared team remains does it become org-wide, the
 * same state a project reaches when an admin clears its team by hand. A
 * folder or document drops the team from its tags and keeps the rest; a
 * team queue on a conversation goes back to unassigned; a sync config
 * stops stamping the ghost on every file it imports.
 *
 * Every door runs `retireTeamScopes` in the transaction that deletes the
 * team (or right after it, for Better Auth's own endpoint); the daily
 * `teams.repair_scopes` sweep (`repairTeamScopes`) catches the ghosts from
 * before this existed and any door that fails half-way.
 */

export interface TeamScopeRetirement {
  /** Projects the team owned (ownership promoted or cleared). */
  projectsUnscoped: number;
  /** Projects that had the team in their shared list. */
  projectsUnshared: number;
  foldersRetagged: number;
  documentsRetagged: number;
  conversationsUnassigned: number;
  syncConfigsUnscoped: number;
  /**
   * File-backed documents whose corpus scope row must be re-stamped AFTER
   * the transaction commits (`resyncRetiredDocumentScopes`) — retrieval
   * filters on the corpus copy of `team_ids`.
   */
  touchedFileDocumentIds: string[];
}

function emptyRetirement(): TeamScopeRetirement {
  return {
    projectsUnscoped: 0,
    projectsUnshared: 0,
    foldersRetagged: 0,
    documentsRetagged: 0,
    conversationsUnassigned: 0,
    syncConfigsUnscoped: 0,
    touchedFileDocumentIds: [],
  };
}

/** Anything at all changed. */
export function retirementTouchedRows(r: TeamScopeRetirement): boolean {
  return (
    r.projectsUnscoped +
      r.projectsUnshared +
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

  // Owned projects: the first shared team inherits ownership (and leaves the
  // shared list); with none left the project is org-wide. Postgres arrays
  // are 1-based, `arr[2:]` of a one-element or empty array is `{}`.
  const owned = await tx<{ id: string }[]>`
    UPDATE app.projects SET
      team_id = shared_with_team_ids[1],
      shared_with_team_ids = shared_with_team_ids[2:],
      updated_at_ms = ${now}
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
    RETURNING id
  `;
  result.projectsUnscoped = owned.length;

  const shared = await tx<{ id: string }[]>`
    UPDATE app.projects SET
      shared_with_team_ids = array_remove(shared_with_team_ids, ${teamId}),
      updated_at_ms = ${now}
    WHERE org_id = ${organizationId}
      AND ${teamId} = ANY(shared_with_team_ids)
    RETURNING id
  `;
  result.projectsUnshared = shared.length;

  // Folders and documents carry the full list in `team_tags` and the first
  // tag mirrored in `team_id` (`core/lib/team_access`): drop the team from
  // the tags and re-derive the mirror.
  const folders = await tx<{ id: string }[]>`
    UPDATE app.folders SET
      team_tags = array_remove(team_tags, ${teamId}),
      team_id = (array_remove(team_tags, ${teamId}))[1]
    WHERE org_id = ${organizationId}
      AND (team_id = ${teamId} OR ${teamId} = ANY(team_tags))
    RETURNING id
  `;
  result.foldersRetagged = folders.length;

  const documents = await tx<{ id: string; fileRef: string | null }[]>`
    UPDATE app.documents SET
      team_tags = array_remove(team_tags, ${teamId}),
      team_id = (array_remove(team_tags, ${teamId}))[1],
      updated_at_ms = ${now}
    WHERE org_id = ${organizationId}
      AND (team_id = ${teamId} OR ${teamId} = ANY(team_tags))
    RETURNING id, file_ref AS "fileRef"
  `;
  result.documentsRetagged = documents.length;
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
    { entity: 'project', changed: owned.length + shared.length },
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
 * `afterDeleteTeam`, the SSO reaper, the repair sweep): one transaction
 * for the rows, then the corpus re-stamp.
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
        `projects owned=${retirement.projectsUnscoped} shared=${retirement.projectsUnshared}, ` +
        `folders=${retirement.foldersRetagged}, documents=${retirement.documentsRetagged}, ` +
        `conversations=${retirement.conversationsUnassigned}, syncConfigs=${retirement.syncConfigsUnscoped}`,
    );
  }
  return retirement;
}

/**
 * The daily sweep: every (org, team id) still referenced by a scope column
 * whose team row does not exist IN THAT ORG — deleted before the doors
 * retired scopes, a door that failed after its delete, or an id that never
 * was this org's team — is retired the same way. A healthy fleet costs one
 * scan and zero writes.
 */
export async function repairTeamScopes(sql: Sql): Promise<{
  ghosts: { orgId: string; teamId: string }[];
  retired: TeamScopeRetirement[];
}> {
  const ghosts = await sql<{ orgId: string; teamId: string }[]>`
    WITH refs AS (
      SELECT org_id, team_id FROM app.projects WHERE team_id IS NOT NULL
      UNION
      SELECT org_id, unnest(shared_with_team_ids) FROM app.projects
      WHERE cardinality(shared_with_team_ids) > 0
      UNION
      SELECT org_id, team_id FROM app.folders WHERE team_id IS NOT NULL
      UNION
      SELECT org_id, unnest(team_tags) FROM app.folders
      WHERE cardinality(team_tags) > 0
      UNION
      SELECT org_id, team_id FROM app.documents WHERE team_id IS NOT NULL
      UNION
      SELECT org_id, unnest(team_tags) FROM app.documents
      WHERE cardinality(team_tags) > 0
      UNION
      SELECT org_id, assignee_team_id FROM app.conversations
      WHERE assignee_team_id IS NOT NULL
      UNION
      SELECT org_id, team_id FROM app.onedrive_sync_configs
      WHERE team_id IS NOT NULL
      UNION
      SELECT org_id, team_id FROM app.google_drive_sync_configs
      WHERE team_id IS NOT NULL
    )
    SELECT DISTINCT refs.org_id AS "orgId", refs.team_id AS "teamId"
    FROM refs
    WHERE NOT EXISTS (
      SELECT 1 FROM "team" t
      WHERE t."id" = refs.team_id AND t."organizationId" = refs.org_id
    )
    ORDER BY refs.org_id, refs.team_id
  `;
  const retired: TeamScopeRetirement[] = [];
  for (const ghost of ghosts) {
    retired.push(await retireDeletedTeamScopes(sql, ghost.orgId, ghost.teamId));
  }
  if (ghosts.length > 0) {
    console.info(
      `[teams] scope repair retired ${ghosts.length} ghost team reference(s)`,
    );
  }
  return { ghosts, retired };
}
