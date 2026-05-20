/**
 * Convex Tool: artifact_run
 *
 * Executes a `python_runnable` or `node_runnable` artifact in the sandbox.
 * `artifact_create` writes the source (and persists `runPackages` /
 * `runOptions` on the row); this tool is the explicit, LLM-driven trigger
 * to actually run it. Returns the full run outcome — including
 * `runStatus`, `runErrorCode`, `runStderrPreview`, generated files — so
 * the LLM can react to failures by calling `artifact_edit` then
 * `artifact_run` again.
 *
 * Splitting execution out of `artifact_create` (Refinement 4) is what
 * prevents the model from "fixing" a failure by emitting another
 * `artifact_create` and stacking up duplicate artifact tabs.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { isRunnableArtifactType, runnableLanguage } from './shared';

const artifactRunArgs = z.object({
  artifactId: z
    .string()
    .describe(
      'The id of the python_runnable or node_runnable artifact to execute. Pass the artifactId returned by a prior `artifact_create` / `artifact_edit` call.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .optional()
    .describe(
      'Wall-clock cap including package install, in milliseconds. Default 30000, max 300000.',
    ),
  packages: z
    .array(z.string().max(120))
    .max(20)
    .optional()
    .describe(
      'One-off package list override for this run only. Usually omitted — the artifact row already carries the `packages` you supplied at create time.',
    ),
  allowSdist: z
    .boolean()
    .optional()
    .describe(
      "python_runnable one-off override. Defaults to the artifact row's setting (false unless explicitly enabled at create time).",
    ),
  allowInstallScripts: z
    .boolean()
    .optional()
    .describe(
      "node_runnable one-off override. Defaults to the artifact row's setting (false unless explicitly enabled at create time).",
    ),
});

type ArtifactRunInput = z.infer<typeof artifactRunArgs>;

interface RunOutputFile {
  name: string;
  storageId: string;
  fileMetadataId: string;
  size: number;
  contentType: string;
}

interface ArtifactRunSuccess {
  success: boolean; // runStatus === 'completed' AND files.length > 0
  artifactId: string;
  revision: number;
  runStatus: 'completed' | 'failed' | 'cancelled';
  runExitCode: number | null;
  runErrorCode?: string;
  runErrorMessage?: string;
  runStdoutPreview: string;
  runStderrPreview: string;
  durationMs: number;
  files: RunOutputFile[];
  executionId: string;
  message: string;
}

interface ArtifactRunFailure {
  success: false;
  message: string;
}

type ArtifactRunResult = ArtifactRunSuccess | ArtifactRunFailure;

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
  files: RunOutputFile[];
}

export const artifactRunTool = {
  name: 'artifact_run' as const,
  tool: createTool({
    description: `**artifact_run** — execute a runnable artifact (\`python_runnable\` or \`node_runnable\`) in the sandbox and return the run outcome.

USE THIS TOOL after \`artifact_create\` (to actually run a newly authored script) or after \`artifact_edit\` (to re-run the patched revision). The artifact's source is read from the row; the previously-configured \`runPackages\` / \`runOptions\` are reused automatically unless you pass an override.

**DO NOT use this tool for:**
- Static artifact types (\`html\`, \`svg\`, \`mermaid\`, \`markdown\`, \`code\`) — those render in the browser, not the sandbox. The tool will refuse them with a clear error.
- Free-form code that isn't tied to an artifact. There is no other path; everything goes through an artifact.

**SANDBOX ENVIRONMENT:**
- Python 3.12 / Node 24 with on-demand \`pip\` / \`npm\` install per the row's \`runPackages\`.
- Wall-clock ≤300s (default 30s; raise via \`timeoutMs\`).
- Memory cap 1 GB, 1 CPU.
- Egress restricted to package registries (\`pypi.org\`, \`files.pythonhosted.org\`, \`registry.npmjs.org\`, GitHub release endpoints). Any other host returns \`EGRESS_DENIED\`.
- The artifact's \`content\` is written to \`/workspace/code/main.{py,js}\` and executed.
- Output files **must** be written under \`/workspace/output/\` to be collected.
- stdout/stderr captured (16 KB preview returned; full text in \`_storage\` if larger).

**ON FAILURE — read \`runStderrPreview\` BEFORE replying to the user.** Recovery table:

| \`runErrorCode\` | Meaning | Recovery |
|---|---|---|
| \`RUNTIME_ERROR\` | Code threw (most common) | Read stderr traceback, \`artifact_edit\` with \`mode: "patch"\` to fix, then \`artifact_run\` again |
| \`TIMEOUT\` | Wall-clock exceeded | Raise \`timeoutMs\` on the next \`artifact_run\` call, or \`artifact_edit\` to split the work |
| \`OOM\` | Memory cap hit (1 GB) | \`artifact_edit\` to stream / reduce data in memory, then \`artifact_run\` again |
| \`EGRESS_DENIED\` | Tried to reach a non-registry host | \`artifact_edit\` to remove the external call — use the \`web\` tool instead |
| \`INSTALL_FAILED\` | Package install errored | Read stderr, \`artifact_edit\` with a corrected \`packages\` list, then \`artifact_run\` again |
| \`PACKAGE_NOT_FOUND\` | A spec doesn't resolve | \`artifact_edit\` with an alternate package name |
| \`QUOTA_EXCEEDED\` | Org daily CPU cap | Don't retry — tell the user to wait |
| \`SPAWNER_UNAVAILABLE\` | Transient infra | One \`artifact_run\` retry is fine; if it fails again, surface to user |

**HARD RULE — NEVER tell the user the file is ready / generated / done unless \`success === true\` AND \`files.length > 0\`.** That is the most reported bug for this flow.

**RESPONSE:** returns \`runStatus\`, \`runExitCode\`, optional \`runErrorCode\` / \`runErrorMessage\`, \`runStdoutPreview\`, \`runStderrPreview\`, \`files[]\` (the deliverable output files, each with \`name\` / \`storageId\` / \`size\` / \`contentType\`), \`durationMs\`, and \`executionId\` (audit-row link).`,
    inputSchema: artifactRunArgs,
    execute: async (
      ctx: ToolCtx,
      args: ArtifactRunInput,
      options: ToolExecutionOptions,
    ): Promise<ArtifactRunResult> => {
      const { organizationId, threadId, messageId, userId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_run requires organizationId and threadId in the tool context.',
        };
      }
      if (!userId) {
        return {
          success: false,
          message: 'artifact_run requires userId in the tool context.',
        };
      }

      // `toId` is a pure cast; it never throws. The Convex `v.id('artifacts')`
      // validator inside `runQuery(getById)` is the real throw site for a
      // malformed id, so wrap THAT call, not toId. Mirrors the pattern in
      // artifact_edit_tool.ts.
      const artifactId = toId<'artifacts'>(args.artifactId);
      let artifact;
      try {
        artifact = await ctx.runQuery(
          internal.artifacts.internal_queries.getById,
          {
            artifactId,
            expectedOrganizationId: organizationId,
            expectedThreadId: threadId,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Artifact id "${args.artifactId}" is malformed or inaccessible: ${message}`,
        };
      }
      if (!artifact) {
        return {
          success: false,
          message: `Artifact ${args.artifactId} not found in this thread.`,
        };
      }
      if (!isRunnableArtifactType(artifact.type)) {
        return {
          success: false,
          message: `Artifact ${args.artifactId} is type "${artifact.type}". artifact_run only runs python_runnable / node_runnable types. Static types (html / svg / mermaid / markdown / code) render in the browser, not in the sandbox.`,
        };
      }
      const language = runnableLanguage(artifact.type);
      if (!language) {
        return {
          success: false,
          message: `Artifact ${args.artifactId} type "${artifact.type}" has no associated sandbox runtime.`,
        };
      }

      // Refresh the run-state row in case the user already saw a previous
      // run's status — initArtifactRun resets runStatus to 'queued', clears
      // runProgress / runErrorCode / etc. so the canvas right pane updates
      // cleanly during this new run. The artifact row's persistent
      // runPackages / runOptions are NOT overwritten here; per-call args
      // are applied transiently to the spawner request below.
      await ctx.runMutation(
        internal.artifacts.internal_mutations.initArtifactRun,
        { artifactId },
      );

      const effectivePackages = args.packages ?? artifact.runPackages ?? [];
      const effectiveAllowSdist =
        args.allowSdist ?? artifact.runOptions?.allowSdist;
      const effectiveAllowInstallScripts =
        args.allowInstallScripts ?? artifact.runOptions?.allowInstallScripts;

      const raw: unknown = await ctx.runAction(
        internal.node_only.sandbox.internal_actions.executeCode,
        {
          organizationId,
          uploadedBy: userId,
          threadId,
          accessibleThreadIds: [threadId],
          ...(messageId !== undefined && { messageId }),
          ...(options.toolCallId && { toolCallId: options.toolCallId }),
          language,
          code: artifact.content,
          ...(effectivePackages.length > 0 && { packages: effectivePackages }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
          ...(effectiveAllowSdist !== undefined && {
            allowSdist: effectiveAllowSdist,
          }),
          ...(effectiveAllowInstallScripts !== undefined && {
            allowInstallScripts: effectiveAllowInstallScripts,
          }),
          purpose: `artifact_run: ${artifact.title}`,
          artifactId,
        },
      );
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- executeCode is typed `any` via the stale agent-SDK codegen path; the runtime shape is ExecuteCodeResult (asserted at the action return site).
      const run = raw as ExecuteCodeResult;

      const completed = run.status === 'completed';
      const hasFiles = run.files.length > 0;
      const success = completed && hasFiles;
      let message: string;
      if (success) {
        message = `Ran "${artifact.title}" successfully; produced ${run.files.length} output file(s) in ${run.durationMs}ms.`;
      } else if (run.errorCode) {
        message = `Run FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read runStderrPreview and call artifact_edit on the same artifactId to fix, then artifact_run again. Do NOT call artifact_create — that creates a duplicate. Do NOT say the file is ready.`;
      } else {
        message = `Run finished with status=${run.status} but produced no output files. Inspect runStdoutPreview / runStderrPreview and decide whether to artifact_edit + re-run.`;
      }

      return {
        success,
        artifactId: args.artifactId,
        revision: artifact.revision,
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
        message,
      };
    },
  }),
} as const satisfies ToolDefinition;
