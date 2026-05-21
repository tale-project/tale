/**
 * Convex Tool: artifact_read
 *
 * Read an artifact's current content. By artifactId only — title-recovery
 * goes through `artifact_list` (returns id+title metadata).
 *
 * Without `path`: returns the file tree plus inlined content for the entry
 * file and any other small files (per-file <8KB, aggregate <64KB).
 * With `path: string`: returns just that one file.
 * With `path: string[]`: returns those files (subject to aggregate cap).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import {
  mirrorLegacyContent,
  resolveArtifactFiles,
} from '../../artifacts/resolve_files';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';

const PER_FILE_INLINE_BYTES = 8_192;
const AGGREGATE_INLINE_BYTES = 65_536;
const ENTRY_INLINE_CEILING_BYTES = 32_768;

const artifactReadArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID. Look it up via `artifact_list({})` if you only have the title.',
    ),
  path: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(50)])
    .optional()
    .describe(
      'Optional file path (string) or list of paths (array). Omit to receive the file tree plus inlined small-file content. Pass a path to fetch one file in full. Pass an array to fetch several files at once (subject to aggregate size cap).',
    ),
});

type ArtifactReadInput = z.infer<typeof artifactReadArgs>;

interface ReadFileEntry {
  path: string;
  size: number;
  content?: string;
}

interface ArtifactReadSuccess {
  success: true;
  artifactId: string;
  type: string;
  title: string;
  revision: number;
  entryFile: string;
  language?: string;
  fileCount: number;
  files: ReadFileEntry[];
  truncated: boolean;
  message?: string;
}

interface ArtifactReadFailure {
  success: false;
  code?: string;
  message: string;
}

type ArtifactReadResult = ArtifactReadSuccess | ArtifactReadFailure;

export const artifactReadTool = {
  name: 'artifact_read' as const,
  tool: createTool({
    description: `**artifact_read** — inspect an existing artifact's content. Use BEFORE \`artifact_edit(mode='patch')\` if your snapshot of a file may be stale (e.g. a prior patch failed with \`no_match\` or \`ambiguous_match\`).

**INPUTS:**
- \`artifactId\` — required. The Convex id from \`artifact_create\` or \`artifact_list\`.
- \`path\` — optional:
    - omit → returns the project's file tree plus inlined content for the entry file (up to ${ENTRY_INLINE_CEILING_BYTES} bytes) and any other small files (each ≤${PER_FILE_INLINE_BYTES} bytes, total ≤${AGGREGATE_INLINE_BYTES} bytes). Files above the threshold come back as \`{path, size}\` with no content.
    - string → returns that file's full content.
    - string[] → returns those files (subject to the aggregate cap).

**WHEN TO USE:**
- After a \`patch\` failure to re-anchor your search snippet against current bytes.
- Before composing a multi-step edit that needs to reference several files.
- When the \`<artifacts>\` system-context block was truncated for size.

**WHEN NOT TO USE:**
- For routine reads of small artifacts whose content is already in the \`<artifacts>\` system context — that content is fresh enough for the typical edit flow.

**RESPONSE:** \`{artifactId, type, title, revision, entryFile, fileCount, files: [{path, size, content?}], truncated}\`. \`content\` is present iff the file fit under the inline thresholds. Use \`revision\` as the \`expectedRevision\` of the next \`artifact_edit\` call.`,
    inputSchema: artifactReadArgs,
    execute: async (
      ctx: ToolCtx,
      args: ArtifactReadInput,
      _options: ToolExecutionOptions,
    ): Promise<ArtifactReadResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_read requires organizationId and threadId in the tool context.',
        };
      }
      let artifactId;
      try {
        artifactId = toId<'artifacts'>(args.artifactId);
      } catch (err) {
        return {
          success: false,
          message: `Artifact id "${args.artifactId}" is malformed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const artifact = await ctx.runQuery(
        internal.artifacts.internal_queries.getById,
        {
          artifactId,
          expectedOrganizationId: organizationId,
          expectedThreadId: threadId,
        },
      );
      if (!artifact) {
        return {
          success: false,
          code: 'not_found',
          message: `Artifact ${args.artifactId} not found in this thread.`,
        };
      }
      const resolved = resolveArtifactFiles(artifact);

      // Single-path read.
      if (typeof args.path === 'string') {
        const target = resolved.files.find((f) => f.path === args.path);
        if (!target) {
          return {
            success: false,
            code: 'file_missing',
            message: `File "${args.path}" does not exist in this artifact. Available: ${resolved.files
              .map((f) => f.path)
              .join(', ')}.`,
          };
        }
        return {
          success: true,
          artifactId: args.artifactId,
          type: artifact.type,
          title: artifact.title,
          revision: artifact.revision,
          entryFile: resolved.entryFile,
          language: artifact.language,
          fileCount: resolved.files.length,
          files: [
            {
              path: target.path,
              size: target.content.length,
              content: target.content,
            },
          ],
          truncated: false,
        };
      }

      // Multi-path read.
      if (Array.isArray(args.path)) {
        const requested = new Set(args.path);
        const missing = args.path.filter(
          (p) => !resolved.files.some((f) => f.path === p),
        );
        if (missing.length > 0) {
          return {
            success: false,
            code: 'file_missing',
            message: `These paths do not exist: ${missing.join(', ')}. Available: ${resolved.files.map((f) => f.path).join(', ')}.`,
          };
        }
        let aggregate = 0;
        let truncated = false;
        const files: ReadFileEntry[] = [];
        // Smallest first so a single large file doesn't push out everything.
        const requestedFiles = resolved.files.filter((f) =>
          requested.has(f.path),
        );
        const ordered = [...requestedFiles].sort(
          (a, b) => a.content.length - b.content.length,
        );
        for (const f of ordered) {
          if (aggregate + f.content.length > AGGREGATE_INLINE_BYTES) {
            files.push({ path: f.path, size: f.content.length });
            truncated = true;
            continue;
          }
          aggregate += f.content.length;
          files.push({
            path: f.path,
            size: f.content.length,
            content: f.content,
          });
        }
        // Restore the caller's original ordering.
        const indexMap = new Map<string, number>();
        files.forEach((f, i) => indexMap.set(f.path, i));
        const ordered2 = args.path
          .map((p) => files[indexMap.get(p) ?? -1])
          .filter((x): x is ReadFileEntry => x !== undefined);
        return {
          success: true,
          artifactId: args.artifactId,
          type: artifact.type,
          title: artifact.title,
          revision: artifact.revision,
          entryFile: resolved.entryFile,
          language: artifact.language,
          fileCount: resolved.files.length,
          files: ordered2,
          truncated,
          message: truncated
            ? 'Some files exceeded the aggregate inline cap; re-read by single path to fetch them.'
            : undefined,
        };
      }

      // No path → tree + smart inline.
      let aggregate = 0;
      let truncated = false;
      const files: ReadFileEntry[] = [];
      // Entry file first, with a higher per-file ceiling.
      const entry = resolved.files.find((f) => f.path === resolved.entryFile);
      if (entry) {
        if (entry.content.length <= ENTRY_INLINE_CEILING_BYTES) {
          aggregate += entry.content.length;
          files.push({
            path: entry.path,
            size: entry.content.length,
            content: entry.content,
          });
        } else {
          files.push({ path: entry.path, size: entry.content.length });
          truncated = true;
        }
      }
      for (const f of resolved.files) {
        if (f.path === resolved.entryFile) continue;
        if (
          f.content.length <= PER_FILE_INLINE_BYTES &&
          aggregate + f.content.length <= AGGREGATE_INLINE_BYTES
        ) {
          aggregate += f.content.length;
          files.push({
            path: f.path,
            size: f.content.length,
            content: f.content,
          });
        } else {
          files.push({ path: f.path, size: f.content.length });
          truncated = true;
        }
      }
      // Restore the natural order: entry first, then others as listed.
      const orderMap = new Map<string, number>();
      resolved.files.forEach((f, i) => {
        const adjusted = f.path === resolved.entryFile ? -1 : i;
        orderMap.set(f.path, adjusted);
      });
      files.sort(
        (a, b) => (orderMap.get(a.path) ?? 0) - (orderMap.get(b.path) ?? 0),
      );
      // Use mirrorLegacyContent for a no-op consistency check (and to avoid
      // bundlers tree-shaking out the import — we want the dual-write helper
      // accessible to dependent modules through this barrel).
      void mirrorLegacyContent;
      return {
        success: true,
        artifactId: args.artifactId,
        type: artifact.type,
        title: artifact.title,
        revision: artifact.revision,
        entryFile: resolved.entryFile,
        language: artifact.language,
        fileCount: resolved.files.length,
        files,
        truncated,
        message: truncated
          ? 'Some files exceeded inline thresholds; call again with explicit `path` to fetch them.'
          : undefined,
      };
    },
  }),
} as const satisfies ToolDefinition;
