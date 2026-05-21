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
import { ConvexError } from 'convex/values';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { resolveArtifactFiles } from '../../artifacts/resolve_files';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import {
  InvalidArtifactPathError,
  isRunnableArtifactType,
  runnableLanguage,
  validatePath,
} from './shared';

const artifactRunArgs = z.object({
  artifactId: z
    .string()
    .describe(
      'The id of the python_runnable or node_runnable artifact to execute. Pass the artifactId returned by a prior `artifact_create` / `artifact_edit` call.',
    ),
  path: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Optional file path within the artifact to execute. Defaults to the artifact\'s `entryFile`. Use this to run a sibling script in the same project — e.g. the artifact contains `main.py` (entry) and `validate.py` (validator); pass `path: "validate.py"` to run the validator instead. Sibling files are staged on disk so the executed script can `import` / `require` them.',
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
  // NOTE: `allowSdist` / `allowInstallScripts` were previously LLM-callable
  // here. They were removed (round-2 R2-B4) because a prompt-injected agent
  // could disable the install-safety guards then ship an evil-pkg whose
  // postinstall hook runs inside the runtime container. Installs are now
  // hardcoded to use `pip --only-binary=:all:` + `npm --ignore-scripts`.
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

USE THIS TOOL after \`artifact_create\` (to run the entry script) or after \`artifact_edit\` (to re-run the patched revision). Pass \`path\` to run a SIBLING file in the same artifact instead of the default entry — useful when a project has both a generator script and a separate validator. The previously-configured \`runPackages\` are reused unless you override.

**ONE ARTIFACT, MANY RUNNABLE FILES:**
- Keep multi-script workflows (e.g. generator + validator) in ONE artifact. Don't call \`artifact_create\` twice.
- Add sibling scripts via \`artifact_edit({mode: 'rewrite', path: 'validate.py', content: ...})\`.
- Run any file with \`artifact_run({artifactId, path: 'validate.py'})\`. \`path\` defaults to the artifact's \`entryFile\`.
- All files in the project are staged on disk under \`/workspace/code/<path>\`, so the executed script can \`import helpers\` (Python) / \`require('./helpers')\` (Node) / \`subprocess.run(['python', 'validate.py'])\` to other artifact files.
- **Each \`artifact_run\` is a FRESH container.** State written to \`/workspace/output/\` in run #1 is NOT visible to run #2. If a validator needs to see the generator's output, the validator must be invoked FROM the generator (via \`subprocess\` / \`import\`), not as a separate \`artifact_run\` call.

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

      // Resolve which file to execute. Defaults to entryFile; LLM may pass
      // `path` to run a sibling script in the same project. All files in
      // the project are staged into /workspace/code/<path> so the executed
      // script can `import` / `require` siblings.
      const resolved = resolveArtifactFiles(artifact);
      let targetPath: string;
      if (args.path !== undefined) {
        try {
          targetPath = validatePath(args.path);
        } catch (err) {
          if (err instanceof InvalidArtifactPathError) {
            return {
              success: false,
              message: `path "${args.path}" rejected (${err.code}): ${err.message}`,
            };
          }
          throw err;
        }
      } else {
        targetPath = resolved.entryFile;
      }
      const targetEntry = resolved.files.find((f) => f.path === targetPath);
      if (!targetEntry) {
        const known = resolved.files.map((f) => f.path).join(', ');
        return {
          success: false,
          message: `Artifact ${args.artifactId} has no file at path "${targetPath}". Available paths: ${known}.`,
        };
      }
      if (targetEntry.content.length === 0) {
        return {
          success: false,
          message: `Artifact ${args.artifactId} file "${targetPath}" is empty. Call artifact_edit({mode: 'rewrite', path: "${targetPath}", content: ...}) first.`,
        };
      }

      // Refresh the run-state row in case the user already saw a previous
      // run's status — initArtifactRun resets runStatus to 'queued', clears
      // runProgress / runErrorCode / etc. so the canvas right pane updates
      // cleanly during this new run. The artifact row's persistent
      // runPackages / runOptions are NOT overwritten here; per-call args
      // are applied transiently to the spawner request below.
      //
      // initArtifactRun throws RUN_IN_FLIGHT if another run is still active
      // on this artifact — surface as a structured failure so the LLM waits
      // instead of racing with itself.
      try {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.initArtifactRun,
          { artifactId },
        );
      } catch (err) {
        if (
          err instanceof ConvexError &&
          typeof err.data === 'object' &&
          err.data !== null &&
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
          (err.data as { code?: string }).code === 'RUN_IN_FLIGHT'
        ) {
          return {
            success: false,
            message: `Artifact ${args.artifactId} already has a run in flight. Wait for the current run to finish, then call artifact_run again. Do NOT call artifact_create or stack parallel runs.`,
          };
        }
        throw err;
      }

      const effectivePackages = args.packages ?? artifact.runPackages ?? [];
      // `allowSdist` / `allowInstallScripts` are no longer LLM-callable; the
      // legacy persisted `artifact.runOptions` is intentionally ignored.
      // Server-side, `executeCode` always sends `false` for both flags.

      // Resolve the agentSlug attribution from threadMetadata. The audit
      // row records this so per-agent usage / model-cost analytics
      // (project_usage_analytics) can attribute sandbox spend correctly.
      // Best-effort: if the lookup fails or the metadata row is missing,
      // we just skip the field — sandbox execution is not blocked.
      const threadMeta = await ctx
        .runQuery(internal.threads.internal_queries.getThreadMetadata, {
          threadId,
          callerOrgId: organizationId,
        })
        .catch((err) => {
          console.warn(
            '[artifact_run_tool] threadMetadata lookup failed:',
            err,
          );
          return null;
        });
      const agentSlug = threadMeta?.agentSlug;

      let raw: unknown;
      try {
        raw = await ctx.runAction(
          internal.node_only.sandbox.internal_actions.executeCode,
          {
            organizationId,
            uploadedBy: userId,
            threadId,
            ...(messageId !== undefined && { messageId }),
            ...(options.toolCallId && { toolCallId: options.toolCallId }),
            ...(agentSlug !== undefined && { agentSlug }),
            language,
            code: targetEntry.content,
            // Stage every file in the project so siblings are importable.
            // The spawner writes each to /workspace/code/<path>; `code`
            // (=targetEntry.content) is mirrored to main.{py,js} which the
            // runtime entrypoint exec()s. Old spawner versions ignore
            // `files`/`entryPath` and still execute `code` correctly.
            files: resolved.files.map((f) => ({
              path: f.path,
              content: f.content,
            })),
            entryPath: targetPath,
            ...(effectivePackages.length > 0 && {
              packages: effectivePackages,
            }),
            ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
            // allowSdist / allowInstallScripts intentionally omitted — the
            // action hardcodes both to false (round-2 R2-B4).
            purpose: `artifact_run: ${artifact.title}`,
            artifactId,
          },
        );
      } catch (err) {
        // The action's contract is: infra failures → finalize THEN throw,
        // user-code failures → finalize THEN return. So if we land here,
        // either (a) reserveSlotAndInsert rejected with QUOTA_EXCEEDED
        // before the audit row existed, or (b) spawnerExecute failed and
        // failExecution already wrote terminal state to BOTH rows. In
        // case (a) the artifact is still 'queued' from initArtifactRun
        // above, so we must finalize it ourselves; case (b) is idempotent
        // because finalizeArtifactRun's terminal guard no-ops on the
        // second write.
        const isConvexError = err instanceof ConvexError;
        const code =
          isConvexError &&
          typeof err.data === 'object' &&
          err.data !== null &&
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
          typeof (err.data as { code?: string }).code === 'string'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
              (err.data as { code: string }).code
            : undefined;
        const errMessage = err instanceof Error ? err.message : String(err);
        const runErrorCode =
          code === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'SPAWNER_UNAVAILABLE';
        try {
          // No runExecutionId here: when reserveSlotAndInsert throws (e.g.
          // QUOTA_EXCEEDED pre-insert) no audit row exists; when
          // spawnerExecute throws, the action's failExecution already wrote
          // the executionId onto the artifact row, and the terminal guard
          // makes this call a no-op.
          await ctx.runMutation(
            internal.artifacts.internal_mutations.finalizeArtifactRun,
            {
              artifactId,
              runStatus: 'failed',
              runErrorCode,
              runErrorMessage: errMessage,
              runOutputFiles: [],
            },
          );
        } catch (finalizeErr) {
          console.warn(
            '[artifact_run_tool] finalizeArtifactRun after executeCode throw failed:',
            finalizeErr,
          );
        }
        const message =
          runErrorCode === 'QUOTA_EXCEEDED'
            ? `Run REFUSED: QUOTA_EXCEEDED — ${errMessage}. Don't retry; tell the user the org's daily sandbox budget is exhausted.`
            : `Run FAILED before completion: ${errMessage}. One retry is fine if the underlying cause was transient; otherwise tell the user the sandbox is unavailable.`;
        return {
          success: false,
          message,
        };
      }
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
