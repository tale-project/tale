/**
 * Convex Tool: artifact_create
 *
 * Creates a new artifact project — OR returns the existing one with full
 * state on title collision. **Synchronous metadata-only**: no streaming
 * hooks, no `content` argument. The row lands directly at revision 1 with
 * an empty entry file. To populate the content, the LLM follows up with
 * `artifact_file_update({artifactId, path: entryFile, content, expectedRevision: 1})`
 * for the entry file and `artifact_file_create` for any sibling modules.
 *
 * Idempotency: dedup on `(threadId, type, normalized-title)`. Second call
 * with the same identity returns the existing `artifactId` and `isNew: false`.
 * Same-message guard: a second call within the same assistant reply gets
 * `{conflict: 'already_created_in_message', existingArtifactId, ...}` so the
 * model switches to `artifact_file_create` / `artifact_file_update` against the existing
 * artifact instead of spawning a duplicate project.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { isRunnableArtifactType } from './shared';

// The LLM-facing `artifact_create` no longer exposes the legacy
// single-runtime types. New artifacts uniformly land at
// `script_runnable`; the per-file runtime is then chosen by extension at
// run time. The legacy literals stay in the schema validator so existing
// rows continue to validate (see [feedback_deprecate_dont_delete_schema_fields]).
const artifactCreateTypeEnum = z.enum([
  'html',
  'svg',
  'markdown',
  'mermaid',
  'code',
  'script_runnable',
]);

const artifactCreateArgs = z.object({
  type: artifactCreateTypeEnum.describe(
    'Artifact type. `html` renders in a sandboxed iframe; `svg` inline; `markdown`/`mermaid` rendered formatted; `code` syntax-highlighted; `script_runnable` executes server-side in the sandbox — each file runs with the interpreter implied by its extension (`.py` → python3, `.js`/`.cjs`/`.mjs` → node), so one artifact can mix Python and Node files.',
  ),
  title: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'Short human-readable title shown on the artifact card. Acts as the identity key — a second `artifact_create` with the same title returns the existing artifactId.',
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Optional language hint. For `code` artifacts it picks the syntax-highlight hint and default extension. For `script_runnable` it nudges the default entry file: "python"/"py" → `main.py`, "javascript"/"js"/"node" → `main.js` (default: `main.py`). You can still add the other-language files via `artifact_file_create` regardless of the hint.',
    ),
  entryFile: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Optional entry-file path override. Defaults: html→index.html, script_runnable→main.py (or main.js when `language` hints node), mermaid→diagram.mmd, svg→image.svg, markdown→README.md, code→main.<ext>.',
    ),
  packages: z
    .object({
      python: z
        .array(z.string().max(120))
        .max(20)
        .optional()
        .describe('Pip specs (e.g. `markitdown[pptx]`, `requests==2.31.0`).'),
      node: z
        .array(z.string().max(120))
        .max(20)
        .optional()
        .describe('npm specs (e.g. `pptxgenjs`, `@anthropic/sdk@1.0.0`).'),
    })
    .optional()
    .describe(
      'Runnable type only. Per-runtime dependencies. `python` is installed via `uv pip`, `node` via `npm`. Either bucket may be omitted. Pinned versions strongly preferred. Examples: `{python: ["markitdown[pptx]"]}` for a Python-only artifact; `{node: ["pptxgenjs"]}` for Node-only; `{python: ["markitdown[pptx]"], node: ["pptxgenjs"]}` for polyglot. Installs run with `pip --only-binary=:all:` and `npm --ignore-scripts`.',
    ),
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
  conflict?: 'type_mismatch' | 'already_created_in_message';
  existingArtifactId?: string;
  existingType?: string;
  existingTitle?: string;
  existingFiles?: string[];
  message: string;
}

type ArtifactCreateResult = ArtifactCreateSuccess | ArtifactCreateFailure;

export const artifactCreateTool = {
  name: 'artifact_create' as const,
  tool: createTool({
    description: `**artifact_create** — create an **empty** artifact project (a file tree the user can see in the Canvas pane). **Metadata only — no content argument.**

**DEFAULT TO ONE ARTIFACT PER REPLY.** If the user asks for code + verification scripts, a document + helper tools, or any composite deliverable, those belong as sibling files of the **same** artifact (added via subsequent \`artifact_file_create\` calls). Calling \`artifact_create\` a second time in the same assistant message returns \`{success: false, conflict: 'already_created_in_message', existingArtifactId, existingTitle, existingFiles}\` with the existing project state — switch to \`artifact_file_create\` / \`artifact_file_update\` against \`existingArtifactId\` to add files there. **Only** call \`artifact_create\` a second time in the same reply if the user explicitly asked for two unrelated projects (e.g. "make an SVG AND a separate Python script for a different purpose").

USE THIS TOOL when the user asks for a runnable HTML page, an SVG illustration, a Mermaid diagram, a markdown document, a code snippet they may want to revise, or a Python / Node script you'll execute.

**EMPTY ON CREATE — POPULATE VIA \`artifact_file_update\` / \`artifact_file_create\`.** The created artifact's entry file is empty at revision 1. **Immediately follow up** with file-level tools to write the actual content:

- Overwrite the empty entry file with its full content via \`artifact_file_update\`:
  \`\`\`
  artifact_file_update({ artifactId, path: '<entryFile>', content: '<full content>', expectedRevision: 1 })
  \`\`\`
- Add helper / sibling files via \`artifact_file_create\`:
  \`\`\`
  artifact_file_create({ artifactId, path: 'helpers.py', content: '<...>', expectedRevision: 2 })
  \`\`\`

There is no \`append\` and no \`patch\`. Write each file in full in one call; for runnable projects, split logically separate concerns into separate files (e.g. \`main.py\` + \`helpers.py\` + \`types.py\`) rather than packing everything into a single mega-file.

**IDEMPOTENT BY TITLE.** A second \`artifact_create\` with the same \`title\` in the same thread returns the existing artifactId with \`isNew: false\`. To populate / overwrite, use \`artifact_file_update\` against the returned \`artifactId\`.

**ARTIFACT TYPES:**
- \`html\` — runnable HTML page.
- \`svg\` — vector graphic.
- \`mermaid\` — diagram source.
- \`script_runnable\` — script source (Python and / or Node files in the same project, dispatched per-extension). Pair with \`packages: {python?: string[], node?: string[]}\` if dependencies are needed, or call \`artifact_packages_add\` later.
- \`markdown\` — long-form document.
- \`code\` — syntax-highlighted snippet. Pair with \`language\` for the highlight hint.

**MULTI-FILE PROJECTS:** every artifact is a file map. \`artifact_create\` seeds one **empty** entry file. To add helper files (e.g. \`helpers.py\` alongside \`main.py\`), call \`artifact_file_create({artifactId, path: 'helpers.py', content, expectedRevision})\` after create.

**ITERATION:** refer back via \`artifactId\` in subsequent calls. To revise existing content, call \`artifact_file_update\` — never \`artifact_create\` again (which is a no-op on existing titles).

**HTML (type='html' only):**

The preview iframe blocks ALL external resources via Content-Security-Policy. Use only these same-origin bundled libraries when populating via \`artifact_file_update\` / \`artifact_file_create\`:
- reveal.js 5.x — \`/canvas-libs/reveal.js/5.0.5/reveal.js\`, \`/canvas-libs/reveal.js/5.0.5/reveal.css\`, theme \`/canvas-libs/reveal.js/5.0.5/theme/black.css\` (or \`white.css\`, \`league.css\`)
- Chart.js 4.x — \`/canvas-libs/chart.js/4.4.0/chart.umd.js\`
- D3 7.x — \`/canvas-libs/d3/7.8.5/d3.min.js\`
- Tailwind — \`/canvas-libs/tailwindcss-browser/4.2.4/tailwindcss.js\`
- GSAP 3.x — \`/canvas-libs/gsap/3.12.5/gsap.min.js\`

For fonts use system stacks; don't use web-font CDNs. The iframe is fully static — \`fetch()\` / \`XMLHttpRequest\` / \`WebSocket\` / \`EventSource\` are blocked. Sibling subresources (\`<link>\`, \`<script>\`, \`<img>\`) get inlined by the preview server. \`localStorage\` is per-iframe-load only.

**RUNNABLE TYPE** (\`script_runnable\`):

Use \`artifact_file_update\` (entry file) / \`artifact_file_create\` (helper files) to populate source after create. The artifact's \`packages\` (passed at create time) is persisted for runs to reuse — to add more dependencies later, call \`artifact_packages_add\`. Output files must be written to \`/workspace/output/\` to be collected.

Typical sequence:
1. \`artifact_create({type: 'script_runnable', title: '…'})\` → empty main.py at revision 1
2. \`artifact_file_update({artifactId, path: 'main.py', content: '<source>', expectedRevision: 1})\` to populate; \`artifact_file_create\` to add helper modules
3. \`artifact_run({artifactId})\` to execute
4. If failure, \`artifact_file_read\` to inspect, \`artifact_file_update\` to fix, then \`artifact_run\` again

**RESPONSE:** on success returns \`{isNew, artifactId, revision: 1, entryFile, filePaths, message}\` with a copy-pasteable next-step hint in \`message\`. On title collision \`isNew: false\` — full project state included so you can call \`artifact_file_update\` / \`artifact_file_create\` against the existing artifact. On title-but-type-mismatch: \`{conflict: 'type_mismatch', existingArtifactId, existingType}\`. On same-reply duplicate-create: \`{conflict: 'already_created_in_message', existingArtifactId, existingType, existingTitle, existingFiles}\` — switch to \`artifact_file_create\` / \`artifact_file_update\` against the existing project.`,
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

      // Same-message guard: an assistant reply that already produced an
      // artifact should add files to it via `artifact_file_create` / `artifact_file_update`, not spawn a
      // duplicate project. Gate on non-empty messageId — multi-step /
      // sub-agent edge cases can fall back to "" and would otherwise
      // cross-match every empty-string row in the thread.
      if (createdByMessageId !== '') {
        const sibling = await ctx.runQuery(
          internal.artifacts.internal_queries.findArtifactByCreatedMessage,
          { organizationId, threadId, createdByMessageId },
        );
        if (sibling !== null) {
          const existingFiles =
            sibling.files !== undefined
              ? sibling.files.map((f) => f.path)
              : sibling.entryFile !== undefined
                ? [sibling.entryFile]
                : [];
          return {
            success: false,
            conflict: 'already_created_in_message',
            existingArtifactId: sibling._id,
            existingType: sibling.type,
            existingTitle: sibling.title,
            existingFiles,
            message: `An artifact "${sibling.title}" (${sibling.type}) was already created in this reply (artifactId: ${sibling._id}, files: ${existingFiles.join(', ') || '<none>'}, revision: ${sibling.revision}). To add files or content, call \`artifact_file_update({artifactId: "${sibling._id}", path: "<existing-path>", content: "...", expectedRevision: ${sibling.revision}})\` for existing files or \`artifact_file_create\` for new ones. Only call \`artifact_create\` again in this reply if the user explicitly asked for a second, unrelated project.`,
          };
        }
      }

      // Canonical create path: synchronous metadata insert. Always lands at
      // revision 1 with an empty entry file. The LLM follows up with
      // artifact_file_update / artifact_file_create to populate.
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.createArtifact,
        {
          organizationId,
          threadId,
          type: args.type,
          title: args.title,
          language: args.language,
          entryFile: args.entryFile,
          createdByMessageId,
        },
      );

      if (!result.success) {
        return {
          success: false,
          conflict: result.conflict,
          existingArtifactId: result.existingArtifactId,
          existingType: result.existingType,
          message: result.message,
        };
      }

      if (
        isRunnableArtifactType(args.type) &&
        args.packages !== undefined &&
        result.isNew
      ) {
        // Persist into the grouped `runPackagesByLang` field. Mirror the
        // entry-language bucket to the legacy flat `runPackages` field
        // so single-runtime readers (legacy callers, audit row, canvas
        // display) keep working unchanged.
        const entryExt = result.entryFile.toLowerCase().split('.').pop();
        const isPyEntry = entryExt === 'py';
        const pythonList = args.packages.python ?? [];
        const nodeList = args.packages.node ?? [];
        const flatList = isPyEntry ? pythonList : nodeList;
        const hasGrouped = pythonList.length > 0 || nodeList.length > 0;
        if (flatList.length > 0 || hasGrouped) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.setArtifactRunConfig,
            {
              artifactId: result.artifactId,
              runPackages: flatList,
              ...(hasGrouped && {
                runPackagesByLang: {
                  ...(pythonList.length > 0 && { python: pythonList }),
                  ...(nodeList.length > 0 && { node: nodeList }),
                },
              }),
            },
          );
        }
      }

      const runHint = isRunnableArtifactType(args.type)
        ? ` After populating, call \`artifact_run({artifactId: "${result.artifactId}"})\` to execute.`
        : '';
      const nextStep = `Call \`artifact_file_update({artifactId: "${result.artifactId}", path: "${result.entryFile}", content: "<full content>", expectedRevision: ${result.revision}})\` to populate the entry file. Add helper modules via \`artifact_file_create\` rather than packing everything into the entry file.`;

      if (result.isNew) {
        return {
          success: true,
          isNew: true,
          artifactId: result.artifactId,
          revision: result.revision,
          entryFile: result.entryFile,
          filePaths: [...result.filePaths],
          message: `Created empty artifact "${args.title}" (${args.type}, ${result.filePaths.length} file(s)) at revision ${result.revision}. ${nextStep}${runHint}`,
        };
      }

      return {
        success: true,
        isNew: false,
        artifactId: result.artifactId,
        revision: result.revision,
        entryFile: result.entryFile,
        filePaths: [...result.filePaths],
        message: `Artifact "${args.title}" already exists at revision ${result.revision} with entry file "${result.entryFile}" (${result.filePaths.length} file(s)). To modify, call \`artifact_file_update({artifactId: "${result.artifactId}", path: "${result.entryFile}", content: "<full content>", expectedRevision: ${result.revision}})\` or \`artifact_file_create\` for new files.`,
      };
    },
  }),
} as const satisfies ToolDefinition;
