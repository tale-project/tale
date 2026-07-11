/**
 * Public, org-gated document helpers for automation Forms that need to seed a
 * project folder with a text file (blob + fileId). Sandbox staging skips
 * content-only document rows — callers must go through storage.
 *
 * Generic on purpose: packs pass folder/file names and body; the platform
 * never hardcodes product-specific setup slugs.
 */
import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { serializeYamlMap, YamlMapError } from './serialize_yaml_map';

function extractExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  if (i <= 0 || i === fileName.length - 1) return 'txt';
  return fileName.slice(i + 1).toLowerCase();
}

function validateFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: 'INVALID_ARGUMENT',
      message: 'fileName is required',
    });
  }
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    throw new ConvexError({
      code: 'INVALID_ARGUMENT',
      message: 'fileName cannot contain path separators',
    });
  }
  return trimmed;
}

function resolveBody(args: {
  content?: string;
  yaml?: Record<string, string>;
}): string {
  const hasContent = args.content !== undefined;
  const hasYaml = args.yaml !== undefined;
  if (hasContent === hasYaml) {
    throw new ConvexError({
      code: 'INVALID_ARGUMENT',
      message: 'Provide exactly one of content or yaml',
    });
  }
  if (args.content !== undefined) {
    return args.content;
  }
  if (args.yaml === undefined) {
    throw new ConvexError({
      code: 'INVALID_ARGUMENT',
      message: 'Provide exactly one of content or yaml',
    });
  }
  try {
    return serializeYamlMap(args.yaml);
  } catch (err) {
    if (err instanceof YamlMapError) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENT',
        message: err.message,
      });
    }
    throw err;
  }
}

/**
 * Ensure a top-level project folder exists and upsert a text document into it
 * as a stored blob. Idempotent via `externalItemId` (defaults to a stable
 * project+folder+file key).
 */
export const ensureProjectTextDocument = action({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    folderName: v.string(),
    fileName: v.string(),
    content: v.optional(v.string()),
    yaml: v.optional(v.record(v.string(), v.string())),
    contentType: v.optional(v.string()),
    externalItemId: v.optional(v.string()),
  },
  returns: v.object({
    folderId: v.id('folders'),
    documentId: v.id('documents'),
    createdFolder: v.boolean(),
    action: v.union(
      v.literal('created'),
      v.literal('updated'),
      v.literal('skipped'),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    folderId: Id<'folders'>;
    documentId: Id<'documents'>;
    createdFolder: boolean;
    action: 'created' | 'updated' | 'skipped';
  }> => {
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);

    const fileName = validateFileName(args.fileName);
    const body = resolveBody({ content: args.content, yaml: args.yaml });
    const extension = extractExtension(fileName);
    const contentType =
      args.contentType ??
      (extension === 'yaml' || extension === 'yml'
        ? 'text/yaml'
        : 'text/plain');
    const externalItemId =
      args.externalItemId?.trim() ||
      `project-text:${args.projectId}:${args.folderName.trim()}:${fileName}`;

    const folder = await ctx.runMutation(
      internal.folders.internal_mutations.getOrCreateProjectRootFolder,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        name: args.folderName,
        userId,
      },
    );

    const stored = await ctx.runAction(
      internal.documents.internal_actions.storeRawContent,
      {
        organizationId: args.organizationId,
        fileName,
        content: body,
        contentType,
        extension,
      },
    );
    if (!stored.success || !stored.fileStorageId) {
      throw new ConvexError({
        code: 'STORAGE_FAILED',
        message: 'Failed to store document content',
      });
    }

    const upserted = await ctx.runMutation(
      internal.documents.internal_mutations.upsertDocumentByExternalId,
      {
        organizationId: args.organizationId,
        externalItemId,
        title: fileName,
        fileId: stored.fileStorageId,
        mimeType: contentType,
        extension,
        folderId: folder.folderId,
        createdBy: userId,
      },
    );

    return {
      folderId: folder.folderId,
      documentId: upserted.documentId,
      createdFolder: folder.created,
      action: upserted.action,
    };
  },
});
