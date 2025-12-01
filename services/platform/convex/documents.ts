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
import { paginationOptsValidator } from 'convex/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

// Import model functions and validators
import * as DocumentsModel from './model/documents';
import {
  DocumentItem,
  DocumentListResponseValidator as DocumentListResponse,
  DocumentRecord,
} from './model/documents/types';

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
    metadata: v.optional(v.any()),
    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
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
  returns: v.object({
    success: v.boolean(),
    fileId: v.id('_storage'),
    url: v.string(),
    fileName: v.string(),
    size: v.number(),
    contentType: v.string(),
  }),
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
    sheets: v.array(
      v.object({
        name: v.string(),
        headers: v.array(v.string()),
        rows: v.array(
          v.array(v.union(v.string(), v.number(), v.boolean(), v.null())),
        ),
      }),
    ),
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
    const uploadResult = await DocumentsModel.uploadBase64ToStorage(
      ctx as any,
      {
        fileName,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dataBase64: fileBase64,
      },
    );

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
  returns: v.object({
    success: v.boolean(),
    fileId: v.id('_storage'),
    dataBase64: v.string(),
    contentType: v.string(),
    size: v.number(),
  }),
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
    sourceType: v.union(
      v.literal('markdown'),
      v.literal('html'),
      v.literal('url'),
    ),
    outputFormat: v.union(v.literal('pdf'), v.literal('image')),
    content: v.string(),
    pdfOptions: v.optional(
      v.object({
        format: v.optional(v.string()),
        landscape: v.optional(v.boolean()),
        marginTop: v.optional(v.string()),
        marginBottom: v.optional(v.string()),
        marginLeft: v.optional(v.string()),
        marginRight: v.optional(v.string()),
        printBackground: v.optional(v.boolean()),
      }),
    ),
    imageOptions: v.optional(
      v.object({
        imageType: v.optional(v.string()),
        quality: v.optional(v.number()),
        fullPage: v.optional(v.boolean()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
      }),
    ),
    urlOptions: v.optional(
      v.object({
        waitUntil: v.optional(v.string()),
      }),
    ),
    extraCss: v.optional(v.string()),
    wrapInTemplate: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.id('_storage'),
    url: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    extension: v.string(),
    size: v.number(),
  }),
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

    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(DocumentRecord),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await DocumentsModel.queryDocuments(ctx, args);
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
    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
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
  returns: v.union(
    v.null(),
    v.object({
      _id: v.string(),
      organizationId: v.string(),
      identityId: v.optional(v.string()),
      role: v.optional(v.string()),
    }),
  ),
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
  returns: v.union(
    v.object({
      success: v.boolean(),
      url: v.string(),
    }),
    v.object({
      success: v.boolean(),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await DocumentsModel.generateSignedUrl(ctx, args.documentId);
  },
});

// =============================================================================
// PUBLIC FUNCTIONS (with RLS)
// =============================================================================

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
 */
export const deleteDocument = mutationWithRLS({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await DocumentsModel.deleteDocument(ctx, args.documentId);
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
  returns: v.object({
    success: v.boolean(),
    fileId: v.optional(v.string()),
    documentId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
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

      // 3. Store the file in Convex storage
      const fileId = await ctx.storage.store(
        new Blob([args.fileData], { type: args.contentType }),
      );

      // 4. Build document metadata
      const providerFromMetadata =
        (args.metadata as any)?.sourceProvider === 'onedrive'
          ? 'onedrive'
          : 'upload';
      const modeFromMetadata =
        (args.metadata as any)?.sourceMode === 'auto' ? 'auto' : 'manual';
      const externalItemId =
        (args.metadata as any)?.oneDriveId ??
        (args.metadata as any)?.oneDriveItemId;
      const documentMetadata = {
        name: args.fileName,
        type: 'file' as const,
        sourceProvider: providerFromMetadata,
        sourceMode: modeFromMetadata,
        lastModified: Date.now(),
        ...args.metadata,
      };

      // 5. Create document record
      const result: { success: boolean; documentId: string } =
        await ctx.runMutation(internal.documents.createDocument, {
          organizationId: args.organizationId,
          title: args.fileName,

          sourceProvider: providerFromMetadata,
          externalItemId,
          fileId: fileId,
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
  returns: v.object({
    success: v.boolean(),
    configId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await DocumentsModel.createOneDriveSyncConfig(ctx, args);
  },
});
