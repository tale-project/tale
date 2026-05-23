/**
 * Convex Tool: artifact_run
 *
 * Executes a `script_runnable` artifact (or its legacy
 * `python_runnable` / `node_runnable` predecessors) in the sandbox.
 * `artifact_create` creates the (empty) artifact and persists
 * `runPackages` / `runPackagesByLang` / `runOptions` on the row;
 * `artifact_file_create` / `artifact_file_update` populate the source
 * files. This tool is the explicit, LLM-driven trigger to actually run
 * them. Returns the full run outcome — including `runStatus`,
 * `runErrorCode`, `runStderrPreview`, generated files — so the LLM can
 * react to failures by calling `artifact_file_update` then
 * `artifact_run` again.
 *
 * Per-step runtime selection: each executed file's interpreter is
 * inferred from extension (`.py` → python3, `.js`/`.cjs`/`.mjs` →
 * node). When the dispatched file set spans both runtimes, the
 * spawner is called with `language: 'polyglot'` and the entrypoint
 * installs both pip and npm package buckets in one container.
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
  classifyPackages,
  inferStepLanguage,
  isRunnableArtifactType,
  refinePackagesObject,
  runnableLanguage,
  validatePath,
} from './shared';

/**
 * Cap matches `services/sandbox/src/wire.ts:MAX_STEPS_PER_REQUEST`. We
 * duplicate the literal here because the spawner wire module is in a
 * separate package; the spawner's own validator re-enforces the same cap.
 */
const ARTIFACT_RUN_MAX_STEPS = 10;

const artifactRunArgs = z
  .object({
    artifactId: z
      .string()
      .describe(
        'The id of the script_runnable artifact (or legacy python_runnable / node_runnable) to execute. Pass the artifactId returned by a prior `artifact_create` / `artifact_file_create` / `artifact_file_update` call.',
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
      .object({
        python: z
          .array(z.string().max(120))
          .max(20)
          .optional()
          .describe('Pip specs (e.g. `markitdown[pptx]`).'),
        node: z
          .array(z.string().max(120))
          .max(20)
          .optional()
          .describe('npm specs (e.g. `pptxgenjs`).'),
      })
      .optional()
      .describe(
        'One-off package override for this run only. Per-runtime buckets `{python?, node?}` — `python` is installed via `uv pip`, `node` via `npm`. Either bucket may be omitted. Usually omitted entirely — the artifact row already carries the `packages` you supplied at create time / via `artifact_packages_add`.',
      )
      .superRefine((val, ctx) => {
        refinePackagesObject(val, (issue) => ctx.addIssue(issue));
      }),
    inputs: z
      .object({
        from_run: z
          .string()
          .min(1)
          .describe(
            'Either the literal string `"latest"` (use the most recent SUCCESSFUL run\'s outputs — the default behaviour when `inputs` is omitted) or a specific runId returned by a prior `artifact_run` call. When a runId is passed, that exact run\'s output files are pre-staged into `/workspace/output/` regardless of whether it succeeded or failed — useful for re-attempting analysis against a known intermediate state.',
          ),
      })
      .optional()
      .describe(
        'Explicit pre-stage source for `/workspace/output/`. Omit to inherit the default ("latest succeeded run"). Pass a specific `{from_run: "<runId>"}` to pin to a particular prior run.',
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
   * The persistent `artifactRuns` row id created for this run (Phase 2
   * onward). Pass it back as `inputs: { from_run: "<runId>" }` on a
   * follow-up call to pin pre-staging to this run's outputs. Omitted if
   * the run never reached finalize (rare — only on infra crashes that
   * never enter the finalize path).
   */
  runId?: string;
  /**
   * Populated only when the request used multi-step mode. One entry per
   * requested step in submission order with per-step outcome. `skipped`
   * means a prior step's failure aborted this one.
   */
  steps?: SandboxStepResult[];
  /**
   * Pre-stage attestation summary (crispy-curry plan §3). Populated on
   * every run that had `priorOutputDownloads`. `staged[]` lists files the
   * spawner confirmed landed in `/workspace/output/` before user code ran;
   * `skipped[]` lists any expected files that didn't make it, with a
   * structured reason. When `skipped[].length > 0` the run terminates
   * with `runErrorCode: "PRE_STAGE_FAILED"` BEFORE user code runs — use
   * `inputs.from_run` to pin an older snapshot if a specific blob has
   * gone missing.
   */
  preStage?: {
    staged: string[];
    skipped: Array<{ name: string; reason: string; detail: string }>;
  };
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
  /**
   * Pre-stage attestation block (crispy-curry plan §3) — present when the
   * request had `priorOutputDownloads`. Forwarded straight through to the
   * tool result so the LLM sees what was staged and what was skipped.
   */
  preStage?: {
    staged: string[];
    skipped: Array<{ name: string; reason: string; detail: string }>;
  };
}

export const artifactRunTool = {
  name: 'artifact_run' as const,
  tool: createTool({
    description: `**artifact_run** — execute a runnable artifact (\`script_runnable\`, or its legacy single-language predecessors \`python_runnable\` / \`node_runnable\`) in the sandbox and return the run outcome.

USE THIS TOOL after \`artifact_create\` + \`artifact_file_update\`/\`artifact_file_create\` (to run the entry script) or after a subsequent \`artifact_file_update\` (to re-run a patched revision). The previously-configured \`runPackages\` are reused unless you override; add new dependencies via \`artifact_packages_add\`.

**WORKSPACE LIFECYCLE — READ FIRST.**
- Every \`artifact_run\` invocation gets a **brand-new** \`/workspace/\` directory.
- As a convenience, the artifact's **most recent run outputs** are pre-staged back into \`/workspace/output/\` before the script starts (up to ~10 MiB total). A follow-up \`artifact_run\` on the same artifact can therefore read what an earlier run produced — e.g. \`validate.py\` opens the \`.pptx\` that \`generate.py\` wrote on the previous call. If aggregate prior outputs exceed the cap, the pre-stage is skipped and a note appears in stderr; do not rely on this backstop for large workflows.
- For tightly-coupled chains (build → test, generate → validate) **prefer \`steps: [...]\`** — same container, atomic outcome, fail-fast across steps, one round trip. Pre-staging is the safety net when separate calls are unavoidable, not a replacement for \`steps\`.
- Creation patterns are unaffected: \`Presentation(path)\` *opens* an existing file. To create a new artifact output, call \`Presentation()\` (no arg), populate, then \`.save(...)\`.

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
- Step paths must reference existing non-empty files in the artifact. Any filename works — \`main.py\`, \`gen.py\`, \`test.py\`, whatever you used when you created the file.

**Single-script mode** (use when there's nothing to chain): omit both \`steps\` and \`path\` to run the artifact's \`entryFile\`, or pass \`path\` to run a specific sibling file. \`subprocess.run(['python', 'validate.py'])\` from within the entry script also works if you want orchestration logic in-script.

**ONE ARTIFACT, MANY RUNNABLE FILES.** Keep multi-script workflows in ONE artifact. Do NOT call \`artifact_create\` twice for "generator" and "validator" — add sibling files via \`artifact_file_create({artifactId, path:'validate.py', content:...})\` and reference them via \`steps\`.

**DO NOT use this tool for:**
- Static artifact types (\`html\`, \`svg\`, \`mermaid\`, \`markdown\`, \`code\`) — those render in the browser, not the sandbox. The tool will refuse them with a clear error.
- Free-form code that isn't tied to an artifact. There is no other path; everything goes through an artifact.

**MIXED-LANGUAGE STEPS.** For a \`script_runnable\` artifact you can mix \`.py\` and \`.js\` files in the same project — each step's interpreter is chosen from its extension (\`.py\` → python3, \`.js\`/\`.cjs\`/\`.mjs\` → node). Dependencies are always declared as a per-runtime object: \`{python?: string[], node?: string[]}\` — usually persisted via \`artifact_create\`'s \`packages\` or a later \`artifact_packages_add\`. The optional \`packages\` arg here is a one-shot override with the same shape.

**SANDBOX ENVIRONMENT:**
- Python 3.12 / Node 24 with on-demand \`pip\` / \`npm\` install per the row's \`runPackages\` (legacy) or \`runPackagesByLang\` (grouped). Mixed-language runs install both in the same container.
- Wall-clock ≤300s (default 30s; raise via \`timeoutMs\`). Applies to the WHOLE run.
- Memory cap 1 GB, 1 CPU.
- Egress restricted to package registries (\`pypi.org\`, \`files.pythonhosted.org\`, \`registry.npmjs.org\`, GitHub release endpoints). Any other host returns \`EGRESS_DENIED\`.
- Output files **must** be written under \`/workspace/output/\` to be collected.
- stdout/stderr captured (16 KB preview returned; full text in \`_storage\` if larger). In multi-step mode the wrapper prints a \`====== STEP N/M: <path> ======\` banner around each step so the combined log stays readable.

**ON FAILURE — read \`runStderrPreview\` BEFORE replying to the user.** When a multi-step run fails, check \`steps[]\` to see WHICH step failed and only re-run / patch that one. Recovery table:

| \`runErrorCode\` | Meaning | Recovery |
|---|---|---|
| \`RUNTIME_ERROR\` | Code threw (most common) | Read stderr traceback, \`artifact_file_read\` then \`artifact_file_update\` to fix the offending step, then \`artifact_run\` again |
| \`TIMEOUT\` | Wall-clock exceeded | Raise \`timeoutMs\` on the next \`artifact_run\` call, or \`artifact_file_update\` to split the work into multiple files / steps |
| \`OOM\` | Memory cap hit (1 GB) | \`artifact_file_update\` to stream / reduce data in memory, then \`artifact_run\` again |
| \`EGRESS_DENIED\` | Tried to reach a non-registry host | \`artifact_file_update\` to remove the external call — use the \`web\` tool instead |
| \`INSTALL_FAILED\` | Package install errored | Read stderr, call \`artifact_packages_add\` with a corrected spec (or re-create the artifact with a fresh package list), then \`artifact_run\` again |
| \`PACKAGE_NOT_FOUND\` | A spec doesn't resolve | \`artifact_packages_add\` with an alternate package name |
| \`QUOTA_EXCEEDED\` | Org daily CPU cap | Don't retry — tell the user to wait |
| \`SPAWNER_UNAVAILABLE\` | Transient infra | One \`artifact_run\` retry is fine; if it fails again, surface to user |
| \`HARVEST_READ_FAILED\` | Sandbox couldn't read output dir | Check stderr — the script likely didn't write the expected file (typo in path, wrong cwd) |
| \`UPLOAD_FAILED\` | Output upload to storage failed | One retry is fine — usually a transient blip on the storage path |
| \`UPLOAD_QUOTA_EXCEEDED\` | Per-run output-file cap hit (>16 files) | Consolidate small files into a tar/zip, OR split work into multiple \`artifact_run\` calls / \`steps\` |
| \`UPLOAD_REPORT_FAILED\` | Upload recorded with a delay | Non-fatal; check the audit row's \`uploadedStorageIds\` if files seem missing |

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
      // the file_* tools.
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
          message: `Artifact ${args.artifactId} is type "${artifact.type}". artifact_run only runs script_runnable (or legacy python_runnable / node_runnable) types. Static types (html / svg / mermaid / markdown / code) render in the browser, not in the sandbox.`,
        };
      }
      // Legacy single-runtime types (`python_runnable` / `node_runnable`)
      // pin the runtime regardless of file extensions — preserves
      // behavior for rows created before script_runnable existed. New
      // `script_runnable` rows infer per-step / per-target.
      const lockedLanguage = runnableLanguage(artifact.type);

      // Resolve which files to execute. Two modes:
      //   - Multi-step (`args.steps`): each step path must reference an
      //     existing artifact file with non-empty content. All sibling
      //     files are still staged on disk so steps can `import` /
      //     `require` each other. There is no user-facing reserved name:
      //     the spawner's wrapper lives at /workspace/.tale/runner.{py,js},
      //     a dotfile-segment dir unreachable from artifact paths.
      //   - Single-script: `args.path` or entryFile names the executed
      //     file; the runtime entrypoint exec()s it at its declared path.
      const resolved = resolveArtifactFiles(artifact);

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
              message: `steps[${i}].path "${validated}" is not in artifact ${args.artifactId}. Available paths: ${known}. Call artifact_file_create to add the file first if you intended to.`,
            };
          }
          if (entry.content.length === 0) {
            return {
              success: false,
              message: `steps[${i}].path "${validated}" is empty. Call artifact_file_update({artifactId, path: "${validated}", content: ..., expectedRevision}) first.`,
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
            message: `Artifact ${args.artifactId} file "${targetPath}" is empty. Call artifact_file_update({artifactId, path: "${targetPath}", content: ..., expectedRevision}) first.`,
          };
        }
        dispatch = {
          kind: 'single',
          targetPath,
          targetContent: targetEntry.content,
        };
      }

      // Collect the per-step runtimes the dispatch resolves to. Legacy
      // single-runtime artifacts pin every step to their type's language
      // (e.g. a `python_runnable` runs `helpers.js` with python — the
      // wrapper would explode, but that's the legacy contract that
      // pre-dated mixed-extension files). `script_runnable` rows infer
      // per file: `.py` → python, `.js`/`.cjs`/`.mjs` → node. Anything
      // else fails fast before we hit the sandbox.
      const dispatchedPaths =
        dispatch.kind === 'single' ? [dispatch.targetPath] : dispatch.stepPaths;
      const runtimesNeeded = new Set<'python' | 'node'>();
      if (lockedLanguage !== null) {
        runtimesNeeded.add(lockedLanguage);
      } else {
        for (const path of dispatchedPaths) {
          const lang = inferStepLanguage(path);
          if (lang === null) {
            return {
              success: false,
              message: `Path "${path}" has no recognized polyglot interpreter — supported extensions are .py, .js, .cjs, .mjs. Rename the file or split the run into separate \`steps\` if you intended multiple languages.`,
            };
          }
          runtimesNeeded.add(lang);
        }
      }
      // Choose the wire `language` for the spawner request. A pure-
      // Python or pure-Node file set sends the lighter single-language
      // path so legacy spawner code (and any operator dashboards keyed
      // off `language`) keep working. Only true mixed runs send polyglot.
      let spawnerLanguage: 'python' | 'node' | 'polyglot';
      if (runtimesNeeded.size === 2) {
        spawnerLanguage = 'polyglot';
      } else if (runtimesNeeded.has('python')) {
        spawnerLanguage = 'python';
      } else {
        spawnerLanguage = 'node';
      }
      // Polyglot requires multi-step (the spawner validator enforces this
      // too, but rejecting here is a better diagnostic). A single-script
      // polyglot request would just be a single-language run.
      if (spawnerLanguage === 'polyglot' && dispatch.kind === 'single') {
        return {
          success: false,
          message: `Polyglot runs require \`steps\` mode (one entry per file in execution order). Pass \`steps: [{path: "..."}]\` instead of \`path\`.`,
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

      // Resolve effective packages for this run:
      //   1. Pull persisted state from the artifact row (grouped form
      //      first, fall back to legacy flat list routed to the
      //      artifact's locked-or-inferred runtime).
      //   2. Apply the per-call override — either flat (legacy) or
      //      grouped — replacing the persisted state rather than
      //      merging, so the LLM can opt to install a different set for
      //      this one run.
      //   3. Drop buckets the dispatched file set won't use (keeps the
      //      install phase tight when an artifact has stale Node deps
      //      from an earlier mixed run).
      let pythonBucket: string[] = [];
      let nodeBucket: string[] = [];
      if (args.packages !== undefined) {
        // Per-call grouped override. Either bucket may be omitted; an
        // omitted bucket means "this run doesn't need that runtime's
        // packages" — NOT "fall back to persisted state for that
        // bucket" (overrides are absolute by design so the LLM can
        // declare a clean clean-room run).
        pythonBucket = args.packages.python ?? [];
        nodeBucket = args.packages.node ?? [];
      } else {
        // No override — fall back to persisted state.
        const stored = artifact.runPackagesByLang;
        if (stored !== undefined) {
          pythonBucket = stored.python ?? [];
          nodeBucket = stored.node ?? [];
        }
        // Legacy `runPackages` (flat). Pre-grouped data may still carry
        // prefixed specs (`python:foo`) from older code paths or
        // hand-edited rows — `classifyPackages` strips the prefix and
        // routes correctly so a stale flat entry doesn't ship a Python
        // spec to npm. Only fills an empty bucket; never shadows the
        // grouped state above.
        const flat = artifact.runPackages ?? [];
        if (flat.length > 0) {
          // Default the un-prefixed specs to whichever runtime the
          // dispatched files need (when single). For a mixed run, the
          // flat list is ambiguous and we default to python.
          const flatDefaultLang: 'python' | 'node' =
            runtimesNeeded.size === 1 && runtimesNeeded.has('node')
              ? 'node'
              : 'python';
          const classified = classifyPackages(flat, flatDefaultLang);
          if (pythonBucket.length === 0) pythonBucket = classified.python;
          if (nodeBucket.length === 0) nodeBucket = classified.node;
        }
      }
      // Drop buckets the dispatched file set doesn't need so the
      // entrypoint skips that install pass entirely.
      if (!runtimesNeeded.has('python')) pythonBucket = [];
      if (!runtimesNeeded.has('node')) nodeBucket = [];

      const packagesByLang: { python?: string[]; node?: string[] } = {};
      if (pythonBucket.length > 0) packagesByLang.python = pythonBucket;
      if (nodeBucket.length > 0) packagesByLang.node = nodeBucket;
      const hasGrouped = Object.keys(packagesByLang).length > 0;
      // For single-language runs keep the legacy flat `packages` field
      // populated so audit downstreams (and any code that hasn't been
      // taught about the grouped shape) still see the install list.
      let legacyFlat: string[] | undefined;
      if (spawnerLanguage === 'python') {
        legacyFlat = pythonBucket.length > 0 ? pythonBucket : undefined;
      } else if (spawnerLanguage === 'node') {
        legacyFlat = nodeBucket.length > 0 ? nodeBucket : undefined;
      }
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
            language: spawnerLanguage,
            // Single-script mode sends `entryPath` (the file the runtime
            // entrypoint exec()s). Multi-step mode sends `steps[]` and
            // lets the spawner generate the wrapper under /workspace/.tale/.
            // Mutual exclusion is enforced by the action AND the spawner
            // validator — pass exactly one branch.
            ...(dispatch.kind === 'single' && {
              entryPath: dispatch.targetPath,
            }),
            ...(dispatch.kind === 'steps' && { steps: dispatch.stepPaths }),
            // Stage every file in the project so siblings are importable.
            // The spawner writes each to /workspace/code/<path>.
            files: resolved.files.map((f) => ({
              path: f.path,
              content: f.content,
            })),
            ...(legacyFlat !== undefined && { packages: legacyFlat }),
            ...(hasGrouped && { packagesByLang }),
            ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
            ...(args.inputs?.from_run !== undefined && {
              inputs: { fromRun: args.inputs.from_run },
            }),
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
        message = `Run FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}.${stepSuffix} Read runStderrPreview and call artifact_file_update on the SAME artifactId to fix${failedStep ? ` "${failedStep.path}"` : ''}, then artifact_run again. Do NOT call artifact_create — that creates a duplicate. Do NOT say the file is ready.`;
      } else {
        message = `Run finished with status=${run.status} but produced no output files.${stepSuffix} Inspect runStdoutPreview / runStderrPreview and decide whether to artifact_file_update + re-run.`;
      }

      // Surface the artifactRuns row id created by `applyFinalizeArtifactRun`
      // so the LLM can pin a later run's pre-stage with
      // `inputs: { from_run: "<runId>" }`. Lookup-by-executionId keeps the
      // tool-side change small (no plumbing through executeCode's return).
      // Best-effort: if finalize never ran (rare infra crash) we omit runId.
      const runRow = await ctx
        .runQuery(internal.artifacts.internal_queries.getRunByExecutionId, {
          executionId: toId<'sandboxExecutions'>(run.executionId),
        })
        .catch((err) => {
          console.warn('[artifact_run_tool] getRunByExecutionId failed:', err);
          return null;
        });

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
        ...(runRow !== null && { runId: String(runRow._id) }),
        ...(run.steps !== undefined && { steps: run.steps }),
        ...(run.preStage !== undefined && { preStage: run.preStage }),
        message,
      };
    },
  }),
} as const satisfies ToolDefinition;
