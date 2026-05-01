/**
 * Convex Tool: artifact_create
 *
 * Creates a new editable, runnable artifact (HTML / SVG / markdown /
 * mermaid / code) inside the current chat thread. The artifact lives in
 * the `artifacts` table — separate from the message stream — so a single
 * logical document can be patched across many turns via `artifact_edit`
 * without re-emitting its content.
 *
 * Streaming: while the LLM emits the tool's input JSON, this tool inserts
 * a placeholder row as soon as `type` and `title` parse, then writes the
 * partial `content` to the row's `streamingContent` shadow field with
 * a small throttle. The final settle happens in `execute`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { parsePartialJson } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { artifactTypeEnum, isValidArtifactType } from './shared';
import {
  clearState,
  getState,
  initState,
  markFlushed,
  shouldFlush,
} from './stream_state';

const artifactCreateArgs = z.object({
  type: artifactTypeEnum.describe(
    'Artifact type. `html` and `svg` render as a runnable preview in the Canvas pane; `markdown` and `mermaid` render formatted; `code` is a plain syntax-highlighted snippet.',
  ),
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('Short human-readable title shown on the artifact card.'),
  content: z
    .string()
    .min(1)
    .describe(
      'Full content of the artifact. For `html`, a complete HTML document including <!doctype html> and any inline <script>/<style>. For `svg`, a complete <svg>…</svg> root.',
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Optional language hint when type=`code` (e.g. "ts", "python"). Ignored for other types.',
    ),
});

type ArtifactCreateInput = z.infer<typeof artifactCreateArgs>;

interface ArtifactCreateSuccess {
  success: true;
  artifactId: string;
  revision: number;
  message: string;
}

interface ArtifactCreateFailure {
  success: false;
  message: string;
}

type ArtifactCreateResult = ArtifactCreateSuccess | ArtifactCreateFailure;

export const artifactCreateTool = {
  name: 'artifact_create' as const,
  tool: createTool({
    description: `**artifact_create** — create a new editable, runnable artifact in the chat thread.

USE THIS TOOL when the user asks for a runnable HTML page, an SVG illustration, a Mermaid diagram, a markdown document, or any code snippet you expect the user may want to revise. The artifact appears as a card in the chat that opens a side-panel (Canvas) editor + preview.

**ARTIFACT TYPES:**
- \`html\` — runnable HTML page (rendered in a sandboxed iframe).
- \`svg\` — vector graphic (rendered inline).
- \`markdown\` — long-form markdown document.
- \`mermaid\` — diagram source (rendered as an SVG).
- \`code\` — plain syntax-highlighted snippet. Use the \`language\` field for the highlight hint.

**ITERATION:**
- After creating, refer back to the artifact by its \`artifactId\` in subsequent turns.
- To revise it, call \`artifact_edit\` with the same \`artifactId\` — never re-emit the full content via another \`artifact_create\`.
- Prefer small \`artifact_edit\` patches over rewrites: faster to stream, cheaper, less risk of regressing unrelated parts.

**DO NOT use this tool for:**
- Plain prose or conversational responses — write those directly in the message.
- Files the user wants saved to the documents hub — use \`document_write\` (with a file-generation tool first).
- Tabular data — emit a markdown table inline.

**RESPONSE:** returns the new \`artifactId\` and \`revision: 1\`. The artifact's content is rendered live in the Canvas pane as you stream it.`,
    inputSchema: artifactCreateArgs,
    onInputStart: async (_ctx: ToolCtx, options: ToolExecutionOptions) => {
      initState(options.toolCallId, 'artifact_create');
    },
    onInputDelta: async (
      ctx: ToolCtx,
      options: { inputTextDelta: string } & ToolExecutionOptions,
    ) => {
      const state = getState(options.toolCallId);
      if (!state) return;
      state.accumulator += options.inputTextDelta;

      const parsed = await parsePartialJson(state.accumulator);
      if (
        parsed.state !== 'successful-parse' &&
        parsed.state !== 'repaired-parse'
      ) {
        return;
      }
      const partial = parsed.value;
      if (
        typeof partial !== 'object' ||
        partial === null ||
        Array.isArray(partial)
      ) {
        return;
      }
      const obj = partial as Record<string, unknown>;
      const type = typeof obj.type === 'string' ? obj.type : undefined;
      const title = typeof obj.title === 'string' ? obj.title : undefined;
      const content = typeof obj.content === 'string' ? obj.content : undefined;
      const language =
        typeof obj.language === 'string' ? obj.language : undefined;

      const { organizationId, threadId, messageId } = ctx;
      if (!organizationId || !threadId) return;

      if (
        !state.rowInitialized &&
        type !== undefined &&
        title !== undefined &&
        isValidArtifactType(type)
      ) {
        const inserted = await ctx.runMutation(
          internal.artifacts.internal_mutations.createArtifact,
          {
            organizationId,
            threadId,
            type,
            title,
            language,
            content: content ?? '',
            createdByMessageId: messageId ?? '',
            liveStreamMode: 'create',
          },
        );
        state.artifactId = inserted.artifactId;
        state.rowInitialized = true;
        if (content !== undefined) markFlushed(state, content.length);
        return;
      }

      if (
        state.rowInitialized &&
        state.artifactId !== undefined &&
        content !== undefined &&
        shouldFlush(state, content.length)
      ) {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.updateStreamingContent,
          {
            artifactId: state.artifactId,
            streamingContent: content,
          },
        );
        markFlushed(state, content.length);
      }
    },
    execute: async (
      ctx: ToolCtx,
      args: ArtifactCreateInput,
      options: ToolExecutionOptions,
    ): Promise<ArtifactCreateResult> => {
      const { organizationId, threadId, messageId } = ctx;
      const state = getState(options.toolCallId);
      try {
        if (!organizationId || !threadId) {
          if (state?.artifactId !== undefined) {
            await ctx.runMutation(
              internal.artifacts.internal_mutations.abortStream,
              { artifactId: state.artifactId },
            );
          }
          return {
            success: false,
            message:
              'artifact_create requires organizationId and threadId in the tool context.',
          };
        }

        const editedByMessageId = messageId ?? '';

        if (state?.artifactId !== undefined) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.finalizeStreamedCreate,
            {
              artifactId: state.artifactId,
              content: args.content,
              editedByMessageId,
            },
          );
          return {
            success: true,
            artifactId: state.artifactId,
            revision: 1,
            message: `Created artifact "${args.title}" (${args.type}, ${args.content.length} chars).`,
          };
        }

        const inserted = await ctx.runMutation(
          internal.artifacts.internal_mutations.createArtifact,
          {
            organizationId,
            threadId,
            type: args.type,
            title: args.title,
            language: args.language,
            content: args.content,
            createdByMessageId: editedByMessageId,
          },
        );
        return {
          success: true,
          artifactId: inserted.artifactId,
          revision: inserted.revision,
          message: `Created artifact "${args.title}" (${args.type}, ${args.content.length} chars).`,
        };
      } finally {
        clearState(options.toolCallId);
      }
    },
  }),
} as const satisfies ToolDefinition;
