import type { Sql, TransactionSql } from 'postgres';

/**
 * Hub folder-path plumbing shared by the sync engines (OneDrive today,
 * Google Drive next) — the 0.4 `folders/get_or_create_path.ts`,
 * `find_folder_by_path.ts` and `cleanup_empty_ancestors.ts` twins. Kept
 * apart from `service.ts` (the interactive RBAC surface) so domain services
 * that hook into folder deletion can be imported BY the service without a
 * cycle: paths.ts imports nothing from the folders service.
 *
 * Everything here is hub-exact: auto-vivification and path resolution are
 * Knowledge Hub concepts and must never match — or write into — a project
 * folder that shares (org, parent, name).
 */

export const MAX_FOLDER_DEPTH = 20;
const FOLDER_NAME_MAX = 128;

export class FolderNameError extends Error {
  constructor() {
    super('Invalid folder name');
    this.name = 'FolderNameError';
  }
}

export function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > FOLDER_NAME_MAX ||
    trimmed.includes('/') ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new FolderNameError();
  }
  return trimmed;
}

async function findHubChild(
  db: Sql | TransactionSql,
  organizationId: string,
  parentId: string | undefined,
  name: string,
): Promise<string | undefined> {
  const rows = await db<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${organizationId} AND project_id IS NULL
      AND parent_id IS NOT DISTINCT FROM ${parentId ?? null}
      AND name = ${name}
    LIMIT 1
  `;
  return rows[0]?.id;
}

/**
 * GET-OR-CREATE a hub folder chain for a path. Stops (with a warn) at the
 * first invalid segment rather than throwing — sync callers rely on partial
 * path creation with their own per-item error handling. Throws only on a
 * depth-cap breach (the same cap the interactive create enforces).
 */
export async function getOrCreateHubFolderPath(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    pathSegments: string[];
    createdBy?: string;
    teamId?: string;
  },
): Promise<string | undefined> {
  const segments = args.pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.length > MAX_FOLDER_DEPTH) {
    throw new Error(
      `Folder path exceeds the depth cap (${MAX_FOLDER_DEPTH}): ${segments.join('/')}`,
    );
  }

  let parentId: string | undefined;
  for (const segment of segments) {
    let validName: string;
    try {
      validName = validateFolderName(segment);
    } catch (error) {
      if (!(error instanceof FolderNameError)) throw error;
      console.warn(
        `[folders] getOrCreateHubFolderPath stopped at invalid segment "${segment}" in path [${args.pathSegments.join('/')}]`,
      );
      break;
    }

    const existing = await findHubChild(
      db,
      args.organizationId,
      parentId,
      validName,
    );
    if (existing !== undefined) {
      parentId = existing;
      continue;
    }
    const inserted = await db<{ id: string }[]>`
      INSERT INTO app.folders (
        org_id, name, parent_id, team_id, team_tags, created_by, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${validName}, ${parentId ?? null},
        ${args.teamId ?? null}, ${args.teamId ? [args.teamId] : []},
        ${args.createdBy ?? null}, ${Date.now()}
      )
      RETURNING id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error('Folder insert failed');
    parentId = id;
  }
  return parentId;
}

/** Resolve a hub folder by its path; null when any segment is missing. */
export async function findHubFolderByPath(
  db: Sql | TransactionSql,
  organizationId: string,
  pathSegments: string[],
): Promise<string | null> {
  const segments = pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) return null;

  let parentId: string | undefined;
  for (const segment of segments) {
    let validName: string;
    try {
      validName = validateFolderName(segment);
    } catch (error) {
      if (!(error instanceof FolderNameError)) throw error;
      return null;
    }
    const existing = await findHubChild(
      db,
      organizationId,
      parentId,
      validName,
    );
    if (existing === undefined) return null;
    parentId = existing;
  }
  return parentId ?? null;
}

/**
 * Walk up from `startFolderId` and delete folders with no remaining
 * documents and no child folders, stopping at (and never deleting)
 * `stopAtFolderId` — the sync-reconcile reap for a subtree emptied by a
 * prune. Aborts safely (warn, no delete) when the walk would escape the
 * sync subtree: an org mismatch, or reaching the hub root without hitting
 * the stop boundary.
 */
export async function reapEmptyAncestorFolders(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    startFolderId: string;
    stopAtFolderId: string;
  },
): Promise<void> {
  let currentId: string | undefined = args.startFolderId;
  let depth = 0;

  while (currentId !== undefined && depth < MAX_FOLDER_DEPTH) {
    if (currentId === args.stopAtFolderId) return;

    const rows: { organizationId: string; parentId: string | null }[] =
      await db<{ organizationId: string; parentId: string | null }[]>`
      SELECT org_id AS "organizationId", parent_id AS "parentId"
      FROM app.folders WHERE id = ${currentId} LIMIT 1
    `;
    const folder:
      | { organizationId: string; parentId: string | null }
      | undefined = rows[0];
    if (!folder) return;
    if (folder.organizationId !== args.organizationId) {
      console.warn(
        `[folders] reapEmptyAncestorFolders org mismatch at ${currentId}; aborting`,
      );
      return;
    }
    if (folder.parentId === null) {
      console.warn(
        `[folders] reapEmptyAncestorFolders reached root ${currentId} without hitting stopAt=${args.stopAtFolderId}; aborting`,
      );
      return;
    }

    const children = await db<{ exists: boolean }[]>`
      SELECT true AS exists FROM app.folders
      WHERE org_id = ${args.organizationId} AND parent_id = ${currentId}
      LIMIT 1
    `;
    if (children.length > 0) return;
    const docs = await db<{ exists: boolean }[]>`
      SELECT true AS exists FROM app.documents
      WHERE org_id = ${args.organizationId} AND folder_id = ${currentId}
      LIMIT 1
    `;
    if (docs.length > 0) return;

    await db`DELETE FROM app.folders WHERE id = ${currentId}`;
    currentId = folder.parentId;
    depth++;
  }

  if (
    depth >= MAX_FOLDER_DEPTH &&
    currentId !== undefined &&
    currentId !== args.stopAtFolderId
  ) {
    console.warn(
      `[folders] reapEmptyAncestorFolders depth cap hit before stopAt=${args.stopAtFolderId}; remaining=${currentId}`,
    );
  }
}

/** Root-to-leaf hub path (segment names) for a folder id; used to match
 *  sync-config `item_path` values when a hub folder is deleted. */
export async function buildHubFolderPath(
  db: Sql | TransactionSql,
  organizationId: string,
  folderId: string,
): Promise<string | null> {
  const rows = await db<{ name: string; projectId: string | null }[]>`
    WITH RECURSIVE chain AS (
      SELECT f.id, f.name, f.parent_id, f.project_id, 1 AS depth
      FROM app.folders f
      WHERE f.id = ${folderId} AND f.org_id = ${organizationId}
      UNION ALL
      SELECT f.id, f.name, f.parent_id, f.project_id, chain.depth + 1
      FROM app.folders f JOIN chain ON f.id = chain.parent_id
      WHERE chain.depth < ${MAX_FOLDER_DEPTH + 2}
    )
    SELECT name, project_id AS "projectId" FROM chain ORDER BY depth DESC
  `;
  if (rows.length === 0 || rows.some((row) => row.projectId !== null)) {
    return null;
  }
  return rows.map((row) => row.name).join('/');
}
