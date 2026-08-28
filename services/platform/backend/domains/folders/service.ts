import type { Sql, TransactionSql } from 'postgres';

import { hasTeamAccess } from '../../../convex/lib/team_access.ts';
import { checkProjectAccess } from '../../../convex/projects/access.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';

/**
 * Folders — the Document Hub tree. Scope rule (one owner, mirrored from
 * `convex/folders`): a folder is EITHER a project folder (project_id set,
 * access = the project matrix) OR a hub folder (team rules; teamless =
 * org-wide). Children inherit the parent's scope; depth is capped.
 *
 * Ledger: legal-hold / controlled-record delete guards and sync-config
 * deactivation land with governance/documents-lifecycle; until the document
 * trash lane lands, deleting a folder REFUSES when any document lives in its
 * subtree (conservative — never destroys content).
 */

export const MAX_FOLDER_DEPTH = 20;
const FOLDER_NAME_MAX = 128;

export class FolderError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'FolderError';
    this.code = code;
    this.status = status;
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

function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > FOLDER_NAME_MAX ||
    trimmed.includes('/') ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new FolderError('FOLDER_NAME_INVALID', 'Invalid folder name');
  }
  return trimmed;
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

async function assertProjectFolderWrite(
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

export async function createFolder(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    name: string;
    parentId?: string;
    teamId?: string;
    projectId?: string;
  },
): Promise<string> {
  const name = validateFolderName(args.name);
  if (args.projectId && args.teamId) {
    throw new FolderError(
      'FOLDER_SCOPE_CONFLICT',
      'A project folder cannot also carry a team',
    );
  }

  let effectiveTeamId = args.teamId ?? null;
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
    if (parent.projectId === null) {
      if (
        (parent.teamId || parent.teamTags.length > 0) &&
        !hasTeamAccess(
          { teamId: parent.teamId ?? undefined, teamTags: parent.teamTags },
          auth.teamIds,
        )
      ) {
        throw new FolderError(
          'FOLDER_PARENT_NOT_ACCESSIBLE',
          'Parent folder not accessible',
          403,
        );
      }
      if (parent.teamId) {
        effectiveTeamId = parent.teamId;
      }
    }
    if ((await folderDepth(tx, args.parentId)) >= MAX_FOLDER_DEPTH) {
      throw new FolderError('FOLDER_DEPTH_EXCEEDED', 'Folder tree too deep');
    }
  }

  if (effectiveProjectId) {
    effectiveTeamId = null;
    await assertProjectFolderWrite(tx, auth, effectiveProjectId);
  }

  const sibling = await tx<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${auth.organizationId}
      AND parent_id IS NOT DISTINCT FROM ${args.parentId ?? null}
      AND project_id IS NOT DISTINCT FROM ${effectiveProjectId}
      AND lower(name) = ${name.toLowerCase()}
    LIMIT 1
  `;
  if (sibling.length > 0) {
    throw new FolderError('FOLDER_NAME_TAKEN', 'Folder name taken');
  }

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.folders (
      org_id, name, parent_id, team_id, team_tags, project_id, created_by,
      created_at_ms
    ) VALUES (
      ${auth.organizationId}, ${name}, ${args.parentId ?? null},
      ${effectiveTeamId}, ${effectiveTeamId ? [effectiveTeamId] : []},
      ${effectiveProjectId}, ${auth.userId}, ${Date.now()}
    )
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) {
    throw new FolderError('FOLDER_CREATE_FAILED', 'Insert failed');
  }
  return id;
}

async function assertFolderMutable(
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
  if (
    (folder.teamId || folder.teamTags.length > 0) &&
    !hasTeamAccess(
      { teamId: folder.teamId ?? undefined, teamTags: folder.teamTags },
      auth.teamIds,
    )
  ) {
    throw new FolderError(
      'FOLDER_NOT_ACCESSIBLE',
      'Folder not accessible',
      403,
    );
  }
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
    throw new FolderError('FOLDER_NAME_TAKEN', 'Folder name taken');
  }
  await tx`UPDATE app.folders SET name = ${trimmed} WHERE id = ${folderId}`;
}

/**
 * Delete a folder subtree. Conservative Tier-A rule: refuses while ANY
 * document lives in the subtree (`FOLDER_NOT_EMPTY`) — the trash-cascade
 * arrives with the documents lifecycle port. Child folders die by FK.
 * TODO(governance): legal-hold + controlled-record descendant guards;
 * TODO(onedrive/google_drive): sync-config deactivation for the path.
 */
export async function deleteFolder(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  folderId: string,
): Promise<void> {
  const folder = await loadFolderOrThrow(tx, folderId);
  await assertFolderMutable(tx, auth, folder);
  const docs = await tx<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM app.folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id FROM app.folders f JOIN subtree s ON f.parent_id = s.id
    )
    SELECT d.id FROM app.documents d
    WHERE d.folder_id IN (SELECT id FROM subtree)
    LIMIT 1
  `;
  if (docs.length > 0) {
    throw new FolderError(
      'FOLDER_NOT_EMPTY',
      'Folder still contains documents',
    );
  }
  await tx`DELETE FROM app.folders WHERE id = ${folderId}`;
}

/** Hub folders visible to the caller, or one project's folders. */
export async function listFolders(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { projectId?: string; parentId?: string | null },
): Promise<FolderRow[]> {
  if (args.projectId) {
    const project = await loadProjectOrThrow(sql, args.projectId);
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
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
    ORDER BY name ASC
  `;
  return rows.filter((folder) =>
    hasTeamAccess(
      { teamId: folder.teamId ?? undefined, teamTags: folder.teamTags },
      auth.teamIds,
    ),
  );
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
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
    if (!access.canRead) {
      throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
    return;
  }
  if (
    (folder.teamId || folder.teamTags.length > 0) &&
    !hasTeamAccess(
      { teamId: folder.teamId ?? undefined, teamTags: folder.teamTags },
      auth.teamIds,
    )
  ) {
    throw new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404);
  }
}
