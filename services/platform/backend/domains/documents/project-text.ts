import type { Sql } from 'postgres';

import { parseYamlMap } from '../../core/documents/parse_yaml_map.ts';
import { serializeYamlMap } from '../../core/documents/serialize_yaml_map.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { putOrgBlobBytes, registerUploadedBytes } from '../files/service.ts';
import { getOrCreateProjectFolder } from '../folders/service.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { DocumentError } from './service.ts';

/**
 * Project TEXT documents — the settings panel's file lane (the 0.5 twin of
 * 0.4's `documents/public_actions.{ensureProjectTextDocument,
 * readProjectTextValues}`).
 *
 * An automation's FIELD form is backed by one flat-YAML file inside a
 * project folder, so the panel and a manual upload write the SAME artefact:
 * the form pre-fills from whatever is on disk, and a save rewrites it in
 * place. The pair is keyed by `external_item_id`
 * (`project-text:<projectId>:<folder>:<file>`) rather than by title, so
 * renaming or re-uploading the file never forks it into a second document.
 *
 * The YAML parse/serialize pair is REUSED from 0.4 — one dialect, one
 * escaping story, whichever lane wrote the file.
 */

/** The 0.4 bound: a file name, never a path. */
function validateFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (trimmed === '') {
    throw new DocumentError('INVALID_ARGUMENT', 'fileName is required', 400);
  }
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    throw new DocumentError(
      'INVALID_ARGUMENT',
      'fileName cannot contain path separators',
      400,
    );
  }
  if (trimmed.length > 512) {
    throw new DocumentError('INVALID_ARGUMENT', 'fileName is too long', 400);
  }
  return trimmed;
}

function extractExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  if (i <= 0 || i === fileName.length - 1) return 'txt';
  return fileName.slice(i + 1).toLowerCase();
}

function contentTypeFor(extension: string): string {
  return extension === 'yaml' || extension === 'yml'
    ? 'text/yaml'
    : 'text/plain';
}

export function projectTextExternalId(args: {
  projectId: string;
  folderName: string;
  fileName: string;
}): string {
  return `project-text:${args.projectId}:${args.folderName.trim()}:${args.fileName}`;
}

export interface EnsureProjectTextArgs {
  projectId: string;
  folderName: string;
  fileName: string;
  content?: string;
  yaml?: Record<string, string>;
  contentType?: string;
  externalItemId?: string;
}

export interface EnsureProjectTextResult {
  folderId: string;
  documentId: string;
  createdFolder: boolean;
  action: 'created' | 'updated';
}

/**
 * Write (or rewrite) the folder's text file and answer where it landed.
 * Folder creation, blob write and the document upsert share ONE transaction
 * around the row work — a half-written pair would leave the panel reading a
 * file that no document points at.
 */
export async function ensureProjectTextDocument(
  sql: Sql,
  auth: ProjectAuthContext,
  args: EnsureProjectTextArgs,
): Promise<EnsureProjectTextResult> {
  const fileName = validateFileName(args.fileName);
  if (args.content === undefined && args.yaml === undefined) {
    throw new DocumentError(
      'INVALID_ARGUMENT',
      'either content or yaml is required',
      400,
    );
  }
  const body =
    args.content !== undefined
      ? args.content
      : serializeYamlMap(args.yaml ?? {});
  const extension = extractExtension(fileName);
  const contentType = args.contentType ?? contentTypeFor(extension);
  const externalItemId =
    args.externalItemId?.trim() ||
    projectTextExternalId({
      projectId: args.projectId,
      folderName: args.folderName,
      fileName,
    });

  // The blob first: a failed store must not leave a document pointing at
  // nothing (an empty panel is recoverable, a dangling ref is not).
  const storageRef = await putOrgBlobBytes(sql, auth.organizationId, {
    bytes: new TextEncoder().encode(body),
    contentType,
  });
  const { fileId } = await registerUploadedBytes(sql, {
    organizationId: auth.organizationId,
    storageRef,
    fileName,
    contentType,
    size: new TextEncoder().encode(body).byteLength,
    source: 'project_text',
    uploadedBy: auth.userId,
    // The panel's own file is not knowledge: indexing it would answer chat
    // questions with a settings file.
    skipRagIndexing: true,
  });

  return sql.begin(async (tx) => {
    const folder = await getOrCreateProjectFolder(tx, auth, {
      projectId: args.projectId,
      name: args.folderName,
    });
    const now = Date.now();
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM app.documents
      WHERE org_id = ${auth.organizationId}
        AND external_item_id = ${externalItemId}
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      LIMIT 1
      FOR UPDATE
    `;
    if (existing[0]) {
      await tx`
        UPDATE app.documents SET
          title = ${fileName}, file_ref = ${storageRef},
          mime_type = ${contentType}, extension = ${extension},
          folder_id = ${folder.folderId}, project_id = ${args.projectId},
          updated_at_ms = ${now}
        WHERE id = ${existing[0].id}
      `;
      await tx`
        UPDATE app.file_metadata SET document_id = ${existing[0].id}
        WHERE id = ${fileId}
      `;
      return {
        folderId: folder.folderId,
        documentId: existing[0].id,
        createdFolder: folder.created,
        action: 'updated' as const,
      };
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.documents (
        org_id, title, file_ref, mime_type, extension, source_provider,
        external_item_id, project_id, folder_id, created_by, created_at_ms,
        updated_at_ms
      ) VALUES (
        ${auth.organizationId}, ${fileName}, ${storageRef}, ${contentType},
        ${extension}, 'project_text', ${externalItemId}, ${args.projectId},
        ${folder.folderId}, ${auth.userId}, ${now}, ${now}
      ) RETURNING id
    `;
    const documentId = inserted[0]?.id;
    if (documentId === undefined) {
      throw new DocumentError('DOCUMENT_CREATE_FAILED', 'Insert failed');
    }
    await tx`
      UPDATE app.file_metadata SET document_id = ${documentId}
      WHERE id = ${fileId}
    `;
    return {
      folderId: folder.folderId,
      documentId,
      createdFolder: folder.created,
      action: 'created' as const,
    };
  });
}

/**
 * Read the folder's flat-YAML file back into `{key: value}`. Absence in any
 * of its forms — no folder, no file, no blob — is an EMPTY MAP, never an
 * error: a form that cannot find its file falls back to its declared
 * defaults, which is exactly what a first-run panel must do.
 */
export async function readProjectTextValues(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { projectId: string; folderName: string; fileName: string },
): Promise<Record<string, string>> {
  const fileName = validateFileName(args.fileName);
  const rows = await sql<{ fileRef: string | null }[]>`
    SELECT d.file_ref AS "fileRef"
    FROM app.documents d
    JOIN app.folders f ON f.id = d.folder_id
    WHERE d.org_id = ${auth.organizationId}
      AND d.project_id = ${args.projectId}
      AND f.project_id = ${args.projectId}
      AND f.name = ${args.folderName.trim()}
      AND f.parent_id IS NULL
      AND d.title = ${fileName}
      AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
    ORDER BY d.updated_at_ms DESC
    LIMIT 1
  `;
  const fileRef = rows[0]?.fileRef;
  if (fileRef === null || fileRef === undefined || fileRef === '') return {};
  try {
    const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
    if (orgSlug === null) return {};
    const parsed = parseBlobRef(fileRef);
    if (parsed.backend !== 's3') return {};
    const store = await resolveObjectStore(orgSlug);
    const bytes = await s3GetObjectBytes(store, parsed.key);
    return parseYamlMap(new TextDecoder().decode(bytes));
  } catch (error) {
    console.warn(
      `[documents] project text read failed for ${fileName}:`,
      error,
    );
    return {};
  }
}
