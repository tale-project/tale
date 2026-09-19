import type { Sql, TransactionSql } from 'postgres';

import {
  assertTeamsAssignable,
  audienceClause,
  audienceMirror,
  canSeeAudience,
  normalizeTeamIds,
  sameAudience,
  TeamAssignmentError,
} from '../../core/lib/audience.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  FolderNameError,
  MAX_FOLDER_DEPTH,
  validateFolderName as validateHubFolderName,
} from './paths.ts';

/**
 * Folders — the Document Hub tree. Scope rule (one owner, mirrored from
 * `convex/folders`): a folder is EITHER a project folder (project_id set,
 * access = the project matrix) OR a hub folder (team rules; teamless =
 * org-wide). Children inherit the parent's scope; depth is capped.
 *
 * Deletion lives with the documents domain: `DELETE /folders/:folderId`
 * runs `documents/service.ts` `deleteFolderCascade` (subtree trash with the
 * legal-hold and controlled-record guards), so this module owns creation,
 * naming, moves, listing and team scoping only.
 */

// Depth cap + name validation live in paths.ts (shared with the sync
// engines' auto-vivification); re-exported here for the existing importers.
export { MAX_FOLDER_DEPTH };

export class FolderError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  /** The structured half of a refusal — the `data` a REST envelope hands
   * on (`domainErrorResponse`): a refused name's `issues`, naming the
   * field and the rule, the shape a refused body field gets. */
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FolderError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export interface FolderRow {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
  createdBy: string | null;
  createdAt: number;
}

const FOLDER_COLUMNS = `
  id, org_id AS "organizationId", name, parent_id AS "parentId",
  team_id AS "teamId", team_tags AS "teamTags", project_id AS "projectId",
  created_by AS "createdBy", created_at_ms::float8 AS "createdAt"
`;

/** The name rule as a `FolderError`: the sentence names the rule broken
 * and `data.issues` names the field, the way a refused body field reads —
 * "Invalid folder name" was the one refusal in the family that said
 * nothing about what to fix (2026-09-13 evaluation, E2-07). */
function validateFolderName(name: string): string {
  try {
    return validateHubFolderName(name);
  } catch (error) {
    if (error instanceof FolderNameError) {
      throw new FolderError('FOLDER_NAME_INVALID', error.message, 400, {
        issues: [{ path: 'name', message: error.rule }],
      });
    }
    throw error;
  }
}

/** A sibling of the same name already exists — the state refusal (409)
 * every create and rename of a project folder can answer. */
function nameTaken(): FolderError {
  return new FolderError('FOLDER_NAME_TAKEN', 'Folder name taken', 409);
}

/** Whether a Postgres error is the project sibling-name index refusing a
 * row — the race two concurrent creates (or a rename beside a create) can
 * lose after both passed the SELECT-then-INSERT sibling check. */
function isSiblingNameRace(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    Reflect.get(error, 'code') === '23505' &&
    Reflect.get(error, 'constraint_name') === 'folders_project_sibling_name'
  );
}

export async function loadFolderOrThrow(
  sql: Sql | TransactionSql,
  folderId: string,
): Promise<FolderRow> {
  const rows = await sql<FolderRow[]>`
    SELECT ${sql.unsafe(FOLDER_COLUMNS)} FROM app.folders
    WHERE id = ${folderId} LIMIT 1
  `;
  const folder = rows[0];
  if (!folder) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  return folder;
}

async function folderDepth(
  tx: TransactionSql | Sql,
  folderId: string,
): Promise<number> {
  const rows = await tx<{ depth: number }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 1 AS depth FROM app.folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id, f.parent_id, chain.depth + 1
      FROM app.folders f JOIN chain ON f.id = chain.parent_id
      WHERE chain.depth < ${MAX_FOLDER_DEPTH + 2}
    )
    SELECT max(depth)::int AS depth FROM chain
  `;
  return rows[0]?.depth ?? 1;
}

/**
 * The project-folder WRITE gate: project readable and editable by the
 * caller. Exported for a writer that stores bytes before it opens the
 * folder transaction (the project-text lane), so authorization runs before
 * anything lands in the org's store.
 */
export async function assertProjectFolderWrite(
  tx: TransactionSql | Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  if (project.organizationId !== auth.organizationId) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new FolderError('PROJECT_FORBIDDEN', 'No project access', 403);
  }
  if (!access.canEdit) {
    throw new FolderError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
}

/**
 * `assertTeamsAssignable` in this domain's refusal vocabulary: a team the
 * caller is not in keeps the code the folder doors always answered
 * (`FOLDER_TEAM_FORBIDDEN`); an id that is not one of the organization's
 * teams is `TEAM_NOT_IN_ORG`.
 */
async function assignableTeams(
  tx: Sql | TransactionSql,
  auth: ProjectAuthContext,
  teamIds: readonly string[],
): Promise<string[]> {
  try {
    return await assertTeamsAssignable(tx, auth, teamIds);
  } catch (error) {
    if (error instanceof TeamAssignmentError) {
      if (error.code === 'TEAM_ACCESS_DENIED') {
        throw new FolderError(
          'FOLDER_TEAM_FORBIDDEN',
          'Cannot assign folder to a team you do not belong to',
          403,
          error.data,
        );
      }
      throw new FolderError(
        error.code,
        error.message,
        error.status,
        error.data,
      );
    }
    throw error;
  }
}

export async function createFolder(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    name: string;
    parentId?: string;
    /** @deprecated The single-team spelling of `teamIds`; still accepted. */
    teamId?: string;
    /** The audience; empty or absent = organization-wide (hub folders). */
    teamIds?: string[];
    projectId?: string;
  },
): Promise<string> {
  const name = validateFolderName(args.name);
  const requestedTeamIds = normalizeTeamIds([
    ...(args.teamIds ?? []),
    ...(args.teamId ? [args.teamId] : []),
  ]);
  if (args.projectId && requestedTeamIds.length > 0) {
    throw new FolderError(
      'FOLDER_SCOPE_CONFLICT',
      'A project folder cannot also carry a team',
    );
  }

  // Decided below: a team folder hands its whole audience to everything
  // created inside it; a root-level or org-wide-parented folder takes the
  // requested audience, validated against the caller.
  let effectiveTeamIds: string[] | null = null;
  let effectiveProjectId = args.projectId ?? null;

  if (args.parentId) {
    const parent = await loadFolderOrThrow(tx, args.parentId);
    if (parent.organizationId !== auth.organizationId) {
      throw new FolderError(
        'FOLDER_PARENT_NOT_FOUND',
        'Parent folder not found',
        404,
      );
    }
    if (args.projectId && parent.projectId !== args.projectId) {
      throw new FolderError(
        'FOLDER_SCOPE_CONFLICT',
        'Parent folder belongs to a different scope',
      );
    }
    effectiveProjectId = parent.projectId ?? args.projectId ?? null;
    if (parent.projectId === null && parent.teamTags.length > 0) {
      if (!canSeeAudience({ teamIds: parent.teamTags }, auth)) {
        throw new FolderError(
          'FOLDER_PARENT_NOT_ACCESSIBLE',
          'Parent folder not accessible',
          403,
        );
      }
      if (
        requestedTeamIds.length > 0 &&
        !sameAudience(requestedTeamIds, parent.teamTags)
      ) {
        throw new FolderError(
          'FOLDER_TEAM_INHERITED',
          'Cannot choose a team: inherited from the parent folder',
        );
      }
      effectiveTeamIds = [...parent.teamTags];
    }
    if ((await folderDepth(tx, args.parentId)) >= MAX_FOLDER_DEPTH) {
      throw new FolderError('FOLDER_DEPTH_EXCEEDED', 'Folder tree too deep');
    }
  }

  if (effectiveProjectId) {
    effectiveTeamIds = [];
    await assertProjectFolderWrite(tx, auth, effectiveProjectId);
  } else if (effectiveTeamIds === null) {
    effectiveTeamIds = await assignableTeams(tx, auth, requestedTeamIds);
  }
  const mirror = audienceMirror(effectiveTeamIds);

  const sibling = await tx<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${auth.organizationId}
      AND parent_id IS NOT DISTINCT FROM ${args.parentId ?? null}
      AND project_id IS NOT DISTINCT FROM ${effectiveProjectId}
      AND lower(name) = ${name.toLowerCase()}
    LIMIT 1
  `;
  if (sibling.length > 0) {
    throw nameTaken();
  }

  // A project folder's sibling uniqueness is DB-enforced
  // (`folders_project_sibling_name`, case-folded): two writers can both
  // pass the check above, so the insert arbitrates on the index and the
  // loser answers the same refusal — instead of a unique-violation 500
  // that aborts the caller's transaction. Hub folders (no project) carry
  // no index and insert as before.
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.folders (
      org_id, name, parent_id, team_id, team_tags, project_id, created_by,
      created_at_ms
    ) VALUES (
      ${auth.organizationId}, ${name}, ${args.parentId ?? null},
      ${mirror.teamId}, ${effectiveTeamIds},
      ${effectiveProjectId}, ${auth.userId}, ${Date.now()}
    )
    ON CONFLICT (org_id, project_id, (coalesce(parent_id, '')), (lower(name)))
      WHERE project_id IS NOT NULL
      DO NOTHING
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) {
    if (effectiveProjectId) throw nameTaken();
    throw new Error('FOLDER_CREATE_FAILED: the insert answered no row');
  }
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'folder',
    entityId: id,
  });
  return id;
}

export async function assertFolderMutable(
  tx: TransactionSql | Sql,
  auth: ProjectAuthContext,
  folder: FolderRow,
): Promise<void> {
  if (folder.organizationId !== auth.organizationId) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  if (folder.projectId) {
    await assertProjectFolderWrite(tx, auth, folder.projectId);
    return;
  }
  if (!canSeeAudience({ teamIds: folder.teamTags }, auth)) {
    throw new FolderError(
      'FOLDER_NOT_ACCESSIBLE',
      'Folder not accessible',
      403,
    );
  }
}

/**
 * The hub folder a Knowledge import lands in. An import writes hub
 * documents, so a project folder is not a destination for one however much
 * project access the caller has; beyond that it is the ordinary write gate,
 * which is what keeps someone from filing files into a team folder they
 * cannot open. The row comes back so the caller can adopt its team, the
 * same way an upload does.
 */
export async function loadHubImportDestination(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  folderId: string,
): Promise<FolderRow> {
  const folder = await loadFolderOrThrow(sql, folderId);
  if (
    folder.organizationId !== auth.organizationId ||
    folder.projectId !== null
  ) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  await assertFolderMutable(sql, auth, folder);
  return folder;
}

export async function renameFolder(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  folderId: string,
  name: string,
): Promise<void> {
  const folder = await loadFolderOrThrow(tx, folderId);
  await assertFolderMutable(tx, auth, folder);
  const trimmed = validateFolderName(name);
  const sibling = await tx<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${auth.organizationId}
      AND parent_id IS NOT DISTINCT FROM ${folder.parentId}
      AND project_id IS NOT DISTINCT FROM ${folder.projectId}
      AND lower(name) = ${trimmed.toLowerCase()}
      AND id <> ${folderId}
    LIMIT 1
  `;
  if (sibling.length > 0) {
    throw nameTaken();
  }
  try {
    await tx`UPDATE app.folders SET name = ${trimmed} WHERE id = ${folderId}`;
  } catch (error) {
    if (isSiblingNameRace(error)) throw nameTaken();
    throw error;
  }
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'folder',
    entityId: folderId,
  });
}

/** Hub folders visible to the caller, or one project's folders. */
export async function listFolders(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { projectId?: string; parentId?: string | null },
): Promise<FolderRow[]> {
  if (args.projectId) {
    const project = await loadProjectOrThrow(sql, args.projectId);
    const access = checkProjectAccess(project, auth.teamIds, auth.role);
    if (!access.canRead) {
      throw new FolderError('PROJECT_FORBIDDEN', 'No project access', 403);
    }
    return sql<FolderRow[]>`
      SELECT ${sql.unsafe(FOLDER_COLUMNS)} FROM app.folders
      WHERE org_id = ${auth.organizationId}
        AND project_id = ${args.projectId}
        AND (${args.parentId === undefined}
          OR parent_id IS NOT DISTINCT FROM ${args.parentId ?? null})
      ORDER BY name ASC
    `;
  }
  const rows = await sql<FolderRow[]>`
    SELECT ${sql.unsafe(FOLDER_COLUMNS)} FROM app.folders
    WHERE org_id = ${auth.organizationId}
      AND project_id IS NULL
      AND (${args.parentId === undefined}
        OR parent_id IS NOT DISTINCT FROM ${args.parentId ?? null})
      AND ${audienceClause(sql, 'team_tags', auth)}
    ORDER BY name ASC
  `;
  return rows;
}

/** Root-to-leaf breadcrumb for one folder (access-checked at the leaf). */
export async function getFolderBreadcrumb(
  sql: Sql,
  auth: ProjectAuthContext,
  folderId: string,
): Promise<FolderRow[]> {
  const leaf = await loadFolderOrThrow(sql, folderId);
  await assertFolderMutableReadOnly(sql, auth, leaf);
  const rows = await sql<FolderRow[]>`
    WITH RECURSIVE chain AS (
      SELECT f.*, 1 AS depth FROM app.folders f WHERE f.id = ${folderId}
      UNION ALL
      SELECT f.*, chain.depth + 1
      FROM app.folders f JOIN chain ON f.id = chain.parent_id
      WHERE chain.depth < ${MAX_FOLDER_DEPTH + 2}
    )
    SELECT id, org_id AS "organizationId", name, parent_id AS "parentId",
           team_id AS "teamId", team_tags AS "teamTags",
           project_id AS "projectId", created_by AS "createdBy",
           created_at_ms::float8 AS "createdAt"
    FROM chain ORDER BY depth DESC
  `;
  return rows;
}

async function assertFolderMutableReadOnly(
  sql: Sql,
  auth: ProjectAuthContext,
  folder: FolderRow,
): Promise<void> {
  if (folder.organizationId !== auth.organizationId) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  if (folder.projectId) {
    const project = await loadProjectOrThrow(sql, folder.projectId);
    const access = checkProjectAccess(project, auth.teamIds, auth.role);
    if (!access.canRead) {
      throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
    return;
  }
  if (!canSeeAudience({ teamIds: folder.teamTags }, auth)) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
}

/**
 * GET-OR-CREATE a project folder — the REST door's idempotent prepare step:
 * a sibling of the same name under the same parent, compared the way the
 * sibling rule compares (case-folded — `createFolder` refuses `INBOX`
 * beside `inbox`, so the match must fold too or a worker whose naming
 * convention changed case could never converge), answers the existing
 * folder with its STORED spelling (`created: false`); otherwise the folder
 * is created through the same validated `createFolder` the session surface
 * uses.
 */
export async function getOrCreateProjectFolder(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { projectId: string; name: string; parentId?: string },
): Promise<{ folderId: string; name: string; created: boolean }> {
  const name = validateFolderName(args.name);
  await assertProjectFolderWrite(tx, auth, args.projectId);
  if (args.parentId !== undefined) {
    const parent = await loadFolderOrThrow(tx, args.parentId);
    if (
      parent.organizationId !== auth.organizationId ||
      parent.projectId !== args.projectId
    ) {
      throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
  }
  const findSibling = async (): Promise<
    { id: string; name: string } | undefined
  > => {
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM app.folders
      WHERE org_id = ${auth.organizationId}
        AND project_id = ${args.projectId}
        AND parent_id IS NOT DISTINCT FROM ${args.parentId ?? null}
        AND lower(name) = ${name.toLowerCase()}
      LIMIT 1
    `;
    return rows[0];
  };
  const found = await findSibling();
  if (found !== undefined) {
    return { folderId: found.id, name: found.name, created: false };
  }
  try {
    const folderId = await createFolder(tx, auth, {
      name,
      projectId: args.projectId,
      ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
    });
    return { folderId, name, created: true };
  } catch (error) {
    // Two writers can pass the lookup above before either commits (the
    // project-text panel saving twice, two syncs filing into one folder);
    // the create's own sibling check — or the sibling index its insert
    // arbitrates on — then sees the winner's row and refuses with
    // FOLDER_NAME_TAKEN. The folder this caller asked for exists now — hand
    // it back as "found" instead of failing a save on a name the caller
    // never chose to collide with.
    if (!(error instanceof FolderError) || error.code !== 'FOLDER_NAME_TAKEN') {
      throw error;
    }
    const winner = await findSibling();
    if (winner === undefined) throw error;
    return { folderId: winner.id, name: winner.name, created: false };
  }
}

/** Point-read with 0.4 semantics: null (not 404) on any access failure. */
export async function getFolderView(
  sql: Sql,
  auth: ProjectAuthContext,
  folderId: string,
): Promise<FolderRow | null> {
  const rows = await sql<FolderRow[]>`
    SELECT ${sql.unsafe(FOLDER_COLUMNS)} FROM app.folders
    WHERE id = ${folderId} LIMIT 1
  `;
  const folder = rows[0];
  if (!folder || folder.organizationId !== auth.organizationId) {
    return null;
  }
  if (folder.projectId !== null) {
    const project = await loadProjectOrThrow(sql, folder.projectId);
    const access = checkProjectAccess(project, auth.teamIds, auth.role);
    return access.canRead ? folder : null;
  }
  return canSeeAudience({ teamIds: folder.teamTags }, auth) ? folder : null;
}

export interface FolderTeamCascadeTouchedDoc {
  id: string;
  fileRef: string | null;
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
}

/**
 * Re-team a hub folder and cascade the new scope to every descendant folder
 * and document (0.4 `updateFolderTeams`). Returns the file-backed documents
 * the cascade rewrote so the caller can re-stamp their corpus scope rows
 * post-commit (retrieval filters on them; scope-only, no re-embed).
 */
export async function updateFolderTeams(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { folderId: string; teamIds: string[] },
): Promise<FolderTeamCascadeTouchedDoc[]> {
  const folder = await loadFolderOrThrow(tx, args.folderId);
  if (folder.organizationId !== auth.organizationId) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
  // Team assignment is a hub concept — a project folder never carries teams.
  if (folder.projectId !== null) {
    throw new FolderError(
      'FOLDER_SCOPE_CONFLICT',
      'A project folder cannot be assigned to teams',
    );
  }
  if (folder.parentId !== null) {
    const parent = await loadFolderOrThrow(tx, folder.parentId);
    if (parent.teamTags.length > 0) {
      throw new FolderError(
        'FOLDER_TEAM_INHERITED',
        'Cannot change team: inherited from parent folder',
      );
    }
  }
  if (!canSeeAudience({ teamIds: folder.teamTags }, auth)) {
    throw new FolderError('FOLDER_ACCESS_DENIED', 'Access denied', 403);
  }
  const teamTags = await assignableTeams(tx, auth, args.teamIds);
  const { teamId } = audienceMirror(teamTags);
  await tx`
    WITH RECURSIVE subtree AS (
      SELECT id FROM app.folders
      WHERE id = ${args.folderId} AND org_id = ${auth.organizationId}
      UNION ALL
      SELECT f.id FROM app.folders f
      JOIN subtree s ON f.parent_id = s.id
      WHERE f.org_id = ${auth.organizationId}
    )
    UPDATE app.folders SET team_id = ${teamId}, team_tags = ${teamTags}
    WHERE id IN (SELECT id FROM subtree)
  `;
  const touched = await tx<FolderTeamCascadeTouchedDoc[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM app.folders
      WHERE id = ${args.folderId} AND org_id = ${auth.organizationId}
      UNION ALL
      SELECT f.id FROM app.folders f
      JOIN subtree s ON f.parent_id = s.id
      WHERE f.org_id = ${auth.organizationId}
    )
    UPDATE app.documents SET team_id = ${teamId}, team_tags = ${teamTags},
      updated_at_ms = ${Date.now()}
    WHERE org_id = ${auth.organizationId}
      AND folder_id IN (SELECT id FROM subtree)
    RETURNING id, file_ref AS "fileRef", team_id AS "teamId",
      team_tags AS "teamTags", project_id AS "projectId"
  `;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'folder',
    entityId: args.folderId,
  });
  if (touched.length > 0) {
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'document',
      entityId: args.folderId,
    });
  }
  return touched.filter((doc) => doc.fileRef !== null);
}
