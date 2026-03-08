'use node';

import { v } from 'convex/values';

import type { GenerateDocxResult } from './generate_docx';
import type { GenerateDocxFromTemplateResult } from './generate_docx_from_template';
import type { GeneratePptxResult } from './generate_pptx';
import type { GenerateDocumentResult } from './types';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';
import * as DocumentsHelpers from './helpers';

const INITIAL_POLLING_DELAY_MS = 10_000;

const documentSourceTypeValidator = v.union(
  v.literal('markdown'),
  v.literal('html'),
  v.literal('url'),
);

const documentOutputFormatValidator = v.union(
  v.literal('pdf'),
  v.literal('image'),
  v.literal('docx'),
);

const pdfOptionsValidator = v.optional(
  v.object({
    format: v.optional(v.string()),
    landscape: v.optional(v.boolean()),
    marginTop: v.optional(v.string()),
    marginBottom: v.optional(v.string()),
    marginLeft: v.optional(v.string()),
    marginRight: v.optional(v.string()),
    printBackground: v.optional(v.boolean()),
  }),
);

const imageOptionsValidator = v.optional(
  v.object({
    imageType: v.optional(v.string()),
    quality: v.optional(v.number()),
    fullPage: v.optional(v.boolean()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    scale: v.optional(v.number()),
  }),
);

const urlOptionsValidator = v.optional(
  v.object({
    waitUntil: v.optional(
      v.union(
        v.literal('load'),
        v.literal('domcontentloaded'),
        v.literal('networkidle'),
        v.literal('commit'),
      ),
    ),
  }),
);

const tableDataValidator = v.object({
  headers: v.array(v.string()),
  rows: v.array(v.array(v.string())),
});

const slideContentValidator = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  textContent: v.optional(v.array(v.string())),
  bulletPoints: v.optional(v.array(v.string())),
  tables: v.optional(v.array(tableDataValidator)),
});

const pptxBrandingValidator = v.optional(
  v.object({
    slideWidth: v.optional(v.number()),
    slideHeight: v.optional(v.number()),
    titleFontName: v.optional(v.string()),
    bodyFontName: v.optional(v.string()),
    titleFontSize: v.optional(v.number()),
    bodyFontSize: v.optional(v.number()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
  }),
);

const docxSectionValidator = v.object({
  type: v.union(
    v.literal('heading'),
    v.literal('paragraph'),
    v.literal('bullets'),
    v.literal('numbered'),
    v.literal('table'),
    v.literal('quote'),
    v.literal('code'),
  ),
  text: v.optional(v.string()),
  level: v.optional(v.number()),
  items: v.optional(v.array(v.string())),
  headers: v.optional(v.array(v.string())),
  rows: v.optional(v.array(v.array(v.string()))),
});

const docxContentValidator = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  sections: v.array(docxSectionValidator),
});

export const generateDocument = internalAction({
  args: {
    fileName: v.string(),
    sourceType: documentSourceTypeValidator,
    outputFormat: documentOutputFormatValidator,
    content: v.string(),
    pdfOptions: pdfOptionsValidator,
    imageOptions: imageOptionsValidator,
    urlOptions: urlOptionsValidator,
    extraCss: v.optional(v.string()),
    wrapInTemplate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<GenerateDocumentResult> => {
    return await DocumentsHelpers.generateDocument(ctx, args);
  },
});

export const generatePptx = internalAction({
  args: {
    fileName: v.string(),
    slidesContent: v.array(slideContentValidator),
    branding: pptxBrandingValidator,
    templateStorageId: v.id('_storage'),
  },
  handler: async (ctx, args): Promise<GeneratePptxResult> => {
    return await DocumentsHelpers.generatePptx(ctx, args);
  },
});

export const generateDocx = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
  },
  handler: async (ctx, args): Promise<GenerateDocxResult> => {
    return await DocumentsHelpers.generateDocx(ctx, args);
  },
});

export const generateDocxFromTemplate = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
    templateStorageId: v.id('_storage'),
  },
  handler: async (ctx, args): Promise<GenerateDocxFromTemplateResult> => {
    return await DocumentsHelpers.generateDocxFromTemplate(ctx, args);
  },
});

/**
 * Progressive intervals to cover ~24 hours with 50 attempts:
 * - Attempts 1-30: 2 minutes each (~60 minutes total)
 * - Attempts 31-50: Progressive increase from 15 to 129 minutes (~24 hours total)
 */
export const getPollingInterval = (attempt: number): number => {
  const MINUTE = 60 * 1000;

  if (attempt < 30) {
    return 2 * MINUTE;
  }

  // After first hour: progressively increase interval
  // Formula: 15 + (attempt - 30) * 6 minutes
  return (15 + (attempt - 30) * 6) * MINUTE;
};

export const checkRagDocumentStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const maxAttempts = 50;

    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    if (!document) {
      return null;
    }

    if (!document.ragInfo) {
      return null;
    }

    if (
      document.ragInfo.status === 'completed' ||
      document.ragInfo.status === 'failed'
    ) {
      return null;
    }

    if (args.attempt > maxAttempts) {
      console.warn(
        `[checkRagDocumentStatus] Max attempts (${maxAttempts}) reached for document ${args.documentId}`,
      );
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocumentRagInfo,
        {
          documentId: args.documentId,
          ragInfo: {
            status: 'failed',
            error: `Status check timed out after ${maxAttempts} attempts`,
          },
        },
      );
      return null;
    }

    const ragUrl = getRagConfig().serviceUrl;
    const url = `${ragUrl}/api/v1/documents/statuses`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_ids: [document.ragInfo.indexedFileId ?? args.documentId],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429) {
        console.warn(
          `[checkRagDocumentStatus] Rate limited (attempt ${args.attempt}/${maxAttempts})`,
        );
        await ctx.scheduler.runAfter(
          getPollingInterval(args.attempt),
          internal.documents.internal_actions.checkRagDocumentStatus,
          { documentId: args.documentId, attempt: args.attempt + 1 },
        );
        return null;
      }

      if (response.status >= 400 && response.status < 500) {
        console.error(
          `[checkRagDocumentStatus] RAG returned ${response.status} for ${args.documentId}, not retrying`,
        );
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'failed',
              error: `RAG service returned ${response.status}`,
            },
          },
        );
        return null;
      }

      if (!response.ok) {
        console.warn(
          `[checkRagDocumentStatus] RAG returned ${response.status} (attempt ${args.attempt}/${maxAttempts})`,
        );
        await ctx.scheduler.runAfter(
          getPollingInterval(args.attempt),
          internal.documents.internal_actions.checkRagDocumentStatus,
          { documentId: args.documentId, attempt: args.attempt + 1 },
        );
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('RAG returned non-JSON response');
      }

      if (!isRecord(body)) {
        throw new Error('Invalid response shape from RAG statuses endpoint');
      }

      const statuses = body.statuses;
      if (!isRecord(statuses)) {
        throw new Error('Invalid statuses field in RAG response');
      }

      const ragKey = document.ragInfo.indexedFileId ?? args.documentId;
      const docStatus = statuses[ragKey];
      const status = isRecord(docStatus)
        ? getString(docStatus, 'status')
        : null;
      const error = isRecord(docStatus)
        ? getString(docStatus, 'error')
        : undefined;

      if (status === 'completed') {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'completed',
              indexedAt: Math.floor(Date.now() / 1000),
            },
          },
        );
        return null;
      }

      if (status === 'failed') {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'failed',
              error: error || 'Unknown error',
            },
          },
        );
        return null;
      }

      if (
        status !== 'processing' &&
        status !== 'completed' &&
        status !== 'failed'
      ) {
        console.warn(
          `[checkRagDocumentStatus] Unexpected status "${status}" for ${args.documentId} (attempt ${args.attempt}/${maxAttempts})`,
        );
      }

      if (status === 'processing' && document.ragInfo.status !== 'running') {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'running',
            },
          },
        );
      }

      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.documents.internal_actions.checkRagDocumentStatus,
        { documentId: args.documentId, attempt: args.attempt + 1 },
      );
    } catch (error) {
      console.error(
        `[checkRagDocumentStatus] Error (attempt ${args.attempt}/${maxAttempts}):`,
        error,
      );
      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.documents.internal_actions.checkRagDocumentStatus,
        { documentId: args.documentId, attempt: args.attempt + 1 },
      );
    }

    return null;
  },
});

/** Backward-compat alias for already-scheduled calls. Remove after 2026-03-08. */
export const checkRagJobStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runAction(
      internal.documents.internal_actions.checkRagDocumentStatus,
      args,
    );
    return null;
  },
});

export const deleteDocumentFromRag = internalAction({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ragUrl = getRagConfig().serviceUrl;

    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    const ragKey =
      document?.ragInfo?.indexedFileId ?? document?.fileId ?? args.documentId;

    let ragSuccess = false;
    try {
      const response = await fetch(
        `${ragUrl}/api/v1/documents/${encodeURIComponent(ragKey)}`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(60000),
        },
      );

      if (response.ok) {
        ragSuccess = true;
      } else {
        const errorText = await response.text();
        console.error(
          `[deleteDocumentFromRag] RAG delete failed for ${args.documentId}: ${response.status} ${errorText}`,
        );
      }
    } catch (error) {
      console.error(
        `[deleteDocumentFromRag] RAG delete error for ${args.documentId}:`,
        error,
      );
    }

    if (ragSuccess) {
      await ctx.runMutation(
        internal.documents.internal_mutations.deleteDocumentById,
        { documentId: args.documentId },
      );
    }

    return null;
  },
});

export const uploadDocumentToRag = internalAction({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const document = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: args.documentId },
      );

      if (!document) {
        throw new Error(`Document not found: ${args.documentId}`);
      }
      if (!document.fileId) {
        throw new Error(`Document has no file: ${args.documentId}`);
      }

      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
        },
        {},
      );
      const resultRec = isRecord(rawResult) ? rawResult : undefined;
      const success = resultRec
        ? (getBoolean(resultRec, 'success') ?? false)
        : false;

      if (success) {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'queued',
              indexedFileId: document.fileId,
            },
          },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.documents.internal_actions.checkRagDocumentStatus,
          { documentId: args.documentId, attempt: 1 },
        );
      } else {
        const error =
          (resultRec ? getString(resultRec, 'error') : undefined) ??
          'Upload to RAG failed';
        console.error(
          `[uploadDocumentToRag] Failed to upload document ${args.documentId}: ${error}`,
        );
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: { status: 'failed', error },
          },
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Upload to RAG failed';
      console.error(
        `[uploadDocumentToRag] Error uploading document ${args.documentId}: ${message}`,
      );
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocumentRagInfo,
        {
          documentId: args.documentId,
          ragInfo: { status: 'failed', error: message },
        },
      );
      throw error;
    }

    return null;
  },
});

export const reindexDocumentInRag = internalAction({
  args: {
    documentId: v.id('documents'),
    oldFileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ragUrl = getRagConfig().serviceUrl;

    // Delete old RAG entry (ignore 404 — may not have been indexed)
    try {
      const response = await fetch(
        `${ragUrl}/api/v1/documents/${encodeURIComponent(args.oldFileId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(60000) },
      );
      if (!response.ok && response.status !== 404) {
        console.warn(
          `[reindexDocumentInRag] Failed to delete old RAG entry ${args.oldFileId}: ${response.status}`,
        );
      }
    } catch (error) {
      console.warn(
        `[reindexDocumentInRag] Error deleting old RAG entry ${args.oldFileId}:`,
        error,
      );
    }

    // Look up current document
    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    if (!document || !document.fileId) {
      return null;
    }

    // Upload new file to RAG
    try {
      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
        },
        {},
      );
      const resultRec = isRecord(rawResult) ? rawResult : undefined;
      const success = resultRec
        ? (getBoolean(resultRec, 'success') ?? false)
        : false;

      if (success) {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'queued',
              indexedFileId: document.fileId,
            },
          },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.documents.internal_actions.checkRagDocumentStatus,
          { documentId: args.documentId, attempt: 1 },
        );
      } else {
        const error =
          (resultRec ? getString(resultRec, 'error') : undefined) ??
          'Re-index upload failed';
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: { status: 'failed', error },
          },
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Re-index upload failed';
      console.error(
        `[reindexDocumentInRag] Error re-indexing document ${args.documentId}: ${message}`,
      );
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocumentRagInfo,
        {
          documentId: args.documentId,
          ragInfo: { status: 'failed', error: message },
        },
      );
    }

    return null;
  },
});
