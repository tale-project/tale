import type { Sql } from 'postgres';

import type { ConnectorCaller } from '../../../lib/connectors/dispatcher.ts';
import type { ConnectorBlobSink } from '../../../lib/connectors/live-host.ts';
import {
  deleteOrgBlobRefs,
  putOrgBlobBytes,
  registerUploadedBytes,
} from '../files/service.ts';

/**
 * What a live connector body's `ctx.files` writes to: the organization's own
 * blob store, through the files domain, with a `file_metadata` row so the
 * bytes are visible to the file listing and retention like any other upload.
 *
 * The returned `id` is the org blob ref — the handle the rest of the platform
 * calls `storageId`/`storageRef` (the conversation attachment chips read it,
 * `imap-smtp.send` accepts it as an outbound attachment), so a body that
 * stores a vendor attachment hands the caller something the next node can
 * use. No URL: a download is presigned at read time from the ref, the way the
 * conversation projection does it, never baked into a run's output.
 *
 * Not RAG-indexed here: nothing scopes the bytes to a corpus at this point (a
 * run may bind them to a document or conversation later, and that binder
 * indexes), and an unscoped row would be an org-wide hub document.
 */
export function connectorBlobSink(
  sql: Sql,
  scope: { organizationId: string; connector: string; caller: ConnectorCaller },
): ConnectorBlobSink {
  return {
    store: async ({ data, encoding, contentType, fileName }) => {
      const bytes = Uint8Array.from(
        Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8'),
      );
      const storageRef = await putOrgBlobBytes(sql, scope.organizationId, {
        bytes,
        contentType,
      });
      try {
        await registerUploadedBytes(sql, {
          organizationId: scope.organizationId,
          storageRef,
          fileName,
          contentType,
          size: bytes.byteLength,
          source: scope.connector,
          ...(scope.caller.kind === 'user'
            ? { uploadedBy: scope.caller.userId }
            : {}),
          skipRagIndexing: true,
        });
      } catch (error) {
        // The bytes landed but nothing references them: reclaim the blob
        // (best-effort, the shared helper never throws) so a failed row
        // write does not leave an unlisted object behind, then surface the
        // failure to the body as it happened.
        await deleteOrgBlobRefs(sql, scope.organizationId, [storageRef]);
        throw error;
      }
      return { id: storageRef, fileName, contentType, size: bytes.byteLength };
    },
  };
}
