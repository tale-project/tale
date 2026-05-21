/**
 * Convex Tool: artifact_create
 *
 * Creates a new artifact project — OR returns the existing one with full
 * state on title collision. **Synchronous**: no streaming hooks. Content is
 * an OPTIONAL argument for `markdown`/`code` types; **required** for types
 * where empty is useless to render (`html`, `svg`, `mermaid`, `python_runnable`,
 * `node_runnable`).
 *
 * Idempotency: dedup on `(threadId, type, normalized-title)`. Second call
 * with the same identity returns the existing `artifactId` and `isNew: false`
 * WITHOUT overwriting content — the LLM must explicitly call `artifact_edit`
 * if it wants to change the artifact.
 *
 * This shape fixes the duplicate-on-retry bug at the schema layer rather than
 * via toolCallId dedup (which only covered in-call races, not AI-SDK retries).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import {
  artifactTypeEnum,
  isContentRequiredAtCreate,
  isRunnableArtifactType,
} from './shared';

const artifactCreateArgs = z
  .object({
    type: artifactTypeEnum.describe(
      'Artifact type. `html` renders in a sandboxed iframe; `svg` inline; `markdown`/`mermaid` rendered formatted; `code` syntax-highlighted; `python_runnable`/`node_runnable` execute server-side in the sandbox.',
    ),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'Short human-readable title shown on the artifact card. Acts as the identity key — a second `artifact_create` with the same title returns the existing artifactId.',
      ),
    content: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Initial content for the entry file. REQUIRED for `html`, `svg`, `mermaid`, `python_runnable`, and `node_runnable` (these types are useless empty). OPTIONAL for `markdown` and `code` — omit to create an empty scaffold, then fill via artifact_edit(rewrite).',
      ),
    language: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Optional language hint when type=`code` (e.g. "ts", "python"). Also determines the default entry file extension when `entryFile` is omitted.',
      ),
    entryFile: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Optional entry-file path override. Defaults: html→index.html, python_runnable→main.py, node_runnable→main.js, mermaid→diagram.mmd, svg→image.svg, markdown→README.md, code→main.<ext>.',
      ),
    packages: z
      .array(z.string().max(120))
      .max(20)
      .optional()
      .describe(
        'Runnable types only. Pip or npm specs to install before executing. Pinned versions strongly preferred. Installs always run with `pip --only-binary=:all:` and `npm --ignore-scripts`.',
      ),
  })
  .superRefine((val, ctx) => {
    if (isContentRequiredAtCreate(val.type) && val.content === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: `content is required for type "${val.type}" — these types are useless rendered empty. Supply the initial source/markup at create time.`,
      });
    }
  });

type ArtifactCreateInput = z.infer<typeof artifactCreateArgs>;

interface ArtifactCreateSuccess {
  success: true;
  isNew: boolean;
  artifactId: string;
  revision: number;
  entryFile: string;
  filePaths: string[];
  message: string;
}

interface ArtifactCreateFailure {
  success: false;
  conflict?: 'type_mismatch';
  existingArtifactId?: string;
  existingType?: string;
  message: string;
}

type ArtifactCreateResult = ArtifactCreateSuccess | ArtifactCreateFailure;

export const artifactCreateTool = {
  name: 'artifact_create' as const,
  tool: createTool({
    description: `**artifact_create** — create a new artifact project (a versioned file tree the user can see in the Canvas pane). **Create-or-noop, never overwrite.**

USE THIS TOOL when the user asks for a runnable HTML page, an SVG illustration, a Mermaid diagram, a markdown document, a code snippet they may want to revise, or a Python / Node script you'll execute.

**IDEMPOTENT BY TITLE.** A second \`artifact_create\` with the same \`title\` in the same thread returns the existing artifactId with \`isNew: false\` and DOES NOT apply the supplied \`content\`. If you intended to overwrite, call \`artifact_edit({mode: 'rewrite', path: entryFile, content})\` instead.

**ARTIFACT TYPES & CONTENT REQUIREMENT:**
- \`html\` — runnable HTML page. **content REQUIRED.**
- \`svg\` — vector graphic. **content REQUIRED.**
- \`mermaid\` — diagram source. **content REQUIRED.**
- \`python_runnable\` / \`node_runnable\` — script source. **content REQUIRED.**
- \`markdown\` — long-form document. content optional (empty scaffold allowed).
- \`code\` — syntax-highlighted snippet. content optional; pair with \`language\` for the highlight hint.

**MULTI-FILE PROJECTS:** every artifact is a file map. \`artifact_create\` seeds ONE entry file. To add helper files (e.g. \`helpers.py\` alongside \`main.py\`), call \`artifact_edit({mode: 'rewrite', path: 'helpers.py', content: ...})\` after create.

**ITERATION:** refer back via \`artifactId\` in subsequent calls. To revise existing content, call \`artifact_edit\` — never \`artifact_create\` (which is a no-op on existing titles).

**HTML LIBRARIES & FONTS** (only when \`type\` = \`html\`):

The preview iframe blocks ALL external resources via Content-Security-Policy. Do NOT use any \`https://\` URL inside \`<script>\`, \`<link>\`, \`<img>\`, \`@import\`, or \`url()\`. Use these same-origin bundled libraries:
- reveal.js 5.x — \`/canvas-libs/reveal.js/5.0.5/reveal.js\`, \`/canvas-libs/reveal.js/5.0.5/reveal.css\`, theme \`/canvas-libs/reveal.js/5.0.5/theme/black.css\` (or \`white.css\`, \`league.css\`)
- Chart.js 4.x — \`/canvas-libs/chart.js/4.4.0/chart.umd.js\`
- D3 7.x — \`/canvas-libs/d3/7.8.5/d3.min.js\`
- Tailwind (Play CDN equivalent) — \`/canvas-libs/tailwindcss-browser/4.2.4/tailwindcss.js\`
- GSAP 3.x — \`/canvas-libs/gsap/3.12.5/gsap.min.js\`

For fonts use system stacks — never web-font CDNs. Modern OSes ship CJK fonts natively.

**HTML SUBRESOURCES** (multi-file projects): the preview server inlines \`<link rel="stylesheet" href="styles.css">\` / \`<script src="app.js">\` / \`<img src="logo.png">\` references by reading their content from the project's other files. **Dynamic \`fetch('./helpers.json')\` between sibling files is NOT supported** — pass data via inline JSON in \`<script type="application/json">\` instead.

**RUNTIME ENVIRONMENT** (only when \`type\` = \`html\`):

The iframe is fully static and offline. \`fetch()\`, \`XMLHttpRequest\`, \`WebSocket\`, \`EventSource\`, and \`navigator.sendBeacon\` to any host are blocked by CSP \`connect-src 'self'\`. Features that require runtime intelligence — translating user input, scoring user output, conversational replies, summarisation — **do not belong in an artifact**.

\`localStorage\` and \`sessionStorage\` are available but **in-memory per-iframe-load only**. Do not show "saved" UI copy that implies persistence across sessions.

**RUNNABLE TYPES** (\`python_runnable\` / \`node_runnable\`):

\`content\` is the entry-file source. This tool **only writes the source** — it does NOT execute. Follow up with \`artifact_run\` to actually run the script. \`packages\` is persisted on the artifact so subsequent runs reuse it. Output files must be written to \`/workspace/output/\` to be collected.

Typical sequence: \`artifact_create\` → \`artifact_run({artifactId})\` → if fail, \`artifact_edit({mode: 'patch', path: entryFile, ...})\` → \`artifact_run\` again.

**RESPONSE:** on success returns \`{isNew, artifactId, revision, entryFile, filePaths, message}\`. On title collision \`isNew: false\` — full project state included so you can call \`artifact_read\`/\`artifact_edit\` against the existing artifact. On title-but-type-mismatch: \`{conflict: 'type_mismatch', existingArtifactId, existingType}\`.`,
    inputSchema: artifactCreateArgs,
    execute: async (
      ctx: ToolCtx,
      args: ArtifactCreateInput,
      _options: ToolExecutionOptions,
    ): Promise<ArtifactCreateResult> => {
      const { organizationId, threadId, messageId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_create requires organizationId and threadId in the tool context.',
        };
      }
      const createdByMessageId = messageId ?? '';
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.createArtifact,
        {
          organizationId,
          threadId,
          type: args.type,
          title: args.title,
          language: args.language,
          content: args.content,
          entryFile: args.entryFile,
          createdByMessageId,
        },
      );

      if (!result.success) {
        // Currently only `type_mismatch` is surfaced from the mutation.
        return {
          success: false,
          conflict: result.conflict,
          existingArtifactId: result.existingArtifactId,
          existingType: result.existingType,
          message: result.message,
        };
      }

      // Persist run config for runnable types so subsequent `artifact_run`
      // calls reuse it without the LLM having to re-supply packages.
      if (
        isRunnableArtifactType(args.type) &&
        args.packages !== undefined &&
        args.packages.length > 0 &&
        result.isNew
      ) {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.setArtifactRunConfig,
          {
            artifactId: result.artifactId,
            runPackages: args.packages,
          },
        );
      }

      if (result.isNew) {
        const runHint = isRunnableArtifactType(args.type)
          ? ` Call \`artifact_run({artifactId: "${result.artifactId}"})\` to execute.`
          : '';
        return {
          success: true,
          isNew: true,
          artifactId: result.artifactId,
          revision: result.revision,
          entryFile: result.entryFile,
          filePaths: [...result.filePaths],
          message: `Created artifact "${args.title}" (${args.type}, ${result.filePaths.length} file(s)).${runHint}`,
        };
      }

      // Collision branch — full state in the response so the LLM can verify
      // its mental model without a follow-up read.
      return {
        success: true,
        isNew: false,
        artifactId: result.artifactId,
        revision: result.revision,
        entryFile: result.entryFile,
        filePaths: [...result.filePaths],
        message: `Artifact "${args.title}" already exists at revision ${result.revision} with entry file "${result.entryFile}" (${result.filePaths.length} file(s)). Supplied content was NOT applied. Call \`artifact_read({artifactId: "${result.artifactId}"})\` to inspect, or \`artifact_edit({artifactId: "${result.artifactId}", mode: "rewrite", path: "${result.entryFile}", content})\` to overwrite if intended.`,
      };
    },
  }),
} as const satisfies ToolDefinition;
