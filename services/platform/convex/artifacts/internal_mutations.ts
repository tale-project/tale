import { type Infer, ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { applySinglePatch } from '../agent_tools/artifacts/apply_patches';
import {
  MAX_FILES_PER_ARTIFACT,
  defaultEntryFileFor,
  findDuplicatePath,
  normalizeTitleForCompare,
  normalizeTitleForStorage,
  validatePath,
} from '../agent_tools/artifacts/shared';
import {
  sandboxRunProgressValidator,
  sandboxTerminalStatuses,
} from '../sandbox/wire';
import {
  aggregateFileBytes,
  mirrorLegacyContent,
  resolveArtifactFiles,
} from './resolve_files';
import {
  artifactPatchValidator,
  artifactRunErrorCodeValidator,
  artifactRunOutputFileValidator,
  artifactRunStatusValidator,
  artifactTypeValidator,
  liveStreamModeValidator,
} from './schema';

type ArtifactRunErrorCode = Infer<typeof artifactRunErrorCodeValidator>;
type ArtifactRunOutputFile = Infer<typeof artifactRunOutputFileValidator>;

const STALE_STREAM_THRESHOLD_MS = 60_000;
const HEARTBEAT_THROTTLE_MS = 5_000;

/**
 * Hard cap on an artifact's TOTAL content (sum of all `files[].content` bytes).
 * Convex's per-document limit is 1 MiB; we cap below that so a single mutation
 * that also writes a revision row (full files snapshot) stays under the limit,
 * and so an LLM rewrite that runs away yields a clean `too_large` error.
 */
export const MAX_ARTIFACT_BYTES = 800_000;

/** Lazy-GC retention: keep the N most recent revisions per artifact. */
const REVISIONS_RETENTION = 20;

/**
 * @deprecated — single-file size check. Kept for backward-compat with
 * existing callers; new code should use {@link assertAggregateSize}.
 */
export function assertContentSize(content: string): void {
  const size = new TextEncoder().encode(content).byteLength;
  if (size > MAX_ARTIFACT_BYTES) {
    throw new ConvexError({
      code: 'too_large',
      message: `Artifact content is ${size} bytes; max ${MAX_ARTIFACT_BYTES}.`,
    });
  }
}

export function assertAggregateSize(
  files: readonly { readonly content: string }[],
): void {
  const size = aggregateFileBytes(files);
  if (size > MAX_ARTIFACT_BYTES) {
    throw new ConvexError({
      code: 'too_large',
      message: `Artifact total content is ${size} bytes across ${files.length} files; max ${MAX_ARTIFACT_BYTES}.`,
    });
  }
}

/**
 * Central source of truth for the field set that "ends a stream." Every
 * settle / abort / cleanup path patches these to `undefined` together so
 * the canvas pane reliably transitions out of the live state.
 */
function clearStreamingFlags(): Partial<Doc<'artifacts'>> {
  return {
    streamingContent: undefined,
    streamingPatches: undefined,
    streamingPath: undefined,
    liveStreamMode: undefined,
    liveStreamStartedAt: undefined,
    toolCallId: undefined,
  };
}

/**
 * Lazy GC of revision history. Called at the tail of every revision-emitting
 * mutation. Keeps the {@link REVISIONS_RETENTION} most recent revisions and
 * deletes older ones opportunistically. No cron — per memory
 * feedback_lazy_cleanup_over_cron.
 */
async function trimRevisionHistory(
  ctx: MutationCtx,
  artifactId: Id<'artifacts'>,
): Promise<void> {
  const rows: { _id: Id<'artifactRevisions'>; revision: number }[] = [];
  for await (const row of ctx.db
    .query('artifactRevisions')
    .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))
    .order('desc')) {
    rows.push({ _id: row._id, revision: row.revision });
    if (rows.length > REVISIONS_RETENTION * 2) break; // safety bound
  }
  if (rows.length <= REVISIONS_RETENTION) return;
  for (let i = REVISIONS_RETENTION; i < rows.length; i += 1) {
    await ctx.db.delete(rows[i]._id);
  }
}

/**
 * Validate + canonicalize the file list before any write. Throws on path
 * violations, oversize, duplicate paths, or empty files array. Returns the
 * NFC-normalized file list.
 */
function validateFiles(
  input: readonly { readonly path: string; readonly content: string }[],
): { readonly path: string; readonly content: string }[] {
  if (input.length === 0) {
    throw new ConvexError({
      code: 'empty_project',
      message: 'Artifact must contain at least one file.',
    });
  }
  if (input.length > MAX_FILES_PER_ARTIFACT) {
    throw new ConvexError({
      code: 'too_many_files',
      message: `Artifact has ${input.length} files; max ${MAX_FILES_PER_ARTIFACT}.`,
    });
  }
  const normalized = input.map((f) => ({
    path: validatePath(f.path),
    content: f.content,
  }));
  const dup = findDuplicatePath(normalized);
  if (dup !== null) {
    throw new ConvexError({
      code: 'duplicate_path',
      message: `Duplicate file path "${dup}" (paths are compared case-insensitively).`,
    });
  }
  assertAggregateSize(normalized);
  return normalized;
}

// =============================================================================
// createArtifact — idempotent on (thread, type, normalized-title)
// =============================================================================

/**
 * Create a new artifact OR return an existing one. Idempotency key is
 * `(organizationId, threadId, type, normalizeTitleForCompare(title))`.
 *
 * - On `isNew: true` with content supplied: writes `files: [{path: entryFile, content}]`
 *   at revision 1, mirrors `content`, writes a `create` revision row.
 * - On `isNew: true` without content: writes an empty entry file at revision 1.
 *   The LLM must follow up with `artifact_edit(rewrite)` to populate.
 * - On collision: returns the existing artifact's full state. Content is NOT
 *   overwritten — the LLM must call `artifact_edit(rewrite)` if intended.
 * - On type mismatch (same title, different type): returns `conflict: 'type_mismatch'`.
 *
 * The dedup scan uses the existing `by_organizationId_and_thread` index — no
 * new index needed at this scale.
 */
export const createArtifact = internalMutation({
  args: {
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
  },
  returns: v.union(
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
  ),
  handler: async (ctx, args) => {
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
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.threadId),
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
  },
});

// =============================================================================
// applyToolPatch — single search/replace on one file
// =============================================================================

export const applyToolPatch = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    path: v.string(),
    search: v.string(),
    replace: v.string(),
    replaceAll: v.optional(v.boolean()),
    editedByMessageId: v.string(),
    /** OCC baseline. Mismatch → stale error so the LLM re-reads. */
    expectedRevision: v.number(),
  },
  returns: v.union(
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
  ),
  handler: async (ctx, args) => {
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
      // Multi-site replace. Walk indexOf so an empty-search guard is still active.
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
  },
});

// =============================================================================
// rewriteArtifact — write whole content of one file; creates if missing
// =============================================================================

export const rewriteArtifact = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    path: v.string(),
    content: v.string(),
    editedByMessageId: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.union(
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
  ),
  handler: async (ctx, args) => {
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
  },
});

// =============================================================================
// deleteFileFromArtifact — refuses on entryFile and on last-file
// =============================================================================

export const deleteFileFromArtifact = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    path: v.string(),
    editedByMessageId: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.union(
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
  ),
  handler: async (ctx, args) => {
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
  },
});

// =============================================================================
// renameFileInArtifact — atomic, repoints entryFile if from === entryFile
// =============================================================================

export const renameFileInArtifact = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    from: v.string(),
    to: v.string(),
    editedByMessageId: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.union(
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
  ),
  handler: async (ctx, args) => {
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
  },
});

// =============================================================================
// setArtifactEntry — repoint entryFile without touching file content
// =============================================================================

export const setArtifactEntry = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    entryFile: v.string(),
    editedByMessageId: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      revision: v.number(),
      entryFile: v.string(),
    }),
    v.object({
      success: v.literal(false),
      code: v.union(
        v.literal('not_found'),
        v.literal('stale'),
        v.literal('file_missing'),
        v.literal('noop'),
      ),
      message: v.string(),
      currentRevision: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
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
    const newEntry = validatePath(args.entryFile);
    const resolved = resolveArtifactFiles(artifact);
    if (newEntry === resolved.entryFile) {
      return {
        success: false as const,
        code: 'noop' as const,
        message: `Entry file is already "${newEntry}".`,
      };
    }
    if (!resolved.files.some((f) => f.path === newEntry)) {
      return {
        success: false as const,
        code: 'file_missing' as const,
        message: `File "${newEntry}" does not exist in this artifact. Create it via artifact_edit(mode='rewrite') first.`,
      };
    }
    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      entryFile: newEntry,
      files: resolved.synthesized
        ? [...resolved.files]
        : (artifact.files ?? [...resolved.files]),
      content: mirrorLegacyContent(resolved.files, newEntry),
      revision: nextRevision,
      lastEditedByMessageId: args.editedByMessageId,
      ...clearStreamingFlags(),
      updatedAt: now,
    });
    // Compact metadata-only revision: no `files`/`content` snapshot.
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: nextRevision,
      entryFile: newEntry,
      editedByMessageId: args.editedByMessageId,
      editKind: 'set_entry',
      createdAt: now,
    });
    await trimRevisionHistory(ctx, args.artifactId);
    return {
      success: true as const,
      revision: nextRevision,
      entryFile: newEntry,
    };
  },
});

// =============================================================================
// Streaming lifecycle
// =============================================================================

export const beginEditStream = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    liveStreamMode: liveStreamModeValidator,
    /** For mode='rewrite': the file path being streamed (advisory). */
    streamingPath: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) {
      throw new ConvexError({
        code: 'not_found',
        message: `Artifact ${args.artifactId} not found.`,
      });
    }
    // Refuse if another stream is already in flight on this row.
    if (row.liveStreamMode !== undefined) {
      throw new ConvexError({
        code: 'streaming_in_progress',
        message: `Another edit is already streaming to artifact ${args.artifactId} (mode: ${row.liveStreamMode}). Wait for it to settle.`,
      });
    }
    const validatedPath =
      args.streamingPath !== undefined
        ? validatePath(args.streamingPath)
        : undefined;
    await ctx.db.patch(args.artifactId, {
      liveStreamMode: args.liveStreamMode,
      liveStreamStartedAt: Date.now(),
      streamingContent: args.liveStreamMode === 'rewrite' ? '' : undefined,
      streamingPatches: args.liveStreamMode === 'patch' ? [] : undefined,
      streamingPath: validatedPath,
      toolCallId: args.toolCallId,
    });
    return null;
  },
});

export const updateStreamingContent = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    streamingContent: v.optional(v.string()),
    streamingPath: v.optional(v.string()),
    streamingPatches: v.optional(v.array(artifactPatchValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.streamingContent !== undefined) {
      // streaming bytes alone — apply aggregate cap defensively.
      const size = new TextEncoder().encode(args.streamingContent).byteLength;
      if (size > MAX_ARTIFACT_BYTES) {
        throw new ConvexError({
          code: 'too_large',
          message: `Streaming content is ${size} bytes; max ${MAX_ARTIFACT_BYTES}.`,
        });
      }
    }
    const patch: Record<string, unknown> = {};
    if (args.streamingContent !== undefined) {
      patch.streamingContent = args.streamingContent;
    }
    if (args.streamingPath !== undefined) {
      patch.streamingPath = validatePath(args.streamingPath);
    }
    if (args.streamingPatches !== undefined) {
      patch.streamingPatches = args.streamingPatches;
    }
    if (Object.keys(patch).length === 0) return null;
    const existing = await ctx.db.get(args.artifactId);
    const now = Date.now();
    const lastBeat = existing?.liveStreamStartedAt ?? 0;
    if (now - lastBeat >= HEARTBEAT_THROTTLE_MS) {
      patch.liveStreamStartedAt = now;
    }
    await ctx.db.patch(args.artifactId, patch);
    return null;
  },
});

export const abortStream = internalMutation({
  args: { artifactId: v.id('artifacts') },
  returns: v.null(),
  handler: async (ctx, { artifactId }) => {
    await ctx.db.patch(artifactId, clearStreamingFlags());
    return null;
  },
});

export const cleanupStaleStreams = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_STREAM_THRESHOLD_MS;
    let cleared = 0;
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_liveStreamMode')) {
      if (
        row.liveStreamStartedAt !== undefined &&
        row.liveStreamStartedAt < cutoff
      ) {
        await ctx.db.patch(row._id, clearStreamingFlags());
        cleared += 1;
      }
    }
    return { cleared };
  },
});

// =============================================================================
// Runnable-artifact run-state mutations (unchanged from prior shape)
// =============================================================================

export const setArtifactRunConfig = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runPackages: v.array(v.string()),
    runOptions: v.optional(
      v.object({
        allowSdist: v.optional(v.boolean()),
        allowInstallScripts: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      return null;
    }
    await ctx.db.patch(args.artifactId, {
      runPackages: args.runPackages,
      ...(args.runOptions !== undefined && { runOptions: args.runOptions }),
    });
    return null;
  },
});

export const initArtifactRun = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      return null;
    }
    if (
      row.runStatus === 'queued' ||
      row.runStatus === 'installing' ||
      row.runStatus === 'running'
    ) {
      throw new ConvexError({
        code: 'RUN_IN_FLIGHT',
        message: `artifact ${args.artifactId} already has a run in flight (status: ${row.runStatus}); wait for it to settle before starting another.`,
      });
    }
    await ctx.db.patch(args.artifactId, {
      runStatus: 'queued',
      runProgress: { kind: 'queued' },
      runStartedAt: Date.now(),
      runRevision: row.revision,
      runCompletedAt: undefined,
      runExitCode: undefined,
      runErrorCode: undefined,
      runErrorMessage: undefined,
      runStdoutPreview: undefined,
      runStderrPreview: undefined,
      runStdoutStorageId: undefined,
      runStderrStorageId: undefined,
      runOutputFiles: [],
      runExecutionId: undefined,
    });
    return null;
  },
});

export const patchArtifactRunProgress = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runStatus: v.optional(artifactRunStatusValidator),
    runProgress: v.optional(sandboxRunProgressValidator),
    runExecutionId: v.optional(v.id('sandboxExecutions')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return null;
    if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
      return null;
    }
    if (
      row.runStatus !== undefined &&
      sandboxTerminalStatuses.has(row.runStatus)
    ) {
      console.warn(
        `[patchArtifactRunProgress] no-op: artifact ${args.artifactId} already terminal as ${row.runStatus}`,
      );
      return null;
    }
    const patch: Record<string, unknown> = {};
    if (args.runStatus !== undefined) patch.runStatus = args.runStatus;
    if (args.runProgress !== undefined) patch.runProgress = args.runProgress;
    if (args.runExecutionId !== undefined) {
      patch.runExecutionId = args.runExecutionId;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(args.artifactId, patch);
    return null;
  },
});

export async function applyFinalizeArtifactRun(
  ctx: MutationCtx,
  args: {
    artifactId: Id<'artifacts'>;
    runStatus: 'completed' | 'failed' | 'cancelled';
    runExitCode?: number;
    runErrorCode?: ArtifactRunErrorCode;
    runErrorMessage?: string;
    runStdoutPreview?: string;
    runStderrPreview?: string;
    runStdoutStorageId?: Id<'_storage'>;
    runStderrStorageId?: Id<'_storage'>;
    runOutputFiles: ArtifactRunOutputFile[];
    runExecutionId?: Id<'sandboxExecutions'>;
  },
): Promise<void> {
  const row = await ctx.db.get(args.artifactId);
  if (!row) return;
  if (row.type !== 'python_runnable' && row.type !== 'node_runnable') {
    return;
  }
  if (
    row.runStatus !== undefined &&
    sandboxTerminalStatuses.has(row.runStatus)
  ) {
    console.warn(
      `[finalizeArtifactRun] no-op: artifact ${args.artifactId} already terminal as ${row.runStatus}; dropping incoming ${args.runStatus}`,
    );
    return;
  }
  await ctx.db.patch(args.artifactId, {
    runStatus: args.runStatus,
    runProgress: undefined,
    runCompletedAt: Date.now(),
    ...(args.runExitCode !== undefined && { runExitCode: args.runExitCode }),
    ...(args.runErrorCode !== undefined && {
      runErrorCode: args.runErrorCode,
    }),
    ...(args.runErrorMessage !== undefined && {
      runErrorMessage: args.runErrorMessage,
    }),
    ...(args.runStdoutPreview !== undefined && {
      runStdoutPreview: args.runStdoutPreview,
    }),
    ...(args.runStderrPreview !== undefined && {
      runStderrPreview: args.runStderrPreview,
    }),
    ...(args.runStdoutStorageId !== undefined && {
      runStdoutStorageId: args.runStdoutStorageId,
    }),
    ...(args.runStderrStorageId !== undefined && {
      runStderrStorageId: args.runStderrStorageId,
    }),
    runOutputFiles: args.runOutputFiles,
    ...(args.runExecutionId !== undefined && {
      runExecutionId: args.runExecutionId,
    }),
  });
}

export const finalizeArtifactRun = internalMutation({
  args: {
    artifactId: v.id('artifacts'),
    runStatus: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    runExitCode: v.optional(v.number()),
    runErrorCode: v.optional(artifactRunErrorCodeValidator),
    runErrorMessage: v.optional(v.string()),
    runStdoutPreview: v.optional(v.string()),
    runStderrPreview: v.optional(v.string()),
    runStdoutStorageId: v.optional(v.id('_storage')),
    runStderrStorageId: v.optional(v.id('_storage')),
    runOutputFiles: v.array(artifactRunOutputFileValidator),
    runExecutionId: v.optional(v.id('sandboxExecutions')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyFinalizeArtifactRun(ctx, args);
    return null;
  },
});
