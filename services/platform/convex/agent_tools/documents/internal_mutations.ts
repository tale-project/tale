import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { DocumentWriteMetadata } from '../../approvals/types';

import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';
import { normalizeDocumentWriteMetadata } from '../../approvals/types';

type ApprovalMetadata = Doc<'approvals'>['metadata'];

export const createDocumentWriteApproval = internalMutation({
  args: {
    organizationId: v.string(),
    files: v.array(
      v.object({
        fileId: v.string(),
        fileName: v.string(),
        title: v.string(),
        mimeType: v.string(),
        fileSize: v.number(),
      }),
    ),
    folderPath: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const metadata: DocumentWriteMetadata = {
      files: args.files.map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        title: f.title,
        mimeType: f.mimeType,
        fileSize: f.fileSize,
      })),
      folderPath: args.folderPath,
      requestedAt: Date.now(),
    };

    const fileCount = args.files.length;
    const firstTitle = args.files[0]?.title ?? 'untitled';
    const description =
      fileCount === 1
        ? `Save to knowledge base: ${firstTitle}${args.folderPath ? ` in ${args.folderPath}` : ''}`
        : `Save ${fileCount} files to knowledge base${args.folderPath ? ` in ${args.folderPath}` : ''}`;

    return await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'document_write',
      resourceId: `document_write:batch:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      priority: 'medium',
      description,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });
  },
});

export const claimDocumentWriteForExecution = internalMutation({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return false;
    await ctx.db.patch(args.approvalId, { executedAt: Date.now() });
    return true;
  },
});

export const updateDocumentWriteApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    fileResults: v.array(
      v.object({
        fileId: v.string(),
        createdDocumentId: v.union(v.id('documents'), v.null()),
        executionError: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches DocumentWriteMetadata for document_write approvals
    const rawMetadata = (approval.metadata || {}) as DocumentWriteMetadata;
    const metadata = normalizeDocumentWriteMetadata(rawMetadata);

    const resultMap = new Map(
      args.fileResults.map((r) => [r.fileId, r] as const),
    );

    const updatedFiles = metadata.files.map((file) => {
      const result = resultMap.get(file.fileId);
      if (!result) return file;
      return {
        ...file,
        ...(result.createdDocumentId
          ? { createdDocumentId: String(result.createdDocumentId) }
          : {}),
        ...(result.executionError
          ? { executionError: result.executionError }
          : {}),
      };
    });

    const hasErrors = args.fileResults.some((r) => r.executionError);
    const now = Date.now();

    await ctx.db.patch(args.approvalId, {
      executedAt: now,
      executionError: hasErrors ? 'Some files failed to save' : undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- constructing approval metadata from known DocumentWriteMetadata fields
      metadata: {
        ...metadata,
        files: updatedFiles,
        executedAt: now,
      } as ApprovalMetadata,
    });
  },
});
