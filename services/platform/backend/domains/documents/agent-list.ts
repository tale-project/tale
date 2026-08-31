import type { Sql } from 'postgres';

import { MAX_FOLDER_DEPTH } from '../folders/paths.ts';

/**
 * The agent-facing document listing — ONE helper behind two doors (the 0.4
 * `listDocumentsForAgent` contract): the chat/user door resolves the caller's
 * knowledge scope and validates `projectId` before calling; the binding door
 * passes its pre-resolved scope verbatim. Hub visibility rules live here and
 * nowhere else.
 *
 * `folderPath` prefers the denormalized `documents.folder_path` (connector
 * docs carry their source path) and otherwise derives the breadcrumb from the
 * folder tree in-query — 0.4 walked parents in memory only because Convex
 * cannot join; Postgres does it with one recursive CTE.
 */

export interface AgentDocumentListArgs {
  organizationId: string;
  /** Resolved scope teams (the caller's door already included any
   *  pseudo-team it grants — nothing is added here). */
  teamIds: string[];
  /** An ALREADY-AUTHORIZED project: set → that project's docs; absent → the
   *  hub lane (project docs excluded). */
  projectId?: string;
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
  const projectId = args.projectId ?? null;
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
           coalesce(d.folder_path, fp.path) AS "folderPath",
           d.team_id AS "teamId", d.created_at_ms::float8 AS "createdAt",
           (d.metadata ->> 'size')::float8 AS "sizeBytes"
    FROM app.documents d
    LEFT JOIN folder_paths fp ON fp.id = d.folder_id
    WHERE d.org_id = ${args.organizationId}
      AND d.file_ref IS NOT NULL
      AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
      AND (${args.fileName === undefined} OR d.title ILIKE ${like})
      AND (${args.extension === undefined}
        OR d.extension = ${args.extension ?? ''})
      AND (
        (${projectId}::text IS NOT NULL AND d.project_id = ${projectId})
        OR (${projectId}::text IS NULL AND d.project_id IS NULL AND (
          (d.team_id IS NULL AND cardinality(d.team_tags) = 0)
          OR d.team_id = ANY(${args.teamIds})
          OR d.team_tags && ${args.teamIds}
        ))
      )
    ORDER BY d.created_at_ms DESC, d.id
    LIMIT ${limit + 1} OFFSET ${offset}
  `;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    documents: page.map((row) => ({
      fileId: row.fileId,
      title: row.title ?? 'Untitled',
      extension: row.extension,
      folderPath: row.folderPath,
      teamId: row.teamId,
      createdAt: row.createdAt,
      sizeBytes: row.sizeBytes,
    })),
    totalCount: null,
    hasMore,
    cursor: hasMore ? offset + limit : null,
    warning: null,
  };
}
