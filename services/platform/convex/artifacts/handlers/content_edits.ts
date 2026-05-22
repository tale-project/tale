/**
 * Handler bodies + arg/return validators for content-bearing artifact
 * mutations: createArtifact, applyToolPatch, rewriteArtifact, appendToFile,
 * deleteFileFromArtifact, renameFileInArtifact. Registered by
 * `internal_mutations.ts` as the public Convex internalMutation surface.
 */

import { ConvexError, v } from 'convex/values';

import type { MutationCtx } from '../../_generated/server';
import { applySinglePatch } from '../../agent_tools/artifacts/apply_patches';
import {
  defaultEntryFileFor,
  normalizeTitleForCompare,
  normalizeTitleForStorage,
  validatePath,
} from '../../agent_tools/artifacts/shared';
import { mirrorLegacyContent, resolveArtifactFiles } from '../resolve_files';
import { artifactTypeValidator } from '../schema';
import {
  clearStreamingFlags,
  trimRevisionHistory,
  validateFiles,
} from './shared';

// =============================================================================
// createArtifact — idempotent on (thread, type, normalized-title)
// =============================================================================

export const createArtifactArgs = {
  organizationId: v.string(),
  threadId: v.string(),
  type: artifactTypeValidator,
  title: v.string(),
  language: v.optional(v.string()),
  /** Initial content for the entry file; required for runnable/mermaid/svg/html. */
  content: v.optional(v.string()),
  /** Optional entry-file override. Defaults from `defaultEntryFileFor(type, language)`. */
  entryFile: v.optional(v.string()),
  createdByMessageId: v.string(),
} as const;

export const createArtifactReturns = v.union(
  v.object({
    success: v.literal(true),
    isNew: v.boolean(),
    artifactId: v.id('artifacts'),
    revision: v.number(),
    entryFile: v.string(),
    filePaths: v.array(v.string()),
  }),
  v.object({
    success: v.literal(false),
    conflict: v.literal('type_mismatch'),
    existingArtifactId: v.id('artifacts'),
    existingType: artifactTypeValidator,
    message: v.string(),
  }),
);

export async function createArtifactHandler(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    threadId: string;
    type:
      | 'html'
      | 'svg'
      | 'markdown'
      | 'mermaid'
      | 'code'
      | 'python_runnable'
      | 'node_runnable';
    title: string;
    language?: string;
    content?: string;
    entryFile?: string;
    createdByMessageId: string;
  },
) {
  const storedTitle = normalizeTitleForStorage(args.title);
  if (storedTitle.length === 0) {
    throw new ConvexError({
      code: 'invalid_title',
      message: 'Title must contain at least one non-whitespace character.',
    });
  }
  const compareKey = normalizeTitleForCompare(args.title);

  // Idempotency scan.
  for await (const row of ctx.db
    .query('artifacts')
    .withIndex('by_organizationId_and_thread', (q) =>
      q.eq('organizationId', args.organizationId).eq('threadId', args.threadId),
    )) {
    const rowKey = normalizeTitleForCompare(row.title);
    if (rowKey !== compareKey) continue;
    if (row.type !== args.type) {
      return {
        success: false as const,
        conflict: 'type_mismatch' as const,
        existingArtifactId: row._id,
        existingType: row.type,
        message: `An artifact titled "${row.title}" already exists in this thread with type "${row.type}". Either pick a different title or use the existing artifactId ${row._id} via artifact_edit.`,
      };
    }
    // Title + type match → return existing. Do NOT overwrite content.
    const resolved = resolveArtifactFiles(row);
    return {
      success: true as const,
      isNew: false,
      artifactId: row._id,
      revision: row.revision,
      entryFile: resolved.entryFile,
      filePaths: resolved.files.map((f) => f.path),
    };
  }

  // No collision — insert new artifact.
  const entryFile = validatePath(
    args.entryFile ?? defaultEntryFileFor(args.type, args.language),
  );
  const initialContent = args.content ?? '';
  const files = validateFiles([{ path: entryFile, content: initialContent }]);
  const now = Date.now();
  const artifactId = await ctx.db.insert('artifacts', {
    organizationId: args.organizationId,
    threadId: args.threadId,
    type: args.type,
    title: storedTitle,
    language: args.language,
    files,
    entryFile,
    content: mirrorLegacyContent(files, entryFile),
    revision: 1,
    createdByMessageId: args.createdByMessageId,
    lastEditedByMessageId: args.createdByMessageId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId,
    revision: 1,
    content: mirrorLegacyContent(files, entryFile),
    files,
    entryFile,
    filePath: entryFile,
    editedByMessageId: args.createdByMessageId,
    editKind: 'create',
    createdAt: now,
  });
  return {
    success: true as const,
    isNew: true,
    artifactId,
    revision: 1,
    entryFile,
    filePaths: files.map((f) => f.path),
  };
}

// =============================================================================
// applyToolPatch — single search/replace on one file
// =============================================================================

export const applyToolPatchArgs = {
  artifactId: v.id('artifacts'),
  path: v.string(),
  search: v.string(),
  replace: v.string(),
  replaceAll: v.optional(v.boolean()),
  editedByMessageId: v.string(),
  /** OCC baseline. Mismatch → stale error so the LLM re-reads. */
  expectedRevision: v.number(),
} as const;

export const applyToolPatchReturns = v.union(
  v.object({
    success: v.literal(true),
    revision: v.number(),
    path: v.string(),
    content: v.string(),
    matchCount: v.number(),
  }),
  v.object({
    success: v.literal(false),
    code: v.union(
      v.literal('not_found'),
      v.literal('stale'),
      v.literal('file_missing'),
      v.literal('file_empty'),
      v.literal('no_match'),
      v.literal('ambiguous_match'),
    ),
    message: v.string(),
    currentRevision: v.optional(v.number()),
    matchCount: v.optional(v.number()),
  }),
);

export async function applyToolPatchHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
    editedByMessageId: string;
    expectedRevision: number;
  },
) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact) {
    return {
      success: false as const,
      code: 'not_found' as const,
      message: `Artifact ${args.artifactId} not found.`,
    };
  }
  if (artifact.revision !== args.expectedRevision) {
    return {
      success: false as const,
      code: 'stale' as const,
      message: `Artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read with artifact_read and retry.`,
      currentRevision: artifact.revision,
    };
  }
  const path = validatePath(args.path);
  const resolved = resolveArtifactFiles(artifact);
  const target = resolved.files.find((f) => f.path === path);
  if (!target) {
    return {
      success: false as const,
      code: 'file_missing' as const,
      message: `File "${path}" does not exist in this artifact. Existing paths: ${resolved.files
        .map((f) => f.path)
        .join(', ')}. To create it, call artifact_edit with mode='rewrite'.`,
    };
  }
  if (target.content.length === 0) {
    return {
      success: false as const,
      code: 'file_empty' as const,
      message: `File "${path}" is empty. Use mode='rewrite' to write its initial content.`,
    };
  }

  let nextContent: string;
  let matchCount: number;
  if (args.replaceAll === true) {
    if (args.search.length === 0) {
      return {
        success: false as const,
        code: 'no_match' as const,
        message:
          'search block is empty — refusing to apply (would match anywhere).',
      };
    }
    const split = target.content.split(args.search);
    matchCount = split.length - 1;
    if (matchCount === 0) {
      return {
        success: false as const,
        code: 'no_match' as const,
        message: `search block matched 0 times in "${path}". Re-read the file and emit a snippet that appears verbatim.`,
        matchCount: 0,
      };
    }
    nextContent = split.join(args.replace);
  } else {
    const result = applySinglePatch(target.content, {
      search: args.search,
      replace: args.replace,
    });
    if (!result.ok) {
      const isAmbiguous = /matched more than once/.test(result.error);
      return {
        success: false as const,
        code: isAmbiguous
          ? ('ambiguous_match' as const)
          : ('no_match' as const),
        message: result.error,
        matchCount: isAmbiguous ? 2 : 0,
      };
    }
    nextContent = result.content;
    matchCount = 1;
  }

  const nextFiles = resolved.files.map((f) =>
    f.path === path ? { path, content: nextContent } : f,
  );
  const validatedFiles = validateFiles(nextFiles);
  const nextRevision = artifact.revision + 1;
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    files: validatedFiles,
    entryFile: resolved.entryFile,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    revision: nextRevision,
    lastEditedByMessageId: args.editedByMessageId,
    ...clearStreamingFlags(),
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: nextRevision,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    files: validatedFiles,
    entryFile: resolved.entryFile,
    filePath: path,
    editedByMessageId: args.editedByMessageId,
    editKind: 'patch',
    patches: [{ search: args.search, replace: args.replace }],
    createdAt: now,
  });
  await trimRevisionHistory(ctx, args.artifactId);
  return {
    success: true as const,
    revision: nextRevision,
    path,
    content: nextContent,
    matchCount,
  };
}

// =============================================================================
// rewriteArtifact — write whole content of one file; creates if missing
// =============================================================================

export const rewriteArtifactArgs = {
  artifactId: v.id('artifacts'),
  path: v.string(),
  content: v.string(),
  editedByMessageId: v.string(),
  expectedRevision: v.number(),
} as const;

export const rewriteArtifactReturns = v.union(
  v.object({
    success: v.literal(true),
    revision: v.number(),
    path: v.string(),
    created: v.boolean(),
  }),
  v.object({
    success: v.literal(false),
    code: v.union(v.literal('not_found'), v.literal('stale')),
    message: v.string(),
    currentRevision: v.optional(v.number()),
  }),
);

export async function rewriteArtifactHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    path: string;
    content: string;
    editedByMessageId: string;
    expectedRevision: number;
  },
) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact) {
    return {
      success: false as const,
      code: 'not_found' as const,
      message: `Artifact ${args.artifactId} not found.`,
    };
  }
  if (artifact.revision !== args.expectedRevision) {
    return {
      success: false as const,
      code: 'stale' as const,
      message: `Artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read with artifact_read and retry.`,
      currentRevision: artifact.revision,
    };
  }
  const path = validatePath(args.path);
  const resolved = resolveArtifactFiles(artifact);
  const existingIdx = resolved.files.findIndex((f) => f.path === path);
  let nextFiles: { path: string; content: string }[];
  let created = false;
  if (existingIdx >= 0) {
    nextFiles = resolved.files.map((f) =>
      f.path === path ? { path, content: args.content } : f,
    );
  } else {
    nextFiles = [...resolved.files, { path, content: args.content }];
    created = true;
  }
  const validatedFiles = validateFiles(nextFiles);
  const nextRevision = artifact.revision + 1;
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    files: validatedFiles,
    entryFile: resolved.entryFile,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    revision: nextRevision,
    lastEditedByMessageId: args.editedByMessageId,
    ...clearStreamingFlags(),
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: nextRevision,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    files: validatedFiles,
    entryFile: resolved.entryFile,
    filePath: path,
    editedByMessageId: args.editedByMessageId,
    editKind: 'rewrite',
    createdAt: now,
  });
  await trimRevisionHistory(ctx, args.artifactId);
  return {
    success: true as const,
    revision: nextRevision,
    path,
    created,
  };
}

// =============================================================================
// appendToFile — concat content to the end of one file; creates if missing
// =============================================================================

export const appendToFileArgs = {
  artifactId: v.id('artifacts'),
  path: v.string(),
  content: v.string(),
  editedByMessageId: v.string(),
  expectedRevision: v.number(),
} as const;

export const appendToFileReturns = v.union(
  v.object({
    success: v.literal(true),
    revision: v.number(),
    path: v.string(),
    created: v.boolean(),
    byteLength: v.number(),
  }),
  v.object({
    success: v.literal(false),
    code: v.union(v.literal('not_found'), v.literal('stale')),
    message: v.string(),
    currentRevision: v.optional(v.number()),
  }),
);

export async function appendToFileHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    path: string;
    content: string;
    editedByMessageId: string;
    expectedRevision: number;
  },
) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact) {
    return {
      success: false as const,
      code: 'not_found' as const,
      message: `Artifact ${args.artifactId} not found.`,
    };
  }
  if (artifact.revision !== args.expectedRevision) {
    return {
      success: false as const,
      code: 'stale' as const,
      message: `Artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read with artifact_read and retry.`,
      currentRevision: artifact.revision,
    };
  }
  const path = validatePath(args.path);
  const resolved = resolveArtifactFiles(artifact);
  const existingIdx = resolved.files.findIndex((f) => f.path === path);
  let nextFiles: { path: string; content: string }[];
  let created = false;
  let nextByteLength: number;
  if (existingIdx >= 0) {
    const concatenated = resolved.files[existingIdx].content + args.content;
    nextByteLength = concatenated.length;
    nextFiles = resolved.files.map((f) =>
      f.path === path ? { path, content: concatenated } : f,
    );
  } else {
    nextByteLength = args.content.length;
    nextFiles = [...resolved.files, { path, content: args.content }];
    created = true;
  }
  const validatedFiles = validateFiles(nextFiles);
  const nextRevision = artifact.revision + 1;
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    files: validatedFiles,
    entryFile: resolved.entryFile,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    revision: nextRevision,
    lastEditedByMessageId: args.editedByMessageId,
    ...clearStreamingFlags(),
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: nextRevision,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    files: validatedFiles,
    entryFile: resolved.entryFile,
    filePath: path,
    editedByMessageId: args.editedByMessageId,
    editKind: 'append',
    createdAt: now,
  });
  await trimRevisionHistory(ctx, args.artifactId);
  return {
    success: true as const,
    revision: nextRevision,
    path,
    created,
    byteLength: nextByteLength,
  };
}

// =============================================================================
// deleteFileFromArtifact — refuses on entryFile and on last-file
// =============================================================================

export const deleteFileFromArtifactArgs = {
  artifactId: v.id('artifacts'),
  path: v.string(),
  editedByMessageId: v.string(),
  expectedRevision: v.number(),
} as const;

export const deleteFileFromArtifactReturns = v.union(
  v.object({
    success: v.literal(true),
    revision: v.number(),
    path: v.string(),
  }),
  v.object({
    success: v.literal(false),
    code: v.union(
      v.literal('not_found'),
      v.literal('stale'),
      v.literal('file_missing'),
      v.literal('entry_pin'),
      v.literal('last_file'),
    ),
    message: v.string(),
    currentRevision: v.optional(v.number()),
    entryFile: v.optional(v.string()),
  }),
);

export async function deleteFileFromArtifactHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    path: string;
    editedByMessageId: string;
    expectedRevision: number;
  },
) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact) {
    return {
      success: false as const,
      code: 'not_found' as const,
      message: `Artifact ${args.artifactId} not found.`,
    };
  }
  if (artifact.revision !== args.expectedRevision) {
    return {
      success: false as const,
      code: 'stale' as const,
      message: `Artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read with artifact_read and retry.`,
      currentRevision: artifact.revision,
    };
  }
  const path = validatePath(args.path);
  const resolved = resolveArtifactFiles(artifact);
  if (!resolved.files.some((f) => f.path === path)) {
    return {
      success: false as const,
      code: 'file_missing' as const,
      message: `File "${path}" does not exist in this artifact.`,
    };
  }
  if (path === resolved.entryFile) {
    return {
      success: false as const,
      code: 'entry_pin' as const,
      message: `Cannot delete entry file "${path}". Call artifact_edit with mode='set_entry' to repoint first, or rename it.`,
      entryFile: resolved.entryFile,
    };
  }
  if (resolved.files.length <= 1) {
    return {
      success: false as const,
      code: 'last_file' as const,
      message: `Cannot delete the only file in an artifact. Delete the artifact instead.`,
    };
  }
  const nextFiles = resolved.files.filter((f) => f.path !== path);
  const validatedFiles = validateFiles(nextFiles);
  const nextRevision = artifact.revision + 1;
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    files: validatedFiles,
    entryFile: resolved.entryFile,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    revision: nextRevision,
    lastEditedByMessageId: args.editedByMessageId,
    ...clearStreamingFlags(),
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: nextRevision,
    content: mirrorLegacyContent(validatedFiles, resolved.entryFile),
    files: validatedFiles,
    entryFile: resolved.entryFile,
    filePath: path,
    editedByMessageId: args.editedByMessageId,
    editKind: 'file_delete',
    createdAt: now,
  });
  await trimRevisionHistory(ctx, args.artifactId);
  return {
    success: true as const,
    revision: nextRevision,
    path,
  };
}

// =============================================================================
// renameFileInArtifact — atomic; repoints entryFile if from === entryFile
// =============================================================================

export const renameFileInArtifactArgs = {
  artifactId: v.id('artifacts'),
  from: v.string(),
  to: v.string(),
  editedByMessageId: v.string(),
  expectedRevision: v.number(),
} as const;

export const renameFileInArtifactReturns = v.union(
  v.object({
    success: v.literal(true),
    revision: v.number(),
    from: v.string(),
    to: v.string(),
    entryFile: v.string(),
    entryUpdated: v.boolean(),
  }),
  v.object({
    success: v.literal(false),
    code: v.union(
      v.literal('not_found'),
      v.literal('stale'),
      v.literal('file_missing'),
      v.literal('path_exists'),
    ),
    message: v.string(),
    currentRevision: v.optional(v.number()),
  }),
);

export async function renameFileInArtifactHandler(
  ctx: MutationCtx,
  args: {
    artifactId: import('../../_generated/dataModel').Id<'artifacts'>;
    from: string;
    to: string;
    editedByMessageId: string;
    expectedRevision: number;
  },
) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact) {
    return {
      success: false as const,
      code: 'not_found' as const,
      message: `Artifact ${args.artifactId} not found.`,
    };
  }
  if (artifact.revision !== args.expectedRevision) {
    return {
      success: false as const,
      code: 'stale' as const,
      message: `Artifact has been modified since you last read it (revision ${artifact.revision}, you sent ${args.expectedRevision}). Re-read with artifact_read and retry.`,
      currentRevision: artifact.revision,
    };
  }
  const from = validatePath(args.from);
  const to = validatePath(args.to);
  const resolved = resolveArtifactFiles(artifact);
  // Idempotent: from === to → no-op success.
  if (from === to) {
    return {
      success: true as const,
      revision: artifact.revision,
      from,
      to,
      entryFile: resolved.entryFile,
      entryUpdated: false,
    };
  }
  if (!resolved.files.some((f) => f.path === from)) {
    return {
      success: false as const,
      code: 'file_missing' as const,
      message: `File "${from}" does not exist in this artifact.`,
    };
  }
  if (resolved.files.some((f) => f.path === to)) {
    return {
      success: false as const,
      code: 'path_exists' as const,
      message: `Target path "${to}" already exists. Delete it first or pick a different name.`,
    };
  }
  const nextFiles = resolved.files.map((f) =>
    f.path === from ? { path: to, content: f.content } : f,
  );
  const validatedFiles = validateFiles(nextFiles);
  const entryUpdated = from === resolved.entryFile;
  const nextEntry = entryUpdated ? to : resolved.entryFile;
  const nextRevision = artifact.revision + 1;
  const now = Date.now();
  await ctx.db.patch(args.artifactId, {
    files: validatedFiles,
    entryFile: nextEntry,
    content: mirrorLegacyContent(validatedFiles, nextEntry),
    revision: nextRevision,
    lastEditedByMessageId: args.editedByMessageId,
    ...clearStreamingFlags(),
    updatedAt: now,
  });
  await ctx.db.insert('artifactRevisions', {
    artifactId: args.artifactId,
    revision: nextRevision,
    content: mirrorLegacyContent(validatedFiles, nextEntry),
    files: validatedFiles,
    entryFile: nextEntry,
    filePath: to,
    fromPath: from,
    editedByMessageId: args.editedByMessageId,
    editKind: 'file_rename',
    createdAt: now,
  });
  await trimRevisionHistory(ctx, args.artifactId);
  return {
    success: true as const,
    revision: nextRevision,
    from,
    to,
    entryFile: nextEntry,
    entryUpdated,
  };
}
