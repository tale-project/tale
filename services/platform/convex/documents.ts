/**
 * Documents API - Thin Wrappers
 *
 * This file contains thin query/mutation/action wrappers that call business logic
 * from the model/documents directory.
 *
 * Following Convex best practice: https://docs.convex.dev/understanding/best-practices/#use-helper-functions-to-write-shared-code
 */

import { v } from 'convex/values';
import {
  action,
  internalAction,
  internalQuery,
  internalMutation,
} from './_generated/server';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import { cursorPaginationOptsValidator } from './lib/pagination';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { DocumentMetadata } from './model/documents/types';
import { checkOrganizationRateLimit } from './lib/rate_limiter/helpers';

// Import model functions and validators
import * as DocumentsModel from './model/documents';
import {
  documentItemValidator as DocumentItem,
  documentListResponseValidator as DocumentListResponse,
  documentRecordValidator as DocumentRecord,
  sourceProviderValidator,
  excelSheetValidator,
  uploadBase64ResponseValidator,
  readFileBase64ResponseValidator,
  sourceTypeValidator,
  outputFormatValidator,
  pdfOptionsValidator,
  imageOptionsValidator,
  urlOptionsValidator,
  generateDocumentResponseValidator,
  membershipValidator,
  signedUrlResponseValidator,
  documentByExtensionItemValidator,
  deleteFromRagResponseValidator,
  uploadFileResponseValidator,
  createOneDriveSyncConfigResponseValidator,
  analyzePptxResponseValidator,
  slideContentDataValidator,
  pptxBrandingDataValidator,
  generatePptxResponseValidator,
  docxContentValidator,
  generateDocxResponseValidator,
  retryRagIndexingResponseValidator,
  sortOrderValidator,
  ragInfoValidator,
} from './model/documents/validators';
import { ragAction } from './workflow/actions/rag/rag_action';

// =============================================================================
// INTERNAL FUNCTIONS (no RLS)
// =============================================================================

/**
 * Create a new document (internal)
 */
export const createDocument = internalMutation({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),

    content: v.optional(v.string()),
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    metadata: v.optional(v.any()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    documentId: v.id('documents'),
  }),
  handler: async (ctx, args) => {
    return await DocumentsModel.createDocument(ctx, args);
  },
});

/**
 * Upload a base64-encoded file directly to Convex storage (internal).
 *
 * This does **not** create a row in the `documents` table. It is intended to
 * be used by tools like `convex_document_storage` that want storage-only
 * behavior.
 */
export const uploadBase64Internal = internalAction({
  args: {
    fileName: v.string(),
    contentType: v.string(),
    dataBase64: v.string(),
  },
  returns: uploadBase64ResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.uploadBase64ToStorage(ctx, args);
  },
});

/**
 * Generate an Excel workbook via a Node-only action and upload it to storage.
 *
 * This action runs in the default Convex runtime and is responsible for
 * storage operations. It delegates the actual XLSX generation to the
 * node_only generate_excel_internal action, which returns the file as
 * base64.
 */
export const generateExcelInternal = internalAction({
  args: {
    fileName: v.string(),
    sheets: v.array(excelSheetValidator),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.id('_storage'),
    url: v.string(),
    fileName: v.string(),
    rowCount: v.number(),
    sheetCount: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    fileId: Id<'_storage'>;
    url: string;
    fileName: string;
    rowCount: number;
    sheetCount: number;
  }> => {
    // 1. Build the Excel workbook in the Node runtime.
    const nodeResult: {
      fileBase64: string;
      fileName: string;
      rowCount: number;
      sheetCount: number;
    } = await ctx.runAction(
      internal.node_only.documents.generate_excel_internal
        .generateExcelInternal,
      {
        fileName: args.fileName,
        sheets: args.sheets,
      },
    );

    const { fileBase64, fileName, rowCount, sheetCount } = nodeResult;

    // 2. Upload the base64-encoded Excel file to Convex storage using the
    // same helper used elsewhere in the documents model.
    const uploadResult = await DocumentsModel.uploadBase64ToStorage(ctx, {
      fileName,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dataBase64: fileBase64,
    });

    return {
      success: uploadResult.success,
      fileId: uploadResult.fileId,
      url: uploadResult.url,
      fileName: uploadResult.fileName,
      rowCount,
      sheetCount,
    };
  },
});

/**
 * Read a file from Convex storage and return base64 content (internal).
 */
export const readFileBase64Internal = internalAction({
  args: {
    fileId: v.id('_storage'),
  },
  returns: readFileBase64ResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.readFileBase64FromStorage(ctx, args);
  },
});

/**
 * Generate a document (PDF/image) via the crawler and upload it to Convex storage.
 *
 * Thin internalAction wrapper over the model-layer DocumentsModel.generateDocument.
 */
export const generateDocumentInternal = internalAction({
  args: {
    fileName: v.string(),
    sourceType: sourceTypeValidator,
    outputFormat: outputFormatValidator,
    content: v.string(),
    pdfOptions: v.optional(pdfOptionsValidator),
    imageOptions: v.optional(imageOptionsValidator),
    urlOptions: v.optional(urlOptionsValidator),
    extraCss: v.optional(v.string()),
    wrapInTemplate: v.optional(v.boolean()),
  },
  returns: generateDocumentResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.generateDocument(ctx, args);
  },
});

/**
 * Get a document by ID (internal)
 */
export const getDocumentById = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.union(DocumentRecord, v.null()),
  handler: async (ctx, args) => {
    return await DocumentsModel.getDocumentById(ctx, args.documentId);
  },
});

/**
 * Query documents with pagination and filtering (internal)
 */
export const queryDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.optional(sourceProviderValidator),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(DocumentRecord),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await DocumentsModel.queryDocuments(ctx, args);
  },
});

/**
 * Find a document by title within an organization (internal)
 */
export const findDocumentByTitle = internalQuery({
  args: {
    organizationId: v.string(),
    title: v.string(),
  },
  returns: v.union(DocumentRecord, v.null()),
  handler: async (ctx, args) => {
    return await DocumentsModel.findDocumentByTitle(ctx, args);
  },
});

/**
 * Update a single document (internal)
 *
 * Thin wrapper around DocumentsModel.updateDocument with additional fields
 * used by internal systems like OneDrive sync.
 */
export const updateDocumentInternal = internalMutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(v.any()),
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await DocumentsModel.updateDocument(ctx, args);
    return null;
  },
});

/**
 * Check organization membership (internal)
 */
export const checkMembership = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.null(), membershipValidator),
  handler: async (ctx, args) => {
    return await DocumentsModel.checkMembership(ctx, args);
  },
});

/**
 * Generate signed URL for a document (internal)
 */
export const generateSignedUrl = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  returns: signedUrlResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.generateSignedUrl(ctx, args.documentId);
  },
});

/**
 * List documents by file extension (internal)
 *
 * Uses the by_organizationId_and_extension index to efficiently query
 * documents of a specific type (e.g., 'pptx', 'pdf', 'docx').
 */
export const listDocumentsByExtension = internalQuery({
  args: {
    organizationId: v.string(),
    extension: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(documentByExtensionItemValidator),
  handler: async (ctx, args) => {
    return await DocumentsModel.listDocumentsByExtension(ctx, args);
  },
});

/**
 * Update document RAG info (internal)
 *
 * Updates the ragInfo field on a document to track RAG indexing status.
 * Called by ragAction after uploading to RAG service.
 */
export const updateDocumentRagInfo = internalMutation({
  args: {
    documentId: v.id('documents'),
    ragInfo: ragInfoValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, { ragInfo: args.ragInfo });
    return null;
  },
});

/**
 * Calculate polling interval based on attempt number.
 *
 * Progressive intervals to cover ~24 hours with 50 attempts:
 * - Attempts 1-30: 2 minutes each (~60 minutes total)
 * - Attempts 31-50: Progressive increase from 15 to 129 minutes (~24 hours total)
 */
const getPollingInterval = (attempt: number): number => {
  const MINUTE = 60 * 1000;

  if (attempt < 30) {
    // First hour: check every 2 minutes
    return 2 * MINUTE;
  }

  // After first hour: progressively increase interval
  // Formula: 15 + (attempt - 30) * 6 minutes
  // - Attempt 31: 15 minutes
  // - Attempt 40: 69 minutes
  // - Attempt 50: 129 minutes
  return (15 + (attempt - 30) * 6) * MINUTE;
};

/**
 * Check RAG job status (internal action)
 *
 * Polls RAG service with progressive intervals:
 * - First check: 10 seconds after upload (scheduled by ragAction)
 * - Attempts 2-30: every 2 minutes (~1 hour coverage)
 * - Attempts 31-50: progressive increase from 15 to 129 minutes (~23 hours)
 * - Maximum 50 attempts, final check at ~24 hours
 * - Terminates when status is 'completed' or 'failed'
 */
export const checkRagJobStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;
    const maxAttempts = 50;

    const document = await ctx.runQuery(internal.documents.getDocumentById, {
      documentId: args.documentId,
    });

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
    if (attempt > maxAttempts) {
      console.warn(
        `[checkRagJobStatus] Max attempts (${maxAttempts}) reached for document ${args.documentId}`,
      );
      await ctx.runMutation(internal.documents.updateDocumentRagInfo, {
        documentId: args.documentId,
        ragInfo: {
          status: 'failed',
          jobId: document.ragInfo.jobId,
          error: `Job status check timed out after ${maxAttempts} attempts`,
        },
      });
      return null;
    }

    // Query RAG service for job status
    const ragUrl = process.env.RAG_URL || 'http://localhost:8001';
    const url = `${ragUrl}/api/v1/jobs/${document.ragInfo.jobId}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(
          `[checkRagJobStatus] RAG service returned ${response.status} for job ${document.ragInfo.jobId} (attempt ${attempt}/${maxAttempts})`,
        );
        // Schedule next attempt on HTTP error
        await ctx.scheduler.runAfter(
          getPollingInterval(attempt),
          internal.documents.checkRagJobStatus,
          { documentId: args.documentId, attempt: attempt + 1 },
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
        await ctx.runMutation(internal.documents.updateDocumentRagInfo, {
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
        });
        return null;
      }

      // Update status if changed to running
      if (job.state === 'running' && document.ragInfo.status !== 'running') {
        await ctx.runMutation(internal.documents.updateDocumentRagInfo, {
          documentId: args.documentId,
          ragInfo: {
            status: 'running',
            jobId: document.ragInfo.jobId,
          },
        });
      }

      // Schedule next attempt
      await ctx.scheduler.runAfter(
        getPollingInterval(attempt),
        internal.documents.checkRagJobStatus,
        { documentId: args.documentId, attempt: attempt + 1 },
      );
    } catch (error) {
      console.error(
        `[checkRagJobStatus] Error checking job status (attempt ${attempt}/${maxAttempts}):`,
        error,
      );
      // Schedule next attempt on network error
      await ctx.scheduler.runAfter(
        getPollingInterval(attempt),
        internal.documents.checkRagJobStatus,
        { documentId: args.documentId, attempt: attempt + 1 },
      );
    }

    return null;
  },
});

/**
 * Delete document knowledge from RAG service (internal action)
 *
 * This action is scheduled after a document is deleted to clean up
 * the associated knowledge graph nodes and vector embeddings in RAG.
 * It uses the document ID which was stored in Cognee's node_set when uploading.
 */
export const deleteDocumentFromRagInternal = internalAction({
  args: {
    documentId: v.string(),
    mode: v.optional(v.union(v.literal('soft'), v.literal('hard'))),
  },
  returns: deleteFromRagResponseValidator,
  handler: async (_ctx, args) => {
    const { getRagConfig } = await import(
      './workflow/actions/rag/helpers/get_rag_config'
    );
    const { deleteDocumentById } = await import(
      './workflow/actions/rag/helpers/delete_document'
    );

    const ragConfig = getRagConfig();

    const result = await deleteDocumentById({
      ragServiceUrl: ragConfig.serviceUrl,
      documentId: args.documentId,
      mode: args.mode || 'hard',
    });

    console.log('[documents] RAG deletion result:', {
      success: result.success,
      deletedCount: result.deletedCount,
      message: result.message,
      documentId: args.documentId,
    });

    return {
      success: result.success,
      deletedCount: result.deletedCount,
      deletedDataIds: result.deletedDataIds,
      message: result.message,
      error: result.error,
    };
  },
});

// =============================================================================
// PUBLIC FUNCTIONS (with RLS)
// =============================================================================

/**
 * Check if organization has any documents (fast count query for empty state detection)
 */
export const hasDocuments = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstDoc = await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstDoc !== null;
  },
});

/**
 * Get documents with pagination and filtering (public)
 */
export const getDocuments = queryWithRLS({
  args: {
    organizationId: v.string(),
    page: v.optional(v.number()),
    size: v.optional(v.number()),
    query: v.optional(v.string()),
    folderPath: v.optional(v.string()),
    sortField: v.optional(v.string()),
    sortOrder: v.optional(sortOrderValidator),
  },
  returns: DocumentListResponse,
  handler: async (ctx, args) => {
    return await DocumentsModel.getDocuments(ctx, args);
  },
});

/**
 * Update a document (public)
 */
export const updateDocument = mutationWithRLS({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await DocumentsModel.updateDocument(ctx, args);
    return null;
  },
});

/**
 * Delete a document (public)
 *
 * This also schedules RAG cleanup to delete associated knowledge
 * from the RAG service (graph nodes and vector embeddings).
 * Documents are always file-based, so we use file upload deletion.
 */
export const deleteDocument = mutationWithRLS({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get document before deletion for RAG cleanup
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // Store document ID for RAG cleanup (it's stored in Cognee's node_set)
    const documentIdStr = args.documentId as string;

    // Delete from platform database
    await DocumentsModel.deleteDocument(ctx, args.documentId);

    // Schedule RAG cleanup - use document ID which was stored in Cognee's node_set
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.deleteDocumentFromRagInternal,
        {
          documentId: documentIdStr,
          mode: 'hard' as const,
        },
      );
    } catch (error) {
      // Log error but don't fail the deletion - RAG cleanup is best-effort
      console.error('[documents] Failed to schedule RAG cleanup:', {
        documentId: args.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  },
});

/**
 * Get document by ID (public)
 */
export const getDocumentByIdPublic = queryWithRLS({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.union(
    v.object({
      success: v.boolean(),
      item: DocumentItem,
    }),
    v.object({
      success: v.boolean(),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await DocumentsModel.getDocumentByIdPublic(ctx, args.documentId);
  },
});

/**
 * Get document by storage path (public)
 */
export const getDocumentByPath = queryWithRLS({
  args: {
    organizationId: v.string(),
    storagePath: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.boolean(),
      item: DocumentItem,
    }),
    v.object({
      success: v.boolean(),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await DocumentsModel.getDocumentByPath(ctx, args);
  },
});

/**
 * Upload file action (public)
 */
export const uploadFile = action({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    fileData: v.bytes(),
    contentType: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: uploadFileResponseValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    fileId?: string;
    documentId?: string;
    error?: string;
  }> => {
    try {
      await checkOrganizationRateLimit(ctx, 'file:upload', args.organizationId);

      // 1. Check authentication
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return {
          success: false,
          error: 'Not authenticated',
        };
      }

      // 2. Verify user is a member of the organization
      const member = await ctx.runQuery(internal.documents.checkMembership, {
        organizationId: args.organizationId,
        userId: identity.subject,
      });

      if (!member) {
        return {
          success: false,
          error: 'Not authorized to upload to this organization',
        };
      }

      // 3. Check if a document with the same name already exists
      const existingDocument = await ctx.runQuery(
        internal.documents.findDocumentByTitle,
        {
          organizationId: args.organizationId,
          title: args.fileName,
        },
      );

      // 4. Store the file in Convex storage
      const fileId = await ctx.storage.store(
        new Blob([args.fileData], { type: args.contentType }),
      );

      // 5. Build document metadata
      // Use DocumentMetadata type for safe property access
      const typedMetadata: DocumentMetadata | undefined = args.metadata;
      const providerFromMetadata =
        typedMetadata?.sourceProvider === 'onedrive' ? 'onedrive' : 'upload';
      const modeFromMetadata =
        typedMetadata?.sourceMode === 'auto' ? 'auto' : 'manual';
      const externalItemId =
        typedMetadata?.oneDriveId ?? typedMetadata?.oneDriveItemId;
      const documentMetadata = {
        name: args.fileName,
        type: 'file' as const,
        sourceProvider: providerFromMetadata,
        sourceMode: modeFromMetadata,
        lastModified: Date.now(),
        ...args.metadata,
      };

      // 6. Update existing document or create new one
      if (existingDocument) {
        // Delete the old file from storage if it exists
        if (existingDocument.fileId) {
          await ctx.storage.delete(existingDocument.fileId);
        }

        // Update the existing document
        await ctx.runMutation(internal.documents.updateDocumentInternal, {
          documentId: existingDocument._id,
          title: args.fileName,
          fileId: fileId,
          mimeType: args.contentType,
          sourceProvider: providerFromMetadata,
          externalItemId,
          metadata: documentMetadata,
        });

        return {
          success: true,
          fileId,
          documentId: existingDocument._id,
        };
      }

      // Create new document record
      const result: { success: boolean; documentId: string } =
        await ctx.runMutation(internal.documents.createDocument, {
          organizationId: args.organizationId,
          title: args.fileName,

          sourceProvider: providerFromMetadata,
          externalItemId,
          fileId: fileId,
          mimeType: args.contentType,
          metadata: documentMetadata,
        });

      return {
        success: true,
        fileId,
        documentId: result.documentId,
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  },
});

/**
 * Create OneDrive sync configuration (public)
 */
export const createOneDriveSyncConfig = mutationWithRLS({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    itemType: v.union(v.literal('file'), v.literal('folder')),
    itemId: v.string(),
    itemName: v.string(),
    itemPath: v.optional(v.string()),
    targetBucket: v.string(),
    storagePrefix: v.optional(v.string()),
  },
  returns: createOneDriveSyncConfigResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.createOneDriveSyncConfig(ctx, args);
  },
});

// =============================================================================
// PPTX/DOCX GENERATION
// =============================================================================

/**
 * Analyze a PPTX template to extract its full content via the crawler service.
 */
export const analyzePptxInternal = internalAction({
  args: {
    templateStorageId: v.id('_storage'),
  },
  returns: analyzePptxResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.analyzePptx(ctx, {
      templateStorageId: args.templateStorageId,
    });
  },
});

/**
 * Generate a PPTX from content via the crawler service.
 *
 * When templateStorageId is provided, uses the template as a base, preserving
 * all styling, backgrounds, and decorative elements.
 */
export const generatePptxInternal = internalAction({
  args: {
    fileName: v.string(),
    slidesContent: v.array(slideContentDataValidator),
    branding: v.optional(pptxBrandingDataValidator),
    templateStorageId: v.id('_storage'),
  },
  returns: generatePptxResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.generatePptx(ctx, {
      fileName: args.fileName,
      slidesContent: args.slidesContent,
      branding: args.branding,
      templateStorageId: args.templateStorageId,
    });
  },
});

/**
 * Generate a DOCX from structured content via the crawler service.
 */
export const generateDocxInternal = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
  },
  returns: generateDocxResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.generateDocx(ctx, {
      fileName: args.fileName,
      content: args.content,
    });
  },
});

/**
 * Generate a DOCX from content using a template via the crawler service.
 *
 * When a template is provided, the generated document preserves:
 * - Headers and footers (company logo, page numbers)
 * - Font families and styles
 * - Page setup (margins, orientation, size)
 */
export const generateDocxFromTemplateInternal = internalAction({
  args: {
    fileName: v.string(),
    content: docxContentValidator,
    templateStorageId: v.id('_storage'),
  },
  returns: generateDocxResponseValidator,
  handler: async (ctx, args) => {
    return await DocumentsModel.generateDocxFromTemplate(ctx, {
      fileName: args.fileName,
      content: args.content,
      templateStorageId: args.templateStorageId,
    });
  },
});

// =============================================================================
// RAG RETRY
// =============================================================================

/**
 * Retry RAG indexing for a failed document.
 * Reuses the existing ragAction from the workflow system.
 */
export const retryRagIndexing = action({
  args: { documentId: v.id('documents') },
  returns: retryRagIndexingResponseValidator,
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return { success: false, error: 'Not authenticated' };
      }

      const document = await ctx.runQuery(internal.documents.getDocumentById, {
        documentId: args.documentId,
      });
      if (!document) {
        return { success: false, error: 'Document not found' };
      }

      await checkOrganizationRateLimit(
        ctx,
        'file:rag-retry',
        document.organizationId,
      );

      const member = await ctx.runQuery(internal.documents.checkMembership, {
        organizationId: document.organizationId,
        userId: identity.subject,
      });
      if (!member) {
        return { success: false, error: 'Not authorized to access this document' };
      }

      type RagResult = { success: boolean; jobId?: string };
      const result = (await ragAction.execute(
        ctx,
        { operation: 'upload_document', recordId: args.documentId },
        {},
      )) as RagResult;

      return { success: result.success, jobId: result.jobId };
    } catch (error) {
      console.error('[retryRagIndexing] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry RAG indexing',
      };
    }
  },
});

