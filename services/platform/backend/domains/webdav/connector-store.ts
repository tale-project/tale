import type { Sql } from 'postgres';

import { s3GetObjectBytes } from '../../../convex/lib/storage/object_store.ts';
import {
  WebdavStoreError,
  type WebdavStore,
} from '../../../lib/connectors/natives/index.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { putOrgBlobBytes } from '../files/service.ts';
import { webdavHandlers } from './handlers.ts';

/**
 * The `webdav` CONNECTOR's document store (the agent/automation tool lane) —
 * the same tree the `/dav` protocol surface serves, reached through the same
 * PG handlers so both doors share one set of rules: hub-only visibility,
 * legal holds, controlled records, parent-must-exist, cascade semantics. A
 * refusal is surfaced as the seam's coded {@link WebdavStoreError}, never
 * retried or worked around.
 */

function code(error: unknown): string | undefined {
  if (!(error instanceof AppError)) return undefined;
  const data: unknown = error.data;
  if (data === null || typeof data !== 'object' || !('code' in data)) {
    return undefined;
  }
  const value: unknown = Reflect.get(data, 'code');
  return typeof value === 'string' ? value : undefined;
}

function translate(error: unknown): never {
  const c = code(error);
  if (c === 'LEGAL_HOLD_ACTIVE' || c === 'DOCUMENT_RECORD_PROTECTED') {
    throw new WebdavStoreError(
      'legal-hold',
      'a hold protects the content this operation would destroy',
    );
  }
  if (c === 'CONFLICT') {
    throw new WebdavStoreError(
      'parent-missing',
      'the containing folder does not exist',
    );
  }
  if (c === 'NOT_FOUND') {
    throw new WebdavStoreError('not-found', 'no file or folder at that path');
  }
  throw error;
}

interface ResolveResult {
  kind: 'root' | 'folder' | 'document' | 'not_found';
  folderId?: string;
  documentId?: string;
}

export function pgWebdavStore(sql: Sql): WebdavStore {
  const handlers = webdavHandlers(sql);
  const resolve = async (
    organizationId: string,
    segments: readonly string[],
  ): Promise<ResolveResult> => {
    const out = await handlers['webdav/tree_queries:resolvePath']({
      organizationId,
      namespace: 'documents',
      segments: [...segments],
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own handler's closed return shape
    return out as ResolveResult;
  };

  return {
    async list({ organizationId, segments }) {
      const resolved = await resolve(organizationId, segments);
      if (resolved.kind === 'not_found') {
        throw new WebdavStoreError('not-found', 'no folder at that path');
      }
      if (resolved.kind === 'document') {
        throw new WebdavStoreError(
          'not-a-folder',
          'the path names a file where a folder was required',
        );
      }
      const listed = await handlers['webdav/tree_queries:listCollection']({
        organizationId,
        namespace: 'documents',
        folderId: resolved.kind === 'folder' ? resolved.folderId : null,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own handler's closed return shape
      const page = listed as {
        folders: { name: string }[];
        documents: { title: string; size: number | null }[];
      };
      return [
        ...page.folders.map((f) => ({ name: f.name, isDir: true, size: 0 })),
        ...page.documents.map((d) => ({
          name: d.title,
          isDir: false,
          size: d.size ?? 0,
        })),
      ];
    },

    async read({ organizationId, segments, maxBytes }) {
      const resolved = await resolve(organizationId, segments);
      if (resolved.kind === 'not_found') {
        throw new WebdavStoreError('not-found', 'no file at that path');
      }
      if (resolved.kind !== 'document' || resolved.documentId === undefined) {
        throw new WebdavStoreError(
          'not-a-file',
          'the path names a folder where a file was required',
        );
      }
      const props = await handlers['webdav/tree_queries:getDocumentProps']({
        organizationId,
        documentId: resolved.documentId,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own handler's closed return shape
      const doc = props as {
        fileId?: string;
        size: number | null;
        contentType: string | null;
      } | null;
      if (!doc || doc.fileId === undefined) {
        throw new WebdavStoreError('not-found', 'the file holds no bytes');
      }
      if (doc.size !== null && doc.size > maxBytes) {
        throw new WebdavStoreError(
          'too-large',
          `the file is ${doc.size} bytes; the ceiling is ${maxBytes}`,
        );
      }
      const orgSlug = await resolveOrgSlug(sql, organizationId);
      if (!orgSlug) {
        throw new WebdavStoreError('not-found', 'organization not found');
      }
      const store = await resolveObjectStore(orgSlug);
      const key = doc.fileId.startsWith('s3:')
        ? doc.fileId.slice(3)
        : doc.fileId;
      const bytes = await s3GetObjectBytes(store, key);
      if (bytes === null) {
        throw new WebdavStoreError('not-found', 'the blob is gone');
      }
      if (bytes.byteLength > maxBytes) {
        throw new WebdavStoreError(
          'too-large',
          `the file is ${bytes.byteLength} bytes; the ceiling is ${maxBytes}`,
        );
      }
      return { bytes, contentType: doc.contentType };
    },

    async write({ organizationId, segments, bytes, contentType }) {
      const storageRef = await putOrgBlobBytes(sql, organizationId, {
        bytes,
        contentType,
      });
      try {
        await handlers['webdav/tree_mutations:ingestPutBlob']({
          organizationId,
          pathSegments: [...segments],
          storageId: storageRef,
          contentType,
          size: bytes.byteLength,
          userId: 'connector:webdav',
        });
      } catch (error) {
        // Reclaim the orphan blob the failed ingest left behind.
        await handlers['webdav/tree_mutations:deleteWebdavBlob']({
          storageId: storageRef,
          organizationId,
        });
        translate(error);
      }
    },

    async remove({ organizationId, segments }) {
      const resolved = await resolve(organizationId, segments);
      if (resolved.kind === 'not_found') return false;
      if (resolved.kind === 'root') {
        throw new WebdavStoreError(
          'not-a-file',
          'the root collection cannot be removed',
        );
      }
      try {
        if (resolved.kind === 'document') {
          await handlers['webdav/tree_mutations:softDeleteDocument']({
            organizationId,
            documentId: resolved.documentId,
          });
        } else {
          await handlers['webdav/tree_mutations:deleteFolderCascade']({
            organizationId,
            folderId: resolved.folderId,
          });
        }
      } catch (error) {
        translate(error);
      }
      return true;
    },
  };
}
