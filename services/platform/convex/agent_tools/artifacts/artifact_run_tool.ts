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
import type { SandboxStepResult } from '../../sandbox/wire';
import type { ToolDefinition } from '../types';
import {
  InvalidArtifactPathError,
  isRunnableArtifactType,
  runnableLanguage,
  validatePath,
} from './shared';

/**
 * Cap matches `services/sandbox/src/wire.ts:MAX_STEPS_PER_REQUEST`. We
 * duplicate the literal here because the spawner wire module is in a
 * separate package; the spawner's own validator re-enforces the same cap.
 */
const ARTIFACT_RUN_MAX_STEPS = 10;

/**
 * Filenames the spawner reserves for the runtime entrypoint script (the
 * runtime image's docker entrypoint exec()s these fixed paths). A step
 * path matching the reserved filename would cause the wrapper script
 * the spawner generates to invoke itself. Surface this as a friendly
 * tool-side error before it round-trips to the spawner.
 */
const RESERVED_STEP_FILENAME_BY_LANGUAGE: Record<'python' | 'node', string> = {
  python: 'main.py',
  node: 'main.js',
};

const artifactRunArgs = z
  .object({
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
        "Single-script mode: file path within the artifact to execute. Defaults to the artifact's `entryFile`. Mutually exclusive with `steps`. Sibling files are still staged on disk so the executed script can `import` / `require` them.",
      ),
    steps: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .max(200)
            .describe(
              "Path inside the artifact's file tree to execute as this step.",
            ),
        }),
      )
      .min(1)
      .max(ARTIFACT_RUN_MAX_STEPS)
      .optional()
      .describe(
        'Multi-script mode: an ordered list of artifact files to execute IN SEQUENCE inside a single sandbox container. Each step sees the previous steps\' writes to `/workspace/output/`, so `[{path:"gen.py"},{path:"validate.py"}]` lets the validator inspect what the generator just wrote. Fail-fast: a non-zero exit aborts the remaining steps. Mutually exclusive with `path`.',
      ),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .optional()
      .describe(
        'Wall-clock cap including package install, in milliseconds. Applies to the WHOLE run (all steps combined). Default 30000, max 300000.',
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
  })
  .superRefine((val, ctx) => {
    if (val.path !== undefined && val.steps !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message:
          '`path` and `steps` are mutually exclusive. Use `steps` for multi-step workflows; use `path` (or omit both) for a single-script run.',
      });
    }
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
  /**
   * Populated only when the request used multi-step mode. One entry per
   * requested step in submission order with per-step outcome. `skipped`
   * means a prior step's failure aborted this one.
   */
  steps?: SandboxStepResult[];
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
  steps?: SandboxStepResult[];
}

export const artifactRunTool = {
  name: 'artifact_run' as const,
  tool: createTool({
    description: `**artifact_run** — execute a runnable artifact (\`python_runnable\` or \`node_runnable\`) in the sandbox and return the run outcome.

USE THIS TOOL after \`artifact_create\` (to run the entry script) or after \`artifact_edit\` (to re-run the patched revision). The previously-configured \`runPackages\` are reused unless you override.

**WORKSPACE LIFECYCLE — READ FIRST.**
- Every \`artifact_run\` invocation gets a **brand-new** \`/workspace/\` directory. Files you wrote to \`/workspace/output/\` in a previous run are **NOT** visible in the next run. (Output artifacts are persisted separately as \`runOutputFiles\` on the artifact row, but those are NOT re-staged into the sandbox.)
- Anything your script wants to read from \`/workspace/output/\` must be **created in the same run**. Do NOT write code like \`Presentation("/workspace/output/foo.pptx")\` (python-pptx) expecting a prior run's file to be there — \`Presentation(path)\` *opens* an existing file. To create new, call \`Presentation()\` (no arg), populate, then \`.save(...)\`.

**MULTI-STEP WORKFLOWS — preferred over splitting into multiple \`artifact_run\` calls.**

For generate-then-validate / build-then-test patterns, pass \`steps\` instead of \`path\`. All steps execute **sequentially inside the same container** and share \`/workspace/\`, so step 2 sees what step 1 wrote.

\`\`\`json
artifact_run({
  artifactId,
  steps: [{ "path": "gen.py" }, { "path": "validate.py" }]
})
\`\`\`

- Fail-fast: a non-zero exit from any step aborts the remaining steps. Each step's exit code + duration come back in \`steps[]\` with \`status: "completed" | "failed" | "skipped"\`.
- All files in the artifact are staged under \`/workspace/code/<path>\`, so step scripts can also \`import\` / \`require\` siblings the normal way.
- Up to ${ARTIFACT_RUN_MAX_STEPS} steps per call. The overall \`timeoutMs\` is shared across all steps.
- Step paths must reference existing files in the artifact and **cannot be \`main.py\` / \`main.js\`** — those names are reserved for the runtime entrypoint. Rename your script (e.g. \`build.py\`).

**Single-script mode** (use when there's nothing to chain): omit both \`steps\` and \`path\` to run the artifact's \`entryFile\`, or pass \`path\` to run a specific sibling file. \`subprocess.run(['python', 'validate.py'])\` from within the entry script also works if you want orchestration logic in-script.

**ONE ARTIFACT, MANY RUNNABLE FILES.** Keep multi-script workflows in ONE artifact. Do NOT call \`artifact_create\` twice for "generator" and "validator" — add sibling files via \`artifact_edit({mode:'rewrite', path:'validate.py', content:...})\` and reference them via \`steps\`.

**DO NOT use this tool for:**
- Static artifact types (\`html\`, \`svg\`, \`mermaid\`, \`markdown\`, \`code\`) — those render in the browser, not the sandbox. The tool will refuse them with a clear error.
- Free-form code that isn't tied to an artifact. There is no other path; everything goes through an artifact.

**SANDBOX ENVIRONMENT:**
- Python 3.12 / Node 24 with on-demand \`pip\` / \`npm\` install per the row's \`runPackages\`.
- Wall-clock ≤300s (default 30s; raise via \`timeoutMs\`). Applies to the WHOLE run.
- Memory cap 1 GB, 1 CPU.
- Egress restricted to package registries (\`pypi.org\`, \`files.pythonhosted.org\`, \`registry.npmjs.org\`, GitHub release endpoints). Any other host returns \`EGRESS_DENIED\`.
- Output files **must** be written under \`/workspace/output/\` to be collected.
- stdout/stderr captured (16 KB preview returned; full text in \`_storage\` if larger). In multi-step mode the wrapper prints a \`====== STEP N/M: <path> ======\` banner around each step so the combined log stays readable.

**ON FAILURE — read \`runStderrPreview\` BEFORE replying to the user.** When a multi-step run fails, check \`steps[]\` to see WHICH step failed and only re-run / patch that one. Recovery table:

| \`runErrorCode\` | Meaning | Recovery |
|---|---|---|
| \`RUNTIME_ERROR\` | Code threw (most common) | Read stderr traceback, \`artifact_edit\` with \`mode: "patch"\` to fix the offending step, then \`artifact_run\` again |
| \`TIMEOUT\` | Wall-clock exceeded | Raise \`timeoutMs\` on the next \`artifact_run\` call, or \`artifact_edit\` to split the work |
| \`OOM\` | Memory cap hit (1 GB) | \`artifact_edit\` to stream / reduce data in memory, then \`artifact_run\` again |
| \`EGRESS_DENIED\` | Tried to reach a non-registry host | \`artifact_edit\` to remove the external call — use the \`web\` tool instead |
| \`INSTALL_FAILED\` | Package install errored | Read stderr, \`artifact_edit\` with a corrected \`packages\` list, then \`artifact_run\` again |
| \`PACKAGE_NOT_FOUND\` | A spec doesn't resolve | \`artifact_edit\` with an alternate package name |
| \`QUOTA_EXCEEDED\` | Org daily CPU cap | Don't retry — tell the user to wait |
| \`SPAWNER_UNAVAILABLE\` | Transient infra | One \`artifact_run\` retry is fine; if it fails again, surface to user |

**HARD RULE — NEVER tell the user the file is ready / generated / done unless \`success === true\` AND \`files.length > 0\`.** That is the most reported bug for this flow.

**RESPONSE:** returns \`runStatus\`, \`runExitCode\`, optional \`runErrorCode\` / \`runErrorMessage\`, \`runStdoutPreview\`, \`runStderrPreview\`, \`files[]\` (the deliverable output files, each with \`name\` / \`storageId\` / \`size\` / \`contentType\`), \`durationMs\`, \`executionId\` (audit-row link), and \`steps[]\` when multi-step.`,
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

      // Resolve which files to execute. Two modes:
      //   - Multi-step (`args.steps`): each step path must reference an
      //     existing artifact file, must NOT be the reserved entrypoint
      //     filename (the spawner generates a wrapper at that path), and
      //     must be non-empty. All sibling files are still staged on disk
      //     so steps can `import` / `require` each other.
      //   - Single-script: existing behaviour. `args.path` or entryFile
      //     names the executed file; its content is sent as `code`.
      const resolved = resolveArtifactFiles(artifact);
      const reservedEntry = RESERVED_STEP_FILENAME_BY_LANGUAGE[language];

      type DispatchSingle = {
        kind: 'single';
        targetPath: string;
        targetContent: string;
      };
      type DispatchSteps = {
        kind: 'steps';
        stepPaths: string[];
      };
      let dispatch: DispatchSingle | DispatchSteps;

      if (args.steps !== undefined) {
        const stepPaths: string[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < args.steps.length; i += 1) {
          const raw = args.steps[i]?.path ?? '';
          let validated: string;
          try {
            validated = validatePath(raw);
          } catch (err) {
            if (err instanceof InvalidArtifactPathError) {
              return {
                success: false,
                message: `steps[${i}].path "${raw}" rejected (${err.code}): ${err.message}`,
              };
            }
            throw err;
          }
          if (validated === reservedEntry) {
            return {
              success: false,
              message: `steps[${i}].path "${validated}" collides with the reserved entrypoint filename. Rename the script (e.g. "${validated.replace(/main\./, 'step.')}") and retry.`,
            };
          }
          if (seen.has(validated)) {
            return {
              success: false,
              message: `steps[${i}].path "${validated}" appears twice. Each step path must be unique within one artifact_run call.`,
            };
          }
          seen.add(validated);
          const entry = resolved.files.find((f) => f.path === validated);
          if (!entry) {
            const known = resolved.files.map((f) => f.path).join(', ');
            return {
              success: false,
              message: `steps[${i}].path "${validated}" is not in artifact ${args.artifactId}. Available paths: ${known}. Call artifact_edit to create the file first if you intended to add it.`,
            };
          }
          if (entry.content.length === 0) {
            return {
              success: false,
              message: `steps[${i}].path "${validated}" is empty. Call artifact_edit({mode: 'rewrite', path: "${validated}", content: ...}) first.`,
            };
          }
          stepPaths.push(validated);
        }
        dispatch = { kind: 'steps', stepPaths };
      } else {
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
        dispatch = {
          kind: 'single',
          targetPath,
          targetContent: targetEntry.content,
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

      // Audit-row attribution: the spawner records `path` for forensic
      // grep. For single-script that's the executed file; for multi-step
      // pick the first step so the column still points at a meaningful
      // file in the artifact tree.
      const auditEntryPath =
        dispatch.kind === 'single'
          ? dispatch.targetPath
          : dispatch.stepPaths[0];

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
            // Single-script mode sends `code` (mirrored into main.{py,js}
            // by the spawner). Multi-step mode sends `steps[]` and lets the
            // spawner generate the wrapper itself. Mutual exclusion is
            // enforced by the spawner's own validator.
            ...(dispatch.kind === 'single' && { code: dispatch.targetContent }),
            ...(dispatch.kind === 'steps' && { steps: dispatch.stepPaths }),
            // Stage every file in the project so siblings are importable.
            // The spawner writes each to /workspace/code/<path>.
            files: resolved.files.map((f) => ({
              path: f.path,
              content: f.content,
            })),
            ...(auditEntryPath !== undefined && { entryPath: auditEntryPath }),
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

      // Locate the first failed step (if multi-step) so the message can
      // name it directly — the LLM should patch THAT step, not the others.
      const failedStep =
        run.steps?.find((s) => s.status === 'failed') ?? undefined;
      const totalSteps = run.steps?.length ?? 0;
      const failedIdx =
        failedStep && run.steps
          ? run.steps.findIndex((s) => s === failedStep)
          : -1;
      const stepSuffix =
        failedStep && totalSteps > 0
          ? ` Step ${failedIdx + 1}/${totalSteps} ("${failedStep.path}") exited ${failedStep.exitCode ?? 'null'}; earlier steps completed.`
          : '';

      let message: string;
      if (success) {
        if (run.steps && run.steps.length > 0) {
          const pathList = run.steps.map((s) => s.path).join(' → ');
          message = `Ran "${artifact.title}" successfully across ${run.steps.length} step(s) [${pathList}]; produced ${run.files.length} output file(s) in ${run.durationMs}ms.`;
        } else {
          message = `Ran "${artifact.title}" successfully; produced ${run.files.length} output file(s) in ${run.durationMs}ms.`;
        }
      } else if (run.errorCode) {
        message = `Run FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}.${stepSuffix} Read runStderrPreview and call artifact_edit on the SAME artifactId to fix${failedStep ? ` "${failedStep.path}"` : ''}, then artifact_run again. Do NOT call artifact_create — that creates a duplicate. Do NOT say the file is ready.`;
      } else {
        message = `Run finished with status=${run.status} but produced no output files.${stepSuffix} Inspect runStdoutPreview / runStderrPreview and decide whether to artifact_edit + re-run.`;
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
        ...(run.steps !== undefined && { steps: run.steps }),
        message,
      };
    },
  }),
} as const satisfies ToolDefinition;
