/**
 * Convex Tool: artifact_list
 *
 * Lists all artifacts in the current thread (metadata only). Used for
 * title→id recovery when the LLM has lost track of an artifactId from an
 * earlier turn, or for programmatic tool-chains ("list, then artifact_file_list N,
 * then artifact_file_update one").
 *
 * Returns metadata only — no file content — to keep the response small.
 * Call `artifact_file_list({artifactId})` afterward to enumerate paths inside an
 * artifact, then `artifact_file_read({artifactId, path})` to fetch content.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';

const MAX_LIST = 50;

const artifactListArgs = z
  .object({})
  .describe('No arguments — scopes to the current thread.');

type ArtifactListInput = z.infer<typeof artifactListArgs>;

interface ArtifactListEntry {
  artifactId: string;
  type: string;
  title: string;
  revision: number;
  entryFile: string;
  fileCount: number;
  totalBytes: number;
  language?: string;
  updatedAt: number;
}

interface ArtifactListResult {
  success: true;
  artifacts: ArtifactListEntry[];
  truncated: boolean;
  totalCount: number;
  message?: string;
}

export const artifactListTool = {
  name: 'artifact_list' as const,
  tool: createTool({
    description: `**artifact_list** — list all artifacts in the current thread (metadata only).

Use when you've lost track of an \`artifactId\` from an earlier turn (e.g. a prior \`artifact_create\` returned \`isNew: false\` and you need to find the artifact's id by title), or when composing a tool chain that needs to enumerate all artifacts before acting.

**RESPONSE:** \`{artifacts: [{artifactId, type, title, revision, entryFile, fileCount, totalBytes, language?, updatedAt}], truncated, totalCount}\`. Sorted by \`updatedAt\` desc (most recent first). Capped at ${MAX_LIST} entries.

No file content is returned — call \`artifact_file_list({artifactId})\` to enumerate paths, then \`artifact_file_read({artifactId, path})\` to fetch content.`,
    inputSchema: artifactListArgs,
    execute: async (
      ctx: ToolCtx,
      _args: ArtifactListInput,
      _options: ToolExecutionOptions,
    ): Promise<ArtifactListResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: true,
          artifacts: [],
          truncated: false,
          totalCount: 0,
          message: 'No organizationId/threadId in context.',
        };
      }
      // Metadata-only query: server-side projection avoids hauling MBs of
      // file content into the action just to count bytes. See
      // `listByThreadMetadata` docstring for the trade-off.
      const rows = await ctx.runQuery(
        internal.artifacts.internal_queries.listByThreadMetadata,
        { organizationId, threadId },
      );
      // Sort by updatedAt desc, cap at MAX_LIST.
      const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
      const truncated = sorted.length > MAX_LIST;
      const capped = sorted.slice(0, MAX_LIST);
      const artifacts: ArtifactListEntry[] = capped.map((row) => {
        const entry: ArtifactListEntry = {
          artifactId: row._id,
          type: row.type,
          title: row.title,
          revision: row.revision,
          entryFile: row.entryFile,
          fileCount: row.fileCount,
          totalBytes: row.totalBytes,
          updatedAt: row.updatedAt,
        };
        if (row.language !== undefined) entry.language = row.language;
        return entry;
      });
      return {
        success: true,
        artifacts,
        truncated,
        totalCount: sorted.length,
        message: truncated
          ? `Showing the ${MAX_LIST} most recently updated of ${sorted.length} artifacts.`
          : undefined,
      };
    },
  }),
} as const satisfies ToolDefinition;
