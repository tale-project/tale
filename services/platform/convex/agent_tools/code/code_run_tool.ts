/**
 * Convex Tool: code_run
 *
 * Runs Python or Node.js code in an ephemeral sandbox container (one
 * container per call, ENOSPC-capped tmpfs workspace, default-deny egress
 * except to package registries). Generated files become chat attachments
 * via `fileMetadata`. The motivating use case is `.pptx` via python-pptx.
 *
 * See plan §5 + tool description below.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';

const codeRunArgs = z.object({
  language: z
    .enum(['python', 'node'])
    .describe(
      'Runtime to execute the code in. `python` = Python 3.12 + uv. `node` = Node.js 24 + npm.',
    ),
  code: z
    .string()
    .min(1)
    .max(64_000)
    .describe(
      'Source for the program. For python it is written to /workspace/code/main.py; for node, /workspace/code/main.js. Write generated files to /workspace/output/ — only that directory is harvested as deliverables.',
    ),
  packages: z
    .array(z.string().max(120))
    .max(20)
    .optional()
    .describe(
      'Pip or npm package specs to install before running. Examples: ["python-pptx==1.0.2", "pillow"]. Pinned versions strongly preferred. Default install flags: `pip install --only-binary=:all:` (no sdist) and `npm install --ignore-scripts` (no lifecycle scripts). Use allowSdist / allowInstallScripts to override.',
    ),
  inputFiles: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[a-zA-Z0-9._-]+$/)
          .describe(
            'File name inside the sandbox at /workspace/input/<name>. Alphanumeric + dot/underscore/hyphen only.',
          ),
        fileId: z
          .string()
          .describe(
            'fileMetadataId of a prior chat upload OR a prior code_run output. Org-scope and thread-scope are verified before mount.',
          ),
      }),
    )
    .max(10)
    .optional()
    .describe(
      'Existing files to mount read-only into the sandbox at /workspace/input/<name>. Useful for: brand templates, source documents, prior code_run outputs you want to iterate on.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .optional()
    .describe(
      'Wall-clock cap including package install. Default 30000. Max 300000 (5 min). Going over → status=failed, errorCode=TIMEOUT.',
    ),
  allowSdist: z
    .boolean()
    .optional()
    .describe(
      'Python only. Defaults to false — sdist installs are blocked because they run arbitrary setup.py code. Set true only when a needed package has no wheel.',
    ),
  allowInstallScripts: z
    .boolean()
    .optional()
    .describe(
      'Node only. Defaults to false — preinstall/postinstall scripts are skipped. Set true if a package needs them (e.g. canvas, cypress). Audit-logged.',
    ),
  purpose: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'One sentence explaining WHY you are running this code. Surfaces in the chat tool-call card and the audit row.',
    ),
});

type CodeRunInput = z.infer<typeof codeRunArgs>;

type CodeRunResult =
  | {
      success: true;
      executionId: string;
      status: 'completed';
      exitCode: number;
      stdoutPreview: string;
      stderrPreview: string;
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean; files: number };
      files: {
        name: string;
        fileMetadataId: string;
        size: number;
        contentType: string;
      }[];
    }
  | {
      success: false;
      executionId: string;
      status: 'failed' | 'cancelled';
      exitCode: number | null;
      errorCode:
        | 'TIMEOUT'
        | 'OOM'
        | 'EGRESS_DENIED'
        | 'INSTALL_FAILED'
        | 'PACKAGE_NOT_FOUND'
        | 'QUOTA_EXCEEDED'
        | 'RUNTIME_ERROR'
        | 'SPAWNER_UNAVAILABLE'
        | 'CANCELLED';
      errorMessage: string;
      stdoutPreview: string;
      stderrPreview: string;
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean; files: number };
      files: never[];
    };

export const codeRunTool = {
  name: 'code_run' as const,
  tool: createTool({
    description: `**code_run** — run Python or Node.js code in an ephemeral sandbox and deliver any generated files as chat attachments.

**WHEN TO USE:**
- Generating \`.pptx\` slide decks (e.g. with python-pptx — pre-warmed in the cache).
- Custom data processing, format conversions, computations no specialised tool covers.
- Iterating on a prior generated file (pass its fileMetadataId via inputFiles).

**WHEN NOT TO USE — prefer the purpose-built tool first:**
- \`.xlsx\` → use \`excel\` (one-shot, no install cost).
- \`.pdf\` → use \`pdf\`.
- \`.docx\` → use \`docx\`.
- Reading or analysing an image → use \`image\`.
- Fetching web pages or APIs → use \`web\` (the sandbox has no internet beyond package registries).

**RUNTIMES:** Python 3.12 + uv; Node 24 + npm. No bash, no other languages.

**PACKAGES:** pass with \`packages\`. By default \`pip\` blocks sdist (\`--only-binary=:all:\`) and \`npm\` skips install scripts (\`--ignore-scripts\`). Override per call with \`allowSdist: true\` / \`allowInstallScripts: true\` — these are audit-logged. Pinned versions like \`python-pptx==1.0.2\` are strongly preferred over floating versions.

**FILE LAYOUT INSIDE THE SANDBOX:**
- User code: \`/workspace/code/main.py\` (or \`.js\`).
- Read inputs from \`/workspace/input/<name>\` — they appear there only if you passed \`inputFiles\`.
- Write outputs to \`/workspace/output/\`. ONLY this directory is harvested. Anything written elsewhere (\`/tmp\`, \`/workspace\`) is discarded.

**EGRESS:** outbound HTTPS is allowed ONLY to \`pypi.org\`, \`files.pythonhosted.org\`, \`registry.npmjs.org\`, \`objects.githubusercontent.com\`, \`codeload.github.com\`. Do not call external APIs — they will fail with \`EGRESS_DENIED\`. Use the \`web\` tool for HTTP fetches.

**LIMITS:**
- Wall clock ≤ 300s (\`timeoutMs\`).
- Memory ≤ 1 GB.
- Output total ≤ 100 MB; per file ≤ 50 MB.
- Stdout / stderr previews are 16 KB each; over-cap text is stored as a file the user can open.

**NO CROSS-CALL STATE:** every call gets a fresh container. Anything you write to \`/workspace\` outside \`output/\` is gone after the call. To iterate on a previous result, pass that result's \`fileMetadataId\` as an \`inputFiles\` entry — the file mounts read-only at \`/workspace/input/<name>\`.

**ERROR HANDLING:** results carry \`status\` + \`errorCode\`. Map to recovery:
- \`TIMEOUT\` — raise \`timeoutMs\` or split work.
- \`OOM\` — reduce memory footprint, stream rather than buffer.
- \`EGRESS_DENIED\` — don't retry; redesign without the call.
- \`INSTALL_FAILED\` — read \`stderrPreview\`, fix the package spec.
- \`PACKAGE_NOT_FOUND\` — your package name is wrong; try the actual name.
- \`QUOTA_EXCEEDED\` — org concurrency or daily CPU budget hit; wait and retry.
- \`RUNTIME_ERROR\` — exception in your code; fix it.
- \`SPAWNER_UNAVAILABLE\` — infra issue; retry once.

**EXAMPLE — 3-slide pptx:**
\`\`\`
language: 'python'
packages: ['python-pptx==1.0.2']
purpose: 'Generate a 3-slide intro deck for Tale'
code: |
  from pptx import Presentation
  from pptx.util import Inches
  p = Presentation()
  for i, title in enumerate(['Tale', 'Self-hosted', 'AI agents on your data']):
      slide = p.slides.add_slide(p.slide_layouts[0])
      slide.shapes.title.text = title
  p.save('/workspace/output/intro.pptx')
\`\`\`

The returned \`files[0].fileMetadataId\` can be passed to \`document_write\` to save the deck to the documents hub, or passed back as \`inputFiles\` on a subsequent \`code_run\` call to edit it.`,
    inputSchema: codeRunArgs,

    execute: async (
      ctx: ToolCtx,
      args: CodeRunInput,
    ): Promise<CodeRunResult> => {
      const { organizationId, threadId, messageId, userId } = ctx;
      if (!organizationId) {
        throw new Error(
          'code_run requires organizationId in the tool context.',
        );
      }
      if (!userId) {
        throw new Error('code_run requires userId in the tool context.');
      }
      const accessibleThreadIds = threadId ? [threadId] : [];
      const result = await ctx.runAction(
        internal.node_only.sandbox.internal_actions.executeCode,
        {
          organizationId,
          uploadedBy: userId,
          ...(threadId !== undefined && { threadId }),
          accessibleThreadIds,
          ...(messageId !== undefined && { messageId }),
          language: args.language,
          code: args.code,
          ...(args.packages !== undefined && { packages: args.packages }),
          ...(args.inputFiles !== undefined && {
            inputFiles: args.inputFiles,
          }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
          ...(args.allowSdist !== undefined && {
            allowSdist: args.allowSdist,
          }),
          ...(args.allowInstallScripts !== undefined && {
            allowInstallScripts: args.allowInstallScripts,
          }),
          purpose: args.purpose,
        },
      );

      if (result.success) {
        return {
          success: true,
          executionId: String(result.executionId),
          status: 'completed',
          // result.exitCode is number for completed; preserve narrowing.
          exitCode: result.exitCode ?? 0,
          stdoutPreview: result.stdoutPreview,
          stderrPreview: result.stderrPreview,
          durationMs: result.durationMs,
          truncated: result.truncated,
          files: result.files.map((f) => ({
            name: f.name,
            fileMetadataId: String(f.fileMetadataId),
            size: f.size,
            contentType: f.contentType,
          })),
        };
      }

      return {
        success: false,
        executionId: String(result.executionId),
        status: result.status,
        exitCode: result.exitCode,
        errorCode: result.errorCode ?? 'RUNTIME_ERROR',
        errorMessage: result.errorMessage ?? 'Unknown error',
        stdoutPreview: result.stdoutPreview,
        stderrPreview: result.stderrPreview,
        durationMs: result.durationMs,
        truncated: result.truncated,
        files: [],
      };
    },
  }),
} as const satisfies ToolDefinition;
