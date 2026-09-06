import type { Sql } from 'postgres';

import { ConnectorError } from '../../../lib/connectors/errors.ts';
import type {
  WorkflowDocumentStore,
  WorkflowFolderFile,
} from '../../../lib/connectors/natives/index.ts';
import { extractExtension } from '../../../lib/shared/file-types.ts';
import {
  linkAgentDocumentFile,
  storeAgentTextBlob,
  upsertAgentDocument,
} from '../documents/agent-write.ts';
import { listFolderDocumentsBounded } from '../documents/service.ts';
import { getFileMetadataByIdOrRef } from '../files/service.ts';
import { findHubFolderByPath } from '../folders/paths.ts';
import {
  FolderError,
  listFolders,
  loadFolderOrThrow,
  MAX_FOLDER_DEPTH,
  type FolderRow,
} from '../folders/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { collectWorkflowFolderFiles } from './document-listing.ts';

/**
 * The document natives over the 0.5 documents domain — the `document.list`
 * and `document.create` capabilities an automation's nodes reach.
 *
 * Both work on ANY folder of the organization: a Knowledge Hub folder (by id
 * or by human path, "Clients/Acme") and a PROJECT folder (by id — the task
 * subject's `externalId`/`externalUrl` are project folders). The first 0.5
 * cut answered "the folder does not exist" for every project folder and
 * filed created documents through the hub-only door, which dropped the
 * harvested blob (`storageId`) and the idempotency key: a desk automation's
 * deliverables never reached the quarter folder its task is bound to.
 *
 * `create` is the second half of the sandbox harvest contract and keeps the
 * 0.4 semantics (`convex/connectors/platform_stores.ts`): a document always
 * carries a blob (inline `content` is stored first — sandbox staging skips
 * content-only rows); same folder + same name is the SAME document whoever
 * wrote it first (an upload, a seed, an earlier run), refreshed in place; a
 * fresh file is keyed `externalItemId ?? workflow:<folder>:<name>` so a
 * re-run of the node refreshes the artifact instead of duplicating it; the
 * row is stamped `sourceProvider: 'agent'` — the provenance the task's Files
 * and Outcome zones split on — and takes the FOLDER's scope (project or hub
 * team), never a scope the caller names.
 */

/** The most files one `document.list` answers; past it the listing says
 * `truncated` so the agent narrows the folder instead of trusting a cut. */
const WORKFLOW_FOLDER_LIST_CAP = 200;

/** The actor every workflow-filed document names — the task store's own
 * (`task.comment` posts as `workflow`), so the audit trail and the Files
 * zone read the same author for one run's work. */
const WORKFLOW_ACTOR = 'workflow';

const systemAuthFor = async (sql: Sql, organizationId: string) =>
  getProjectAuthContext(sql, {
    organizationId,
    userId: 'system',
    role: 'owner',
  });

/** The folder a native names, in THIS org — null when it does not exist
 * here (a foreign or mistyped id reads as missing, never as forbidden). */
async function resolveOrgFolder(
  sql: Sql,
  organizationId: string,
  folderId: string,
): Promise<FolderRow | null> {
  const folder = await loadFolderOrThrow(sql, folderId).catch(
    (error: unknown) => {
      if (error instanceof FolderError) return null;
      throw error;
    },
  );
  return folder === null || folder.organizationId !== organizationId
    ? null
    : folder;
}

/**
 * The bounded folder walk behind `document.list` — "which files does this
 * folder hold for a run", text-only documents included (they carry their
 * document id as the handle). The folder is named by id (hub or project) or
 * by human hub path; null = it does not exist in this org. The agent/script
 * hosts' `files` mounts are a different contract (blob refs only,
 * path-prefixed names) and list through `documents/agent-list.ts`.
 */
export async function listWorkflowFolderFiles(
  sql: Sql,
  {
    organizationId,
    folderId,
    folderPath,
    recursive,
  }: {
    organizationId: string;
    folderId?: string;
    folderPath?: string;
    recursive?: boolean;
  },
): Promise<{
  files: Array<WorkflowFolderFile & { blobRef: string | null }>;
  truncated: boolean;
} | null> {
  let rootFolderId: string;
  // A project folder's subfolders list under its project; a hub folder's
  // under the hub — the walk must ask for the right family or a project
  // tree reads as flat.
  let projectId: string | null = null;
  if (folderId !== undefined) {
    const folder = await resolveOrgFolder(sql, organizationId, folderId);
    if (folder === null) return null;
    rootFolderId = folder.id;
    projectId = folder.projectId;
  } else if (folderPath !== undefined) {
    const resolved = await findHubFolderByPath(
      sql,
      organizationId,
      folderPath.split('/'),
    );
    if (resolved === null) return null;
    rootFolderId = resolved;
  } else {
    return null;
  }
  const auth = await systemAuthFor(sql, organizationId);
  const walked = await collectWorkflowFolderFiles(
    {
      filesIn: async (id, limit) => {
        const page = await listFolderDocumentsBounded(sql, auth, {
          folderId: id,
          limit,
        });
        return {
          files: page.documents.map((doc) => ({
            name: doc.title ?? doc.id,
            storageId: doc.fileRef ?? doc.id,
            blobRef: doc.fileRef ?? null,
          })),
          truncated: page.truncated,
        };
      },
      subfoldersOf: async (id) =>
        (
          await listFolders(sql, auth, {
            parentId: id,
            ...(projectId !== null ? { projectId } : {}),
          })
        ).map((folder) => ({
          id: folder.id,
          name: folder.name,
        })),
    },
    {
      rootFolderId,
      recursive: recursive ?? false,
      cap: WORKFLOW_FOLDER_LIST_CAP,
      maxDepth: MAX_FOLDER_DEPTH,
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the walk preserves the file shape it was fed, blobRef included
  return walked as {
    files: Array<WorkflowFolderFile & { blobRef: string | null }>;
    truncated: boolean;
  };
}

export function pgDocumentStore(sql: Sql): WorkflowDocumentStore {
  return {
    async listFolder(args) {
      const listing = await listWorkflowFolderFiles(sql, args);
      if (listing === null) return null;
      return {
        files: listing.files.map(({ name, storageId }) => ({
          name,
          storageId,
        })),
        truncated: listing.truncated,
      };
    },
    async create({
      organizationId,
      folderId,
      name,
      storageId,
      content,
      contentType,
      externalItemId,
    }) {
      const folder = await resolveOrgFolder(sql, organizationId, folderId);
      if (folder === null) {
        throw new ConnectorError(
          'INPUT_INVALID',
          `document.create: the folder does not exist (${JSON.stringify({ folderId })})`,
        );
      }
      let fileRef: string;
      let mimeType: string;
      if (storageId !== undefined) {
        // The harvest's blob — a stored file of THIS organization. A ref
        // nothing registered here (or another org's) is refused before any
        // row is written: claiming it would file a document over bytes the
        // org does not own.
        const file = await getFileMetadataByIdOrRef(
          sql,
          organizationId,
          storageId,
        );
        if (file === null) {
          throw new ConnectorError(
            'INPUT_INVALID',
            `document.create: storageId is not a stored file of this organization (${JSON.stringify({ storageId })})`,
          );
        }
        fileRef = file.storageRef;
        mimeType = contentType ?? file.contentType;
      } else {
        // Inline text: store the bytes first — sandbox staging skips
        // content-only rows, so a document must always carry a blob.
        mimeType = contentType ?? 'text/plain';
        const stored = await storeAgentTextBlob(sql, {
          organizationId,
          fileName: name,
          content: content ?? '',
          contentType: mimeType,
          uploadedBy: WORKFLOW_ACTOR,
        });
        fileRef = stored.storageRef;
      }
      const extension = extractExtension(name);
      const upserted = await upsertAgentDocument(sql, {
        organizationId,
        // Idempotent per (folder, name) for fresh files too: a re-run of the
        // same node refreshes the artifact instead of duplicating it.
        externalItemId: externalItemId ?? `workflow:${folderId}:${name}`,
        title: name,
        fileRef,
        mimeType,
        ...(extension !== undefined ? { extension } : {}),
        sourceProvider: 'agent',
        createdBy: WORKFLOW_ACTOR,
        folderId,
        auditActorId: WORKFLOW_ACTOR,
      });
      // Promote the blob to the document as a human upload does — bind the
      // file row and queue indexing — when the bytes are new to the row; a
      // same-blob re-run is already bound and indexed.
      if (upserted.contentChanged) {
        await linkAgentDocumentFile(sql, {
          storageRef: fileRef,
          documentId: upserted.documentId,
        });
      }
      return { documentId: upserted.documentId, action: upserted.action };
    },
  };
}
