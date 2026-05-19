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
  runnableLanguage,
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

/** Run outcome forwarded to the LLM for runnable artifact types. Lets the
 * model see that the sandbox actually failed (vs. just "source row written")
 * and decide whether to patch the code with `artifact_edit` or report the
 * error to the user. Mirrors the shape `executeCode` returns. */
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

interface ArtifactCreateRunResult extends ArtifactCreateRunOutcome {
  success: boolean; // runStatus === 'completed' AND files.length > 0
  artifactId: string;
  revision: number;
  message: string;
}

type ArtifactCreateResult =
  | ArtifactCreateSuccess
  | ArtifactCreateFailure
  | ArtifactCreateRunResult;

interface ExecuteCodeResult {
  executionId: string;
  success: boolean;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: string;
  errorMessage?: string;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  files: Array<{
    name: string;
    storageId: string;
    fileMetadataId: string;
    size: number;
    contentType: string;
  }>;
}

function buildRunnableCreateResult(
  args: ArtifactCreateInput,
  artifactId: string,
  run: ExecuteCodeResult,
): ArtifactCreateRunResult {
  const completed = run.status === 'completed';
  const hasFiles = run.files.length > 0;
  const success = completed && hasFiles;
  // The LLM uses this `message` as its primary signal of what to tell the
  // user. Be explicit about failures so it doesn't say "file generated"
  // when no file was actually produced.
  let message: string;
  if (success) {
    message = `Created artifact "${args.title}" (${args.type}) and ran the code; produced ${run.files.length} output file(s) in ${run.durationMs}ms.`;
  } else if (run.errorCode) {
    message = `Created artifact "${args.title}" (${args.type}). Run FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read runStderrPreview and call artifact_edit to fix, or report the failure to the user. Do NOT say the file is ready.`;
  } else {
    message = `Created artifact "${args.title}" (${args.type}). Run did not produce any output files (status=${run.status}). Inspect stdout/stderr and decide next step.`;
  }
  return {
    success,
    artifactId,
    revision: 1,
    message,
    runStatus: run.status,
    runExitCode: run.exitCode,
    ...(run.errorCode !== undefined && { runErrorCode: run.errorCode }),
    ...(run.errorMessage !== undefined && {
      runErrorMessage: run.errorMessage,
    }),
    runStdoutPreview: run.stdoutPreview,
    runStderrPreview: run.stderrPreview,
    durationMs: run.durationMs,
    files: run.files,
    executionId: run.executionId,
  };
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

The source you emit in \`content\` is executed in a sandboxed Linux container immediately after the artifact is created. Write any deliverable files (\`.pptx\`, \`.pdf\`, \`.xlsx\`, generated images, etc.) under \`/workspace/output/\` — they're uploaded to the chat as attachments. Outputs **must** be under \`/workspace/output/\`; nothing else is collected. Defaults: Python 3.12 / Node 24, wall-clock ≤30s (raise via \`timeoutMs\`, max 300000), memory 1 GB, 1 CPU, egress only to package registries.

**On runnable-type response, INSPECT \`runStatus\` BEFORE replying to the user.**

- \`runStatus: "completed"\` AND \`files.length > 0\` → tell the user the file is ready and what it contains.
- \`runStatus: "completed"\` BUT \`files.length === 0\` → the script ran but wrote no output. Probably a bug in the script's output path. Read \`runStdoutPreview\` / \`runStderrPreview\`, then \`artifact_edit\`.
- \`runStatus: "failed"\` → READ \`runStderrPreview\` first, then decide:

| \`runErrorCode\` | Meaning | Recovery |
|---|---|---|
| \`RUNTIME_ERROR\` | Code threw (most common) | Read stderr traceback, \`artifact_edit\` with \`mode: "patch"\` to fix the bug |
| \`TIMEOUT\` | Wall-clock exceeded | \`artifact_edit\` to split the work or raise \`timeoutMs\` |
| \`OOM\` | Memory cap hit (1 GB) | \`artifact_edit\` to stream / reduce data in memory |
| \`EGRESS_DENIED\` | Tried to reach a non-registry host | \`artifact_edit\` to remove the external call — use the \`web\` tool instead |
| \`INSTALL_FAILED\` | Package install errored | Read stderr, \`artifact_edit\` with corrected \`packages\` list |
| \`PACKAGE_NOT_FOUND\` | A spec doesn't resolve | \`artifact_edit\` with an alternate package name |
| \`QUOTA_EXCEEDED\` | Org daily CPU cap | Don't retry — tell the user to wait |
| \`SPAWNER_UNAVAILABLE\` | Transient infra | One retry via \`artifact_edit\` no-op rewrite is fine; if it fails again, surface to user |

**NEVER tell the user "文件已生成" / "file generated" / similar unless \`success === true\` AND \`files.length > 0\`.** Failing this rule is the most reported bug for this tool.

**RESPONSE:** returns the new \`artifactId\` and \`revision: 1\`. For runnable types it also returns \`runStatus\`, \`runErrorCode\`, \`runStderrPreview\`, \`files[]\`, and \`executionId\`. The artifact's content is rendered live in the Canvas pane as you stream it.`,
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
      const { organizationId, threadId, messageId, userId } = ctx;
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

        // Runnable types: source has settled in the artifact row; now run
        // it in the sandbox and stream phase events into the row's
        // run* fields (canvas-runnable-code-renderer subscribes). The run
        // outcome is also forwarded to the LLM in this tool's return so it
        // can react to failures (read stderr, propose a patch) — without
        // that the LLM would see `success: true` and hallucinate "file
        // generated" even when the run actually failed.
        const runtimeLanguage = runnableLanguage(args.type);
        if (isRunnableArtifactType(args.type) && runtimeLanguage) {
          if (!userId) {
            return {
              success: false,
              message:
                'python_runnable / node_runnable require userId in the tool context.',
            };
          }
          await ctx.runMutation(
            internal.artifacts.internal_mutations.initArtifactRun,
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
          const accessibleThreadIds = [threadId];
          const runResult = await ctx.runAction(
            internal.node_only.sandbox.internal_actions.executeCode,
            {
              organizationId,
              uploadedBy: userId,
              threadId,
              accessibleThreadIds,
              ...(messageId !== undefined && { messageId }),
              ...(options.toolCallId && { toolCallId: options.toolCallId }),
              language: runtimeLanguage,
              code: args.content,
              ...(args.packages !== undefined && { packages: args.packages }),
              ...(args.timeoutMs !== undefined && {
                timeoutMs: args.timeoutMs,
              }),
              ...(args.allowSdist !== undefined && {
                allowSdist: args.allowSdist,
              }),
              ...(args.allowInstallScripts !== undefined && {
                allowInstallScripts: args.allowInstallScripts,
              }),
              purpose: args.title,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- artifactId came from createArtifact above
              artifactId: artifactId as unknown as never,
            },
          );
          return buildRunnableCreateResult(args, artifactId, runResult);
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
