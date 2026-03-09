import type { ActionCtx } from '../../../../_generated/server';
import type { DocumentMetadata } from '../../../../documents/types';
import type { RagUploadResult } from './types';

import { internal } from '../../../../_generated/api';
import { toId } from '../../../../lib/type_cast_helpers';
import { uploadFile } from './upload_file_direct';

const INITIAL_POLLING_DELAY_MS = 10_000;

export async function uploadDocument(
  ctx: ActionCtx,
  ragServiceUrl: string,
  recordId: string,
): Promise<RagUploadResult> {
  const documentId = toId<'documents'>(recordId);

  const document = await ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    { documentId },
  );
  if (!document) {
    throw new Error(`Document not found: ${recordId}`);
  }
  if (!document.fileId) {
    return {
      success: false,
      recordId,
      error: `Document has no file: ${recordId}`,
      timestamp: Date.now(),
    };
  }

  const fileUrl = await ctx.storage.getUrl(document.fileId);
  if (!fileUrl) {
    throw new Error(`File URL not available: ${recordId}`);
  }

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.status}`);
  }
  const file = await fileResponse.blob();

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const meta = (document.metadata as DocumentMetadata | undefined) || {};

  const result = await uploadFile({
    ragServiceUrl,
    file,
    filename: meta.name || document.title || 'document',
    contentType: meta.mimeType || 'application/octet-stream',
    documentId: recordId,
    metadata: {
      recordId,
      organizationId: document.organizationId,
      title: document.title,
      ...meta,
    },
  });

  if (result.success) {
    await ctx.runMutation(
      internal.documents.internal_mutations.updateDocumentRagInfo,
      { documentId, ragInfo: { status: 'queued' } },
    );
    await ctx.scheduler.runAfter(
      INITIAL_POLLING_DELAY_MS,
      internal.documents.internal_actions.checkRagDocumentStatus,
      { documentId, attempt: 1 },
    );
  }

  return result;
}
