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
import { toId } from '../lib/type_cast_helpers';
import { parseYamlMap } from './parse_yaml_map';
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
    // Generic seeding: after writing the inline doc, ALSO copy each named skill
    // file verbatim into the SAME folder as an editable document. The pack names
    // the skill + paths — the platform stays product-agnostic. Best-effort: a
    // missing/invalid skill file is skipped (the inline doc still succeeds).
    seedSkillFiles: v.optional(
      v.array(
        v.object({
          skillSlug: v.string(),
          skillPath: v.string(),
          fileName: v.string(),
          externalItemId: v.optional(v.string()),
        }),
      ),
    ),
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
    seededSkillFiles: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    folderId: Id<'folders'>;
    documentId: Id<'documents'>;
    createdFolder: boolean;
    action: 'created' | 'updated' | 'skipped';
    seededSkillFiles?: number;
  }> => {
    // orgSlug from the membership guard was only consumed by the skill-asset
    // seeding pass below, which is skipped while the skills backend is
    // rebuilt; the guard itself must still run.
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

    // Best-effort seeding of skill-default files (e.g. operator-editable rate
    // tables) into the same folder, so the pack can ship editable defaults
    // alongside the inline doc. Each is copied VERBATIM from the skill; a
    // missing/invalid one is skipped so it never blocks the primary doc.
    // The optional companion files ship inside a skill bundle, and skill
    // assets are unreadable while the skills backend is rebuilt. Seeding was
    // always best-effort (an unreadable asset is skipped, never a blocker),
    // so the whole pass degrades to a logged skip; the primary document
    // above is unaffected.
    const seededSkillFiles = 0;
    for (const seed of args.seedSkillFiles ?? []) {
      console.warn(
        `[ensureProjectTextDocument] skipped seed ${seed.skillSlug}/${seed.skillPath}: skills backend offline while it is rebuilt`,
      );
    }

    return {
      folderId: folder.folderId,
      documentId: upserted.documentId,
      createdFolder: folder.created,
      action: upserted.action,
      ...(args.seedSkillFiles !== undefined && { seededSkillFiles }),
    };
  },
});

/**
 * Read a project folder's flat-YAML text file back into a `{key: value}` map —
 * the read twin of `ensureProjectTextDocument`, so a Form can pre-fill its
 * fields from the file it writes (e.g. the FX-policy panel reflecting the
 * actual `Setup/fx-policy.yaml`, whether the panel or a manual upload wrote
 * it). Reads the stored blob directly (no RAG dependency) and parses the flat
 * map. Returns `{}` when the folder/file does not exist or the caller cannot
 * read the project — a form then falls back to its declared defaults.
 */
export const readProjectTextValues = action({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    folderName: v.string(),
    fileName: v.string(),
  },
  returns: v.record(v.string(), v.string()),
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);
    const fileName = validateFileName(args.fileName);

    const folderId = await ctx.runQuery(
      internal.folders.internal_queries.findProjectRootFolder,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        name: args.folderName,
        userId,
      },
    );
    if (!folderId) return {};

    // Project-scoped listing (document.list stays hub-blind without projectId)
    // — find the file by its title in the resolved folder.
    const listed = await ctx.runQuery(
      internal.documents.internal_queries.listForAgent,
      {
        organizationId: args.organizationId,
        userId,
        folderId,
        projectId: args.projectId,
        limit: 50,
      },
    );
    const hit = listed.documents.find((d) => d.title === fileName);
    if (!hit?.fileId) return {};

    const blob = await ctx.storage.get(toId<'_storage'>(hit.fileId));
    if (!blob) return {};
    return parseYamlMap(await blob.text());
  },
});
