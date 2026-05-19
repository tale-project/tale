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
import {
  artifactTypeEnum,
  isRunnableArtifactType,
  isValidArtifactType,
} from './shared';
import {
  clearState,
  getState,
  initState,
  markParsed,
  scheduleStreamingFlush,
  shouldParse,
} from './stream_state';

const artifactCreateArgs = z.object({
  type: artifactTypeEnum.describe(
    'Artifact type. `html` and `svg` render in the browser canvas. `markdown` and `mermaid` render formatted. `code` is a static syntax-highlighted snippet. `python_runnable` / `node_runnable` execute server-side in the sandbox: write your output files to `/workspace/output/` (e.g. `.pptx`, `.pdf`) and they appear as chat attachments + chips in the canvas.',
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
      'Full content of the artifact. For `html`, a complete HTML document. For `svg`, a complete <svg>…</svg> root. For `python_runnable` / `node_runnable`, the script source — the runtime writes it to /workspace/code/main.{py,js} and runs it.',
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Optional language hint when type=`code` (e.g. "ts", "python"). Ignored for other types.',
    ),
  packages: z
    .array(z.string().max(120))
    .max(20)
    .optional()
    .describe(
      'Runnable types only. Pip or npm specs to install before executing. Examples: ["python-pptx==1.0.2", "pillow"]. Pinned versions strongly preferred. By default `pip --only-binary=:all:` and `npm --ignore-scripts` (use `allowSdist` / `allowInstallScripts` to override).',
    ),
  allowSdist: z
    .boolean()
    .optional()
    .describe(
      'python_runnable only. Defaults false — sdist installs are blocked because they run arbitrary setup.py code. Set true only when a needed package has no wheel.',
    ),
  allowInstallScripts: z
    .boolean()
    .optional()
    .describe(
      'node_runnable only. Defaults false — preinstall/postinstall scripts are skipped. Set true if a package needs them (e.g. canvas).',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .optional()
    .describe(
      'Runnable types only. Wall-clock cap including package install. Default 30000, max 300000.',
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

// Legacy types from the unified create-runs-it flow (Refinement 3). Kept
// exported in case any caller imports them; the runnable branch in
// `execute` no longer constructs them — execution moved to `artifact_run`.
export interface ArtifactCreateRunOutcome {
  runStatus: 'completed' | 'failed' | 'cancelled';
  runExitCode: number | null;
  runErrorCode?: string;
  runErrorMessage?: string;
  runStdoutPreview: string;
  runStderrPreview: string;
  durationMs: number;
  files: Array<{
    name: string;
    storageId: string;
    fileMetadataId: string;
    size: number;
    contentType: string;
  }>;
  executionId: string;
}

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

**HTML LIBRARIES & FONTS** (only when \`type\` = \`html\`):

The preview iframe blocks ALL external resources via Content-Security-Policy. Do NOT use any \`https://\` URL inside \`<script>\`, \`<link>\`, \`<img>\`, \`@import\`, or \`url()\`. Specifically blocked: \`cdn.jsdelivr.net\`, \`unpkg.com\`, \`cdnjs.cloudflare.com\`, \`cdn.tailwindcss.com\`, \`fonts.googleapis.com\`, \`fonts.gstatic.com\`, and every other external host. Any reference to them will be blocked and the page will fail to render.

**Use these same-origin local copies for libraries:**
- reveal.js 5.x — \`/canvas-libs/reveal.js/5.0.5/reveal.js\`, \`/canvas-libs/reveal.js/5.0.5/reveal.css\`, theme \`/canvas-libs/reveal.js/5.0.5/theme/black.css\` (or \`white.css\`, \`league.css\`)
- Chart.js 4.x — \`/canvas-libs/chart.js/4.4.0/chart.umd.js\`
- D3 7.x — \`/canvas-libs/d3/7.8.5/d3.min.js\`
- Tailwind (Play CDN equivalent) — \`/canvas-libs/tailwindcss-browser/4.2.4/tailwindcss.js\`
- GSAP 3.x — \`/canvas-libs/gsap/3.12.5/gsap.min.js\`

If you need a library that is not in this list, inline its source directly in the artifact.

**For fonts, use system font stacks — never Google Fonts or any web-font CDN.** Modern OSes (macOS, Windows, iOS, Android, ChromeOS) ship CJK (Chinese / Japanese / Korean) fonts natively, so a plain system stack renders Chinese, Japanese, and Korean text correctly without any web font:

- General: \`font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;\`
- Chinese-specific (optional refinement): \`font-family: system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", sans-serif;\`
- Monospace: \`font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;\`

If the design absolutely requires a non-system display face, inline a base64-encoded \`@font-face\` (small subsets only).

**RUNTIME ENVIRONMENT** (only when \`type\` = \`html\`):

The iframe is fully static and offline. There is **no backend, no fetchable API, no WebSocket** — \`fetch()\`, \`XMLHttpRequest\`, \`WebSocket\`, \`EventSource\`, and \`navigator.sendBeacon\` to any host (including \`localhost\`) are blocked by CSP \`connect-src 'self'\`.

Therefore: features that require **runtime intelligence** — translating user input, scoring or correcting user output, conversational replies, language detection, summarisation, recommendation based on what the user just typed — **do not belong in an artifact**. Either handle them as normal chat replies, or redesign the page so it doesn't need a thinking backend at all (static reference content, fixed exercises with predetermined answers, deterministic visualisations / calculators / form layouts).

**Do NOT fake AI features with hardcoded lookup tables or random output.** A "translation tool" backed by 30 baked-in phrases, a "feedback engine" backed by canned responses, a "personalised recommendation" picked at random — these produce hollow, demo-shaped pages that feel impressive at a glance and fall apart on first real use. If the user asks for something that genuinely needs intelligence, prefer to deliver it in chat rather than build a plausible-looking shell.

\`localStorage\` and \`sessionStorage\` are available, but **in-memory and per-iframe-load only** — anything saved is lost the next time the artifact is rendered. Do not show "saved" / "remembered" / "记忆已保存" UI copy that implies persistence across sessions; treat storage as transient working memory, not durable state.

**RUNNABLE TYPES** (\`python_runnable\` / \`node_runnable\`):

The \`content\` you emit is the script source. This tool **only writes the source** — it does **NOT** automatically execute. You must follow up with the \`artifact_run\` tool to actually run the script and produce output files. The \`packages\`, \`allowSdist\`, \`allowInstallScripts\`, and \`timeoutMs\` you pass here are persisted on the artifact row so subsequent \`artifact_run\` calls reuse them automatically. Write deliverable files (\`.pptx\`, \`.pdf\`, \`.xlsx\`, images, etc.) to \`/workspace/output/\` — only that directory's contents are returned.

Typical sequence for a runnable artifact:
1. \`artifact_create\` (this tool) — writes the source. Returns \`artifactId\`.
2. \`artifact_run({ artifactId })\` — actually executes the script.
3. If the run fails, read \`runStderrPreview\`, call \`artifact_edit\` to patch, then \`artifact_run\` again.

Do NOT call \`artifact_create\` again to "try a different approach" — that creates a duplicate artifact. Use \`artifact_edit\` against the same \`artifactId\` instead.

**RESPONSE:** returns the new \`artifactId\` and \`revision: 1\`. The artifact's content is rendered live in the Canvas pane as you stream it.`,
    inputSchema: artifactCreateArgs,
    onInputStart: async (_ctx: ToolCtx, options: ToolExecutionOptions) => {
      initState(options.toolCallId, 'artifact_create');
    },
    onInputDelta: async (
      ctx: ToolCtx,
      options: { inputTextDelta: string } & ToolExecutionOptions,
    ) => {
      const toolCallId = options.toolCallId;
      const state = getState(options.toolCallId);
      if (!state) return;
      state.accumulator += options.inputTextDelta;

      if (!shouldParse(state, state.accumulator.length)) return;
      const parsed = await parsePartialJson(state.accumulator);
      markParsed(state, state.accumulator.length);
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
      const language =
        typeof obj.language === 'string' ? obj.language : undefined;
      // `content` is intentionally NOT extracted here — the streaming
      // canvas reads it from the agent SDK's tool-input-delta rows directly.

      const { organizationId, threadId, messageId } = ctx;
      if (!organizationId || !threadId) return;

      // Defer the placeholder insert until title has at least one character.
      // partial-json returns title:"" the moment the parser sees `"title":`,
      // before the actual characters arrive — inserting then would land an
      // empty title in the row and we have no good moment later to know
      // it has finished growing.
      if (
        !state.rowInitialized &&
        type !== undefined &&
        title !== undefined &&
        title.length > 0 &&
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
            // We no longer push partial content into `streamingContent` — the
            // canvas reads tool-input-deltas directly from the agent SDK's
            // streamDeltas, filtered by toolCallId, and decodes the JSON
            // `content` value client-side. Insert with empty content; the
            // canonical settle in execute() writes the final value.
            content: '',
            createdByMessageId: messageId ?? '',
            liveStreamMode: 'create',
            toolCallId,
          },
        );
        state.artifactId = inserted.artifactId;
        state.rowInitialized = true;
        state.lastFlushedTitle = title;
        state.lastFlushedLanguage = language;
        return;
      }

      if (state.rowInitialized && state.artifactId !== undefined) {
        // Only title / language flushes go through here now — content is
        // delivered via streamDeltas (no per-chunk mutation from us).
        const titleChanged =
          title !== undefined && title !== state.lastFlushedTitle;
        const languageChanged =
          language !== undefined && language !== state.lastFlushedLanguage;

        if (titleChanged || languageChanged) {
          if (titleChanged) state.lastFlushedTitle = title;
          if (languageChanged) state.lastFlushedLanguage = language;
          const artifactId = state.artifactId;
          const flushTitle = titleChanged ? title : undefined;
          const flushLanguage = languageChanged ? language : undefined;
          scheduleStreamingFlush(state, () =>
            ctx.runMutation(
              internal.artifacts.internal_mutations.updateStreamingContent,
              {
                artifactId,
                title: flushTitle,
                language: flushLanguage,
              },
            ),
          );
        }
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

        let artifactId: string;
        // Race-recovery: when `onInputDelta`'s placeholder insert mutation
        // hadn't returned yet by the time `execute` started, `state.artifactId`
        // is still undefined here — but the placeholder row may already exist
        // in the DB (with this tool-call's `toolCallId`). Falling straight
        // through to `createArtifact` would land a *second* row for the same
        // tool call (one empty placeholder + one with full content), which
        // surfaces in the UI as two duplicate-titled `v1` tabs. Look up the
        // placeholder by toolCallId before deciding to insert a new row.
        let placeholderId: string | undefined =
          state?.artifactId !== undefined
            ? String(state.artifactId)
            : undefined;
        if (placeholderId === undefined) {
          const orphan = await ctx.runQuery(
            internal.artifacts.internal_queries
              .findStreamingPlaceholderByToolCallId,
            {
              organizationId,
              threadId,
              toolCallId: options.toolCallId,
            },
          );
          if (orphan) placeholderId = String(orphan._id);
        }
        if (placeholderId !== undefined) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.finalizeStreamedCreate,
            {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string came from state.artifactId or row._id, both already typed as Id<'artifacts'> in their sources
              artifactId: placeholderId as never,
              title: args.title,
              language: args.language,
              content: args.content,
              editedByMessageId,
            },
          );
          artifactId = placeholderId;
        } else {
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
          artifactId = inserted.artifactId;
        }

        // Runnable types: source has settled in the artifact row. Persist
        // the run config (packages / sdist+script flags) on the row so the
        // separate `artifact_run` tool can execute the script later
        // without the LLM having to re-supply these. The actual sandbox
        // execution is NOT triggered here — that's `artifact_run`'s job.
        if (isRunnableArtifactType(args.type)) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.setArtifactRunConfig,
            {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- value came from createArtifact / state above
              artifactId: artifactId as unknown as never,
              runPackages: args.packages ?? [],
              ...((args.allowSdist !== undefined ||
                args.allowInstallScripts !== undefined) && {
                runOptions: {
                  ...(args.allowSdist !== undefined && {
                    allowSdist: args.allowSdist,
                  }),
                  ...(args.allowInstallScripts !== undefined && {
                    allowInstallScripts: args.allowInstallScripts,
                  }),
                },
              }),
            },
          );
          return {
            success: true,
            artifactId,
            revision: 1,
            message: `Created runnable artifact "${args.title}" (${args.type}, ${args.content.length} chars). Source is saved but NOT yet executed — call \`artifact_run\` with this artifactId to run the script and produce output files.`,
          };
        }

        return {
          success: true,
          artifactId,
          revision: 1,
          message: `Created artifact "${args.title}" (${args.type}, ${args.content.length} chars).`,
        };
      } finally {
        clearState(options.toolCallId);
      }
    },
  }),
} as const satisfies ToolDefinition;
