import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import { toId } from '../../../lib/type_cast_helpers';
import { wrapUntrusted } from '../../../lib/untrusted_content';
import type { AgentKnowledgeCtx } from '../../rag/rag_search_tool';
import type { documentRetrieveArgs } from '../document_retrieve_tool';
import {
  fetchDocumentContent,
  type DocumentContentResult,
} from './fetch_document_content';
import { buildTranscriptContentResult } from './transcript_content';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export type RetrieveDocumentArgs = z.infer<typeof documentRetrieveArgs>;

export type DocumentRetrieveResult = DocumentContentResult & {
  /**
   * Present when the content was served directly from the stored transcript
   * because RAG indexing is still pending or has failed. Tells the model the
   * text is complete but `rag_search` may not cover this file yet.
   */
  note?: string;
};

export async function retrieveDocument(
  ctx: ToolCtx,
  args: RetrieveDocumentArgs,
): Promise<DocumentRetrieveResult> {
  const { organizationId, userId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for retrieving documents',
    );
  }
  if (!userId) {
    throw new Error('userId is required in context for retrieving documents');
  }

  debugLog('tool:document_retrieve start', {
    fileId: args.fileId,
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  // Resolve fileId → document record for access control
  const document = await ctx.runQuery(
    internal.documents.internal_queries.findDocumentByFileId,
    { organizationId, fileId: args.fileId },
  );

  // Set when the row's RAG index isn't ready but the content is already
  // readable from the row itself (transcript-backed chat attachments).
  let directResult: DocumentRetrieveResult | null = null;

  if (document) {
    // Project files pass when this chat's verified project scope covers the
    // owning project (parity with rag_search); Knowledge Hub docs follow the
    // caller's accessible-id set (team rules, project docs excluded).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ToolCtx from @convex-dev/agent lacks our agent knowledge properties injected at runtime
    const extended = ctx as AgentKnowledgeCtx;
    const inProjectScope =
      document.projectId != null &&
      (extended.agentProjectIds ?? []).includes(String(document.projectId));

    if (!inProjectScope) {
      const accessibleIds: string[] = await ctx.runQuery(
        internal.documents.internal_queries.getAccessibleDocumentIds,
        { organizationId, userId },
      );

      if (!accessibleIds.includes(document._id)) {
        throw new Error(
          `Access denied for document "${args.fileId}". ` +
            "You may not have access to this document's team or project.",
        );
      }
    }
  } else {
    // No hub document — fall back to chat-attachment path via fileMetadata.
    // Chat uploads are auto-indexed into RAG by uploadFileToRag, but don't
    // create a documents row.
    const fileMetadata = await ctx.runQuery(
      internal.file_metadata.internal_queries.getByStorageId,
      { storageId: toId<'_storage'>(args.fileId) },
    );

    if (!fileMetadata || fileMetadata.organizationId !== organizationId) {
      throw new Error(
        `Document not found: "${args.fileId}". ` +
          'No document exists with this file ID in the current organization.',
      );
    }

    if (fileMetadata.ragStatus !== 'completed') {
      // Transcript-backed rows (video-link captions, audio Whisper) carry
      // the full text on the row before indexing even starts — the RAG
      // index is derived from that same text. Serve the source directly
      // instead of failing on a derived index that lags (queued/running)
      // or died (failed): unlike plain uploads, the composer unblocks the
      // moment the transcript lands, so this window is user-reachable.
      const transcript =
        fileMetadata.transcriptionStatus === 'completed' &&
        typeof fileMetadata.transcript === 'string' &&
        fileMetadata.transcript.length > 0
          ? fileMetadata.transcript
          : null;

      if (transcript !== null) {
        const note =
          fileMetadata.ragStatus === 'failed'
            ? 'Search indexing failed for this file' +
              (fileMetadata.ragError ? ` (${fileMetadata.ragError})` : '') +
              '. The content in this result was read directly from the ' +
              'stored transcript — it is the complete text, but rag_search ' +
              'cannot find this file.'
            : 'Search indexing is still in progress for this file. The ' +
              'content in this result was read directly from the stored ' +
              'transcript — it is the complete text, but rag_search may ' +
              'not find this file yet.';
        directResult = {
          ...buildTranscriptContentResult({
            fileId: args.fileId,
            fileName: fileMetadata.fileName,
            transcript,
            chunkStart: args.chunkStart,
            chunkEnd: args.chunkEnd,
          }),
          note,
        };
      } else if (fileMetadata.ragStatus === 'failed') {
        throw new Error(
          `RAG indexing failed for file "${args.fileId}": ` +
            `${fileMetadata.ragError ?? 'unknown error'}. ` +
            'Cannot retrieve content.',
        );
      } else {
        const status = fileMetadata.ragStatus ?? 'pending';
        throw new Error(
          `File "${args.fileId}" is still being indexed (status: ${status}). ` +
            'Try again shortly.',
        );
      }
    }
  }

  let result: DocumentRetrieveResult;
  if (directResult !== null) {
    result = directResult;
  } else {
    const orgSlug = await orgSlugFromId(ctx, organizationId);
    result = await fetchDocumentContent(ctx, orgSlug, args.fileId, {
      chunkStart: args.chunkStart,
      chunkEnd: args.chunkEnd,
    });
  }

  // Prompt-injection defense: transcripts/captions reaching the agent via
  // this tool originate from attacker-controlled video metadata (uploader,
  // chapter titles, caption text). The earlier `<untrusted_source>` wrapper
  // in start_agent_chat.ts:628 only covered the short reference line; the
  // actual body travels through here. Wrap any video-link-sourced result
  // so the TRUST RULES system prompt actually applies to the payload the
  // model reads.
  const videoSources = await ctx.runQuery(
    internal.file_metadata.internal_queries.lookupVideoLinkSources,
    { storageIds: [toId<'_storage'>(args.fileId)] },
  );
  if (videoSources.length > 0) {
    const meta: { tool: string; url?: string } = { tool: 'document_retrieve' };
    if (videoSources[0].sourceUrl) meta.url = videoSources[0].sourceUrl;
    result.content = wrapUntrusted(result.content, meta);
  }

  debugLog('tool:document_retrieve success', {
    fileId: args.fileId,
    totalChunks: result.totalChunks,
    totalChars: result.totalChars,
    truncated: result.truncated,
    wrappedAsUntrusted: videoSources.length > 0,
    servedFromTranscript: directResult !== null,
  });

  return result;
}
