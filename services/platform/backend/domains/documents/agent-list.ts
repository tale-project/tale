import type { Sql, TransactionSql } from 'postgres';

import { safePathSegment } from '../../core/lib/safe_path_segment.ts';
import {
  indexingStateFrom,
  type DocumentIndexingState,
} from '../file_metadata/indexing-state.ts';
import {
  findHubFolderByPath,
  MAX_FOLDER_DEPTH,
  normalizeFolderPath,
} from '../folders/paths.ts';

/**
 * The agent-facing document listing — ONE helper behind two doors (the 0.4
 * `listDocumentsForAgent` contract): the chat/user door resolves the caller's
 * knowledge scope and validates `projectId` before calling; the binding door
 * passes its pre-resolved scope verbatim. Hub visibility rules live here and
 * nowhere else. A project chat lists its project's files AND the hub in one
 * page (`includeHub`), project rows first; each row says which lane it came
 * from and where its blob stands in the search corpus.
 *
 * `folderPath` is the folder tree's breadcrumb when the document sits in a
 * folder (fresh across renames — the denormalized `documents.folder_path` a
 * connector stamped is not), else that stamped source path; spelled the
 * canonical way (`normalizeFolderPath`) so an agent can hand it straight
 * back as a knowledge-search `folder` filter. 0.4 walked parents in memory
 * only because Convex cannot join; Postgres does it with one recursive CTE.
 */

export interface AgentDocumentListArgs {
  organizationId: string;
  /** Resolved scope teams (the caller's door already included any
   *  pseudo-team it grants — nothing is added here). */
  teamIds: string[];
  /** An ALREADY-AUTHORIZED project: set → that project's docs; absent → the
   *  hub lane (project docs excluded). */
  projectId?: string;
  /** Several ALREADY-AUTHORIZED projects — the binding door's shape for an
   *  org-wide run of a multi-bound automation (its bound projects). Non-empty
   *  → those projects' docs; takes precedence over `projectId`. */
  projectIds?: string[];
  /** With a project lane: ALSO list the hub lane in the same page (project
   *  rows first, then the hub rows the caller's teams may see) — a project
   *  chat's view, where the project's files sit beside the organization's
   *  shared knowledge. Without a project lane it changes nothing: the hub
   *  lane is what a project-less listing already is. */
  includeHub?: boolean;
  /** Substring match on the title, case-insensitive. */
  fileName?: string;
  /** Exact match; stored lowercased without the dot (e.g. `pdf`). */
  extension?: string;
  limit?: number;
  cursor?: number;
}

export interface AgentDocumentItem {
  fileId: string;
  title: string;
  extension: string | null;
  folderPath: string | null;
  teamId: string | null;
  createdAt: number;
  sizeBytes: number | null;
  /** The project the file lives in — null for a hub row. Carried so a page
   *  that mixes the two lanes says which is which. */
  projectId: string | null;
  projectName: string | null;
  /** Where the blob stands in the search corpus (`indexingStateFrom`), or
   *  null for a blob no file row tracks. A row that is not `completed` is
   *  listed but not searchable — the agent must not infer "unreadable" from
   *  an empty search, and a text-like file is still readable on demand. */
  indexing: DocumentIndexingState | null;
}

export interface AgentDocumentPage {
  documents: AgentDocumentItem[];
  totalCount: null;
  hasMore: boolean;
  cursor: number | null;
  warning: null;
}

export async function listDocumentsForAgent(
  sql: Sql,
  args: AgentDocumentListArgs,
): Promise<AgentDocumentPage> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const offset = Math.max(0, args.cursor ?? 0);
  // The project lane is a SET: the chat door's one validated project, or the
  // binding door's bound projects. Empty → the hub lane.
  const projectIds =
    args.projectIds !== undefined && args.projectIds.length > 0
      ? args.projectIds
      : args.projectId !== undefined
        ? [args.projectId]
        : [];
  const projectLane = projectIds.length > 0;
  // The hub lane runs alone for a project-less listing, and beside the
  // project lane when the caller asks for the union (a project chat).
  const hubLane = !projectLane || args.includeHub === true;
  const like = `%${args.fileName?.trim() ?? ''}%`;
  const rows = await sql<
    {
      fileId: string;
      title: string | null;
      extension: string | null;
      folderPath: string | null;
      teamId: string | null;
      createdAt: number;
      sizeBytes: number | null;
      projectId: string | null;
      projectName: string | null;
      skipRagIndexing: boolean | null;
      ragStatus: string | null;
      ragError: string | null;
      ragErrorCode: string | null;
      hasFileRow: boolean;
    }[]
  >`
    WITH RECURSIVE folder_paths AS (
      SELECT id, name AS path, 1 AS depth
      FROM app.folders
      WHERE org_id = ${args.organizationId} AND parent_id IS NULL
      UNION ALL
      SELECT f.id, fp.path || '/' || f.name, fp.depth + 1
      FROM app.folders f
      JOIN folder_paths fp ON f.parent_id = fp.id
      WHERE f.org_id = ${args.organizationId}
        AND fp.depth < ${MAX_FOLDER_DEPTH + 2}
    )
    SELECT d.file_ref AS "fileId", d.title, d.extension,
           coalesce(fp.path, d.folder_path) AS "folderPath",
           d.team_id AS "teamId", d.created_at_ms::float8 AS "createdAt",
           (d.metadata ->> 'size')::float8 AS "sizeBytes",
           d.project_id AS "projectId", p.name AS "projectName",
           fm.skip_rag_indexing AS "skipRagIndexing",
           fm.rag_status AS "ragStatus", fm.rag_error AS "ragError",
           fm.rag_error_code AS "ragErrorCode",
           (fm.storage_ref IS NOT NULL) AS "hasFileRow"
    FROM app.documents d
    LEFT JOIN folder_paths fp ON fp.id = d.folder_id
    LEFT JOIN app.projects p ON p.id = d.project_id
    LEFT JOIN LATERAL (
      SELECT storage_ref, skip_rag_indexing, rag_status, rag_error,
             rag_error_code
      FROM app.file_metadata
      WHERE org_id = d.org_id AND storage_ref = d.file_ref
      ORDER BY created_at_ms ASC
      LIMIT 1
    ) fm ON TRUE
    WHERE d.org_id = ${args.organizationId}
      AND d.file_ref IS NOT NULL
      AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
      AND (${args.fileName === undefined} OR d.title ILIKE ${like})
      AND (${args.extension === undefined}
        OR d.extension = ${args.extension ?? ''})
      AND (
        (${projectLane} AND d.project_id = ANY(${projectIds}))
        OR (${hubLane} AND d.project_id IS NULL AND (
          (d.team_id IS NULL AND cardinality(d.team_tags) = 0)
          OR d.team_id = ANY(${args.teamIds})
          OR d.team_tags && ${args.teamIds}
        ))
      )
    ORDER BY (d.project_id IS NULL), d.created_at_ms DESC, d.id
    LIMIT ${limit + 1} OFFSET ${offset}
  `;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    documents: page.map((row) => ({
      fileId: row.fileId,
      title: row.title ?? 'Untitled',
      extension: row.extension,
      folderPath: normalizeFolderPath(row.folderPath),
      teamId: row.teamId,
      createdAt: row.createdAt,
      sizeBytes: row.sizeBytes,
      projectId: row.projectId,
      projectName: row.projectName,
      indexing: row.hasFileRow ? indexingStateFrom(row) : null,
    })),
    totalCount: null,
    hasMore,
    cursor: hasMore ? offset + limit : null,
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// Folder listing for staging (the 0.4 `listFilesByFolderInternal` contract)
// ---------------------------------------------------------------------------

export interface FolderFile {
  /** The blob ref (`documents.file_ref`) — what the stager fetches. */
  fileId: string;
  /** Mount-relative path: subfolder segments + the safe leaf name. */
  name: string;
}

/**
 * A folder listing plus the fact every consumer must respect: whether a cap
 * cut the walk short. Staging fails the turn on `truncated` (a run must
 * never quietly proceed on partial inputs) — a complete-LOOKING partial
 * array is the defect class that once made runs read as "produced nothing".
 */
export interface FolderFileListing {
  files: FolderFile[];
  truncated: boolean;
}

// Walk guards: a client's delivery tree is a handful of levels with at most a
// few hundred documents — these bounds exist so a pathological tree can never
// wedge a query. Hitting one marks the listing `truncated`, never a silent
// partial. Depth mirrors the write-side ancestry cap MAX_FOLDER_DEPTH so every
// legally creatable tree lists completely; the depth bound (not a visited
// set) is what terminates the walk over a `parent_id` cycle in corrupt data.
const MAX_RECURSION_DEPTH = MAX_FOLDER_DEPTH;
export const MAX_RECURSIVE_FILES = 500;

/**
 * Files inside one folder, addressed by id (any folder of the organization,
 * hub or project — the reference is data from the run's own scope) or by its
 * human-readable hub path ("Clients/Acme GmbH"). By default only DIRECT
 * children are listed; `recursive: true` walks the subfolder tree and
 * prefixes each file's `name` with its subfolder path
 * ("Documentation/Invoice 123.pdf") — the stager creates the subdirectories
 * from that relative path, so a client's delivered folder structure survives
 * into the workspace. Only rows with a stored blob are returned — a folder
 * input stages file bytes, so a text-only document has nothing to stage.
 * `name` is the title with the stored extension re-attached when the title
 * lacks it, flattened to a single path segment per level: folder names are
 * validated at write time, but document titles are free text, and a title
 * like `../../output/x` staged verbatim would escape its mount inside the
 * sandbox. Returns null when the folder does not resolve within
 * `organizationId` (callers surface that as a legible failure instead of a
 * silently empty directory).
 */
export async function listFilesByFolder(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    folderId?: string;
    folderPath?: string;
    recursive?: boolean;
  },
): Promise<FolderFileListing | null> {
  let folderId: string | null = args.folderId ?? null;
  if (folderId === null && args.folderPath !== undefined) {
    folderId = await findHubFolderByPath(
      sql,
      args.organizationId,
      args.folderPath.split('/'),
    );
  }
  if (folderId === null || folderId === '') return null;
  // Coherence for the id path: a folder from another org resolves to null.
  const folder = await sql<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE id = ${folderId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  if (folder.length === 0) return null;
  const recursive = args.recursive === true;
  // The subtree walk is one recursive CTE bounded one level PAST the cap:
  // a folder at depth cap+1 proves deeper subfolders exist, which marks the
  // listing truncated (their files are never listed, by the same bound).
  const rows = await sql<
    {
      fileId: string;
      title: string | null;
      extension: string | null;
      prefix: string;
      depth: number;
    }[]
  >`
    WITH RECURSIVE subtree AS (
      SELECT f.id, ''::text AS prefix, 0 AS depth
      FROM app.folders f
      WHERE f.org_id = ${args.organizationId} AND f.id = ${folderId}
      UNION ALL
      SELECT f.id, s.prefix || f.name || '/', s.depth + 1
      FROM app.folders f
      JOIN subtree s ON f.parent_id = s.id
      WHERE f.org_id = ${args.organizationId}
        AND ${recursive}
        AND s.depth <= ${MAX_RECURSION_DEPTH}
    )
    SELECT d.file_ref AS "fileId", d.title, d.extension, s.prefix, s.depth
    FROM app.documents d
    JOIN subtree s ON s.id = d.folder_id
    WHERE d.org_id = ${args.organizationId}
      AND d.file_ref IS NOT NULL
      AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
      AND s.depth <= ${MAX_RECURSION_DEPTH}
    ORDER BY s.depth, s.prefix, d.title, d.id
    LIMIT ${MAX_RECURSIVE_FILES + 1}
  `;
  let truncated = rows.length > MAX_RECURSIVE_FILES;
  if (truncated) {
    console.warn(
      `[listFilesByFolder] truncated at ${MAX_RECURSIVE_FILES} files under folder ${folderId} — the listing is INCOMPLETE`,
    );
  } else if (recursive) {
    const deeper = await sql<{ deeper: boolean }[]>`
      WITH RECURSIVE subtree AS (
        SELECT f.id, 0 AS depth
        FROM app.folders f
        WHERE f.org_id = ${args.organizationId} AND f.id = ${folderId}
        UNION ALL
        SELECT f.id, s.depth + 1
        FROM app.folders f
        JOIN subtree s ON f.parent_id = s.id
        WHERE f.org_id = ${args.organizationId}
          AND s.depth <= ${MAX_RECURSION_DEPTH}
      )
      SELECT EXISTS (
        SELECT 1 FROM subtree WHERE depth > ${MAX_RECURSION_DEPTH}
      ) AS deeper
    `;
    if (deeper[0]?.deeper) {
      console.warn(
        `[listFilesByFolder] depth cap ${MAX_RECURSION_DEPTH} reached under folder ${folderId} — deeper subfolders were NOT listed`,
      );
      truncated = true;
    }
  }
  const files = rows.slice(0, MAX_RECURSIVE_FILES).map((row) => {
    const title = row.title ?? row.fileId;
    const ext = row.extension;
    const withExt =
      ext !== null &&
      ext !== '' &&
      !title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? `${title}.${ext}`
        : title;
    // The prefix is built from write-validated folder names; the leaf is
    // free text and must never add or climb a path level.
    return {
      fileId: row.fileId,
      name: `${row.prefix}${safePathSegment(withExt)}`,
    };
  });
  return { files, truncated };
}
