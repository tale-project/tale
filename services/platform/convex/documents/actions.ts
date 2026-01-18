/**
 * Documents Actions
 *
 * Internal and public actions for document generation operations.
 */

'use node';

import { v } from 'convex/values';
import { internalAction, action } from '../_generated/server';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import * as DocumentsHelpers from './helpers';
import { authComponent } from '../auth';
import { internal } from '../_generated/api';

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

/**
 * Generate a document (PDF/image) using the crawler service (internal action)
 */
export const generateDocumentInternal = internalAction({
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

/**
 * Generate a PPTX document (internal action)
 */
export const generatePptxInternal = internalAction({
  args: {
    fileName: v.string(),
    slidesContent: v.array(slideContentValidator),
    branding: pptxBrandingValidator,
    templateStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.generatePptx(ctx, {
      ...args,
      templateStorageId: args.templateStorageId!,
    });
  },
});

/**
 * Generate a DOCX document (internal action)
 */
export const generateDocxInternal = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.generateDocx(ctx, args);
  },
});

/**
 * Generate a DOCX document from template (internal action)
 */
export const generateDocxFromTemplateInternal = internalAction({
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
 * Check RAG job status (internal action)
 * Called by scheduler to poll RAG indexing job status
 */
export const checkRagJobStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    // TODO: Implement RAG job status checking
    // This action should:
    // 1. Query the RAG service for job status
    // 2. Update document ragInfo based on status
    // 3. Reschedule itself if job is still running (with backoff)
    console.warn('[checkRagJobStatus] Not implemented yet', {
      documentId: args.documentId,
      attempt: args.attempt,
    });
  },
});

// =============================================================================
// PUBLIC ACTIONS (for frontend via api.documents.actions.*)
// =============================================================================

/**
 * Retry RAG indexing for a failed document (public action)
 */
export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    jobId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    // Get document and verify access
    const document = await ctx.runQuery(internal.documents.queries.getDocumentById, {
      documentId: args.documentId,
    });

    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    // Update RAG info to queued status
    await ctx.runMutation(internal.documents.mutations.updateDocumentRagInfo, {
      documentId: args.documentId,
      ragInfo: {
        status: 'queued',
      },
    });

    return { success: true };
  },
});
