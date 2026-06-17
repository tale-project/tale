import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';

const MAX_CONTENT_CHARS = 50_000;

export interface DocumentContentResult {
  fileId: string;
  name: string;
  content: string;
  chunkRange: { start: number; end: number };
  totalChunks: number;
  truncated: boolean;
  totalChars: number;
  chunks?: Array<{ index: number; content: string }>;
}

export interface FetchDocumentContentOptions {
  chunkStart?: number;
  chunkEnd?: number;
  returnChunks?: boolean;
}

/**
 * Fetch document content from the RAG service, scoped to `orgSlug`.
 * Shared between agent tool (retrieve_document) and workflow action (document action).
 *
 * RAG now scopes documents by `org_slug`; a foreign-org `fileId` returns
 * 404 (not the foreign content) which surfaces here as the documented
 * "not found in the knowledge base" error.
 */
export async function fetchDocumentContent(
  ctx: ActionCtx,
  orgSlug: string,
  fileId: string,
  options?: FetchDocumentContentOptions,
): Promise<DocumentContentResult> {
  // The RAG document-content fetch now lives in a Convex internal action;
  // the HTTP call was replaced by an in-process `ctx.runAction`. A `null`
  // return is the action's not-found contract (RAG scopes documents by
  // org_slug; a foreign-org / unindexed fileId yields null).
  const result = await ctx.runAction(internal.rag.documents.getContent, {
    orgSlug,
    fileId,
    chunkStart: options?.chunkStart ?? null,
    chunkEnd: options?.chunkEnd ?? null,
    returnChunks: options?.returnChunks ?? null,
  });

  if (result === null) {
    throw new Error(
      `Document "${fileId}" was not found in the knowledge base. ` +
        'It may not have been indexed yet.',
    );
  }

  const rawContent = result.content ?? '';
  const truncated = rawContent.length > MAX_CONTENT_CHARS;
  const content = truncated
    ? rawContent.slice(0, MAX_CONTENT_CHARS)
    : rawContent;

  return {
    fileId: result.file_id,
    name: result.title ?? 'Untitled',
    content,
    chunkRange: result.chunk_range,
    totalChunks: result.total_chunks,
    truncated,
    totalChars: result.total_chars,
    chunks: result.chunks ?? undefined,
  };
}
