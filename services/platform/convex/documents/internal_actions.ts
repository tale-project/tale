'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';
import * as DocumentsHelpers from './helpers';

const documentSourceTypeValidator = v.union(
  v.literal('markdown'),
  v.literal('html'),
  v.literal('url'),
);

const documentOutputFormatValidator = v.union(
  v.literal('pdf'),
  v.literal('image'),
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
  handler: async (ctx, args) => {
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
  handler: async (ctx, args) => {
    return await DocumentsHelpers.generatePptx(ctx, args);
  },
});

export const generateDocx = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.generateDocx(ctx, args);
  },
});

export const generateDocxFromTemplate = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
    templateStorageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.generateDocxFromTemplate(ctx, args);
  },
});

/**
 * Progressive intervals to cover ~24 hours with 50 attempts:
 * - Attempts 1-30: 2 minutes each (~60 minutes total)
 * - Attempts 31-50: Progressive increase from 15 to 129 minutes (~24 hours total)
 */
const getPollingInterval = (attempt: number): number => {
  const MINUTE = 60 * 1000;

  if (attempt < 30) {
    return 2 * MINUTE;
  }

  // After first hour: progressively increase interval
  // Formula: 15 + (attempt - 30) * 6 minutes
  return (15 + (attempt - 30) * 6) * MINUTE;
};

export const checkRagJobStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const maxAttempts = 50;

    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    if (!document?.ragInfo?.jobId) {
      return null;
    }

    // Terminate: status already in terminal state (completed or failed)
    if (
      document.ragInfo.status === 'completed' ||
      document.ragInfo.status === 'failed'
    ) {
      return null;
    }

    // Terminate: max attempts reached
    if (args.attempt > maxAttempts) {
      console.warn(
        `[checkRagJobStatus] Max attempts (${maxAttempts}) reached for document ${args.documentId}`,
      );
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocumentRagInfo,
        {
          documentId: args.documentId,
          ragInfo: {
            status: 'failed',
            jobId: document.ragInfo.jobId,
            error: `Job status check timed out after ${maxAttempts} attempts`,
          },
        },
      );
      return null;
    }

    // Query RAG service for job status
    const ragUrl = process.env.RAG_URL || 'http://localhost:8001';
    const url = `${ragUrl}/api/v1/jobs/${document.ragInfo.jobId}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(
          `[checkRagJobStatus] RAG service returned ${response.status} for job ${document.ragInfo.jobId} (attempt ${args.attempt}/${maxAttempts})`,
        );
        // Schedule next attempt on HTTP error
        await ctx.scheduler.runAfter(
          getPollingInterval(args.attempt),
          internal.documents.internal_actions.checkRagJobStatus,
          { documentId: args.documentId, attempt: args.attempt + 1 },
        );
        return null;
      }

      const job = (await response.json()) as {
        state: 'queued' | 'running' | 'completed' | 'failed';
        updated_at?: number;
        error?: string;
        message?: string;
      };

      // Terminate: job reached terminal state
      if (job.state === 'completed' || job.state === 'failed') {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: job.state,
              jobId: document.ragInfo.jobId,
              indexedAt: job.state === 'completed' ? job.updated_at : undefined,
              error:
                job.state === 'failed'
                  ? job.error || job.message || 'Unknown error'
                  : undefined,
            },
          },
        );
        return null;
      }

      // Update status if changed to running
      if (job.state === 'running' && document.ragInfo.status !== 'running') {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'running',
              jobId: document.ragInfo.jobId,
            },
          },
        );
      }

      // Schedule next attempt
      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.documents.internal_actions.checkRagJobStatus,
        { documentId: args.documentId, attempt: args.attempt + 1 },
      );
    } catch (error) {
      console.error(
        `[checkRagJobStatus] Error checking job status (attempt ${args.attempt}/${maxAttempts}):`,
        error,
      );
      // Schedule next attempt on network error
      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.documents.internal_actions.checkRagJobStatus,
        { documentId: args.documentId, attempt: args.attempt + 1 },
      );
    }

    return null;
  },
});

export const deleteDocumentFromRag = internalAction({
  args: {
    documentId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const ragUrl = process.env.RAG_URL || 'http://localhost:8001';

    try {
      const response = await fetch(
        `${ragUrl}/api/v1/documents/${encodeURIComponent(args.documentId)}?mode=hard`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(60000),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(
          `[deleteDocumentFromRag] Failed to delete document ${args.documentId} from RAG: ${response.status} ${errorText}`,
        );
      }
    } catch (error) {
      console.error(
        `[deleteDocumentFromRag] Error deleting document ${args.documentId} from RAG:`,
        error,
      );
    }

    return null;
  },
});

export const reindexDocumentRag = internalAction({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ragUrl = process.env.RAG_URL || 'http://localhost:8001';

    // Step 1: Delete document from RAG
    try {
      const deleteResponse = await fetch(
        `${ragUrl}/api/v1/documents/${encodeURIComponent(args.documentId)}?mode=hard`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(60000),
        },
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        console.warn(
          `[reindexDocumentRag] Failed to delete document ${args.documentId} from RAG: ${deleteResponse.status} ${errorText}`,
        );
      }
    } catch (error) {
      console.error(
        `[reindexDocumentRag] Error deleting document ${args.documentId} from RAG:`,
        error,
      );
    }

    // Step 2: Re-upload document with new team_ids
    const result = (await ragAction.execute(
      ctx,
      { operation: 'upload_document', recordId: args.documentId },
      {},
    )) as { success: boolean; jobId?: string };

    if (!result.success) {
      console.error(
        `[reindexDocumentRag] Failed to re-upload document ${args.documentId} to RAG`,
      );
    }

    return null;
  },
});
