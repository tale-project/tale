'use node';

import { v, type Infer } from 'convex/values';

import type { DocumentWriteMetadata } from '../../approvals/types';

import { jsonValueValidator } from '../../../lib/shared/schemas/utils/json-value';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { normalizeDocumentWriteMetadata } from '../../approvals/types';
import { toId } from '../../lib/type_cast_helpers';

type JsonValue = Infer<typeof jsonValueValidator>;

export const executeApprovedDocumentWrite = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      threadId?: string;
      executedAt?: number;
      metadata?: unknown;
    } | null = await ctx.runQuery(
      internal.approvals.internal_queries.getApprovalById,
      { approvalId: args.approvalId },
    );

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'approved') {
      throw new Error(
        `Cannot execute document write: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'document_write') {
      throw new Error(
        `Invalid approval type: expected "document_write", got "${approval.resourceType}"`,
      );
    }

    if (approval.executedAt) {
      throw new Error('This document write approval has already been executed');
    }

    const claimed = await ctx.runMutation(
      internal.agent_tools.documents.internal_mutations
        .claimDocumentWriteForExecution,
      { approvalId: args.approvalId },
    );
    if (!claimed) {
      throw new Error('This document write approval has already been executed');
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches DocumentWriteMetadata for document_write approvals
    const rawMetadata = approval.metadata as DocumentWriteMetadata;
    const metadata = normalizeDocumentWriteMetadata(rawMetadata);

    if (!metadata.files.length) {
      throw new Error('Invalid approval metadata: no files to save');
    }

    // Create folder once if folderPath is set
    let folderId: string | null = null;
    if (metadata.folderPath) {
      folderId = await ctx.runMutation(
        internal.folders.internal_mutations.getOrCreateFolderPath,
        {
          organizationId: approval.organizationId,
          pathSegments: metadata.folderPath.split('/').filter(Boolean),
          createdBy: args.approvedBy,
        },
      );
    }

    const fileResults: Array<{
      fileId: string;
      createdDocumentId: string | null;
      executionError: string | null;
    }> = [];

    for (const file of metadata.files) {
      try {
        const fileMetadata = await ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId: toId<'_storage'>(file.fileId) },
        );

        if (!fileMetadata) {
          fileResults.push({
            fileId: file.fileId,
            createdDocumentId: null,
            executionError:
              'File no longer exists — it may have been deleted since this request was created.',
          });
          continue;
        }

        const documentId = await ctx.runMutation(
          internal.documents.internal_mutations.createDocument,
          {
            organizationId: approval.organizationId,
            title: file.title,
            fileId: toId<'_storage'>(file.fileId),
            mimeType: file.mimeType,
            sourceProvider: 'agent',
            createdBy: args.approvedBy,
            ...(folderId ? { folderId: toId<'folders'>(folderId) } : {}),
          },
        );

        fileResults.push({
          fileId: file.fileId,
          createdDocumentId: String(documentId),
          executionError: null,
        });
      } catch (error) {
        fileResults.push({
          fileId: file.fileId,
          createdDocumentId: null,
          executionError:
            error instanceof Error ? error.message : String(error),
        });
      }
    }

    await ctx.runMutation(
      internal.agent_tools.documents.internal_mutations
        .updateDocumentWriteApprovalWithResult,
      {
        approvalId: args.approvalId,
        fileResults: fileResults.map((r) => ({
          fileId: r.fileId,
          createdDocumentId: r.createdDocumentId
            ? toId<'documents'>(r.createdDocumentId)
            : null,
          executionError: r.executionError,
        })),
      },
    );

    const successCount = fileResults.filter((r) => !r.executionError).length;
    const allSucceeded = successCount === fileResults.length;

    return {
      success: allSucceeded,
      totalFiles: fileResults.length,
      successCount,
      failedCount: fileResults.length - successCount,
      results: fileResults.map((r) => ({
        fileId: r.fileId,
        documentId: r.createdDocumentId,
        error: r.executionError,
      })),
      folderPath: metadata.folderPath ?? null,
    };
  },
});
