/**
 * run_code — execute code in the thread workspace sandbox.
 *
 * Reads every file currently in the calling thread's `threadFiles` table,
 * mounts them at `/workspace/code/<path>` inside the sandbox, runs either
 * a single entry script or a sequential list of steps, and harvests any
 * files produced under `/workspace/output/` back into the workspace
 * (source `'run_output'`).
 *
 * The thread workspace IS the workspace — there is no separate file
 * injection channel. The LLM must `file_write` everything it wants the
 * sandbox to see first, then call `run_code`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../_generated/api';
import { toSandboxStorageUrl } from '../lib/helpers/public_storage_url';
import { inferStepLanguage, refinePackagesObject } from './files/_shared';
import { packageBaseName } from './files/_shared';
import type { ToolDefinition } from './types';

const RUN_CODE_MAX_STEPS = 10;

const runCodeArgs = z
  .object({
    entryPath: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Single-script mode: workspace-relative path to execute, e.g. `gen.py`. Mutually exclusive with `steps`.',
      ),
    steps: z
      .array(z.object({ path: z.string().min(1).max(200) }))
      .min(1)
      .max(RUN_CODE_MAX_STEPS)
      .optional()
      .describe(
        'Multi-step mode: workspace files to execute sequentially in one container. Step N sees step N-1 outputs in `/workspace/output/`. Mutually exclusive with `entryPath`.',
      ),
    packages: z
      .object({
        python: z.array(z.string().max(120)).max(20).optional(),
        node: z.array(z.string().max(120)).max(20).optional(),
      })
      .optional()
      .describe(
        'Packages to install before executing. Pip specs go in `python`; npm specs in `node`. The org policy may reject specs not on its allowlist.',
      )
      .superRefine((val, ctx) => {
        refinePackagesObject(val, (issue) => ctx.addIssue(issue));
      }),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .optional()
      .describe('Wall-clock cap in ms (default 30000, max 300000).'),
    sourceCitation: z
      .object({
        skillSlug: z.string().min(1).max(64),
        fileReferences: z.array(z.string().min(1).max(200)).max(10),
      })
      .optional()
      .describe(
        'Optional provenance — when the script content was inspired by a skill, record which one. Surfaced on the audit row.',
      ),
  })
  .superRefine((val, ctx) => {
    const hasEntry = val.entryPath !== undefined;
    const hasSteps = val.steps !== undefined;
    if (hasEntry === hasSteps) {
      ctx.addIssue({
        code: 'custom',
        path: ['entryPath'],
        message:
          '`entryPath` and `steps` are mutually exclusive — pass exactly one.',
      });
    }
  });

type RunCodeArgs = z.infer<typeof runCodeArgs>;

const SCRIPT_EXT_REGEX = /\.(py|cjs|mjs|js|sh)$/i;

interface PackageRow {
  organizationId: string;
  defaultMode: 'allowlist' | 'denylist';
  pythonAllow: string[];
  pythonDeny: string[];
  nodeAllow: string[];
  nodeDeny: string[];
}

function checkPackagesAgainstPolicy(
  policy: PackageRow | null,
  packages: { python?: string[]; node?: string[] } | undefined,
):
  | { ok: true }
  | {
      ok: false;
      code: 'PACKAGE_NOT_ALLOWED';
      package: string;
      reason: string;
    } {
  if (!packages || !policy) return { ok: true };
  const check = (
    specs: readonly string[] | undefined,
    allow: readonly string[],
    deny: readonly string[],
    bucket: 'python' | 'node',
  ) => {
    if (!specs) return null;
    const denySet = new Set(deny.map((s) => s.trim().toLowerCase()));
    const allowSet = new Set(allow.map((s) => s.trim().toLowerCase()));
    for (const spec of specs) {
      const base = packageBaseName(spec).toLowerCase();
      if (denySet.has(base)) {
        return {
          ok: false as const,
          code: 'PACKAGE_NOT_ALLOWED' as const,
          package: spec,
          reason: `${bucket} package "${base}" is explicitly denied by org policy.`,
        };
      }
      if (policy.defaultMode === 'allowlist' && !allowSet.has(base)) {
        return {
          ok: false as const,
          code: 'PACKAGE_NOT_ALLOWED' as const,
          package: spec,
          reason: `${bucket} package "${base}" is not on the org allowlist (mode=allowlist).`,
        };
      }
    }
    return null;
  };
  return (
    check(packages.python, policy.pythonAllow, policy.pythonDeny, 'python') ?? {
      ok: true,
    }
  );
}

export const runCodeTool: ToolDefinition = {
  name: 'run_code' as const,
  tool: createTool({
    description: `**run_code** — execute code in the thread's sandbox using the current workspace as the source tree. Python 3, Node.js, and bash are available (extension-routed: \`.py\` → python3, \`.js\`/\`.cjs\`/\`.mjs\` → node, \`.sh\` → bash). Pick the language that fits the task (or whatever a relevant skill recommends).

WORKFLOW:
1. \`file_write\` every script you need (the workspace IS the sandbox source tree — no inline file param)
2. \`run_code({entryPath: "<script>"})\` for a one-shot
   OR \`run_code({steps: [{path: "step_a"}, {path: "step_b"}]})\` for sequential steps sharing one container
3. Any file the script writes under \`/workspace/output/\` is harvested back into the thread workspace and appears in the canvas

PACKAGES:
- Pip specs go in \`packages.python\`, npm specs in \`packages.node\` — these install **before** the script runs.
- You can also install on demand from inside the script: \`subprocess.run([sys.executable, "-m", "pip", "install", "foo"])\` from Python, \`npm install -g bar\` from a bash step, etc. Installed packages are importable/requireable immediately on the next line.
- A bash step can also drive \`python\` (alias for python3), \`node\`, \`pip\`, \`npm\` directly — same writable install paths as the language-specific steps.
- The org policy gates what \`packages.python\` / \`packages.node\` can declare — denied packages return a structured error so you can adapt. Inline installs are governed by the sandbox egress allowlist instead.

TIMEOUTS / LIMITS:
- Default 30s wall-clock, max 300s
- Memory cap 1 GB
- Max 16 harvested output files per run

The sandbox sees three directories pre-populated from the thread workspace:
- \`/workspace/code/\`    — scripts you authored via \`file_write\` (this is where \`entryPath\` / \`steps\` resolve);
- \`/workspace/output/\`  — files produced by **previous** \`run_code\` calls; this is also where the current run writes its outputs (any file written here is harvested back into the thread);
- \`/workspace/uploads/\` — files the user uploaded into the thread (kept separate from code-output artifacts).

Reading a previous run's output → \`/workspace/output/<name>\`. Reading a user-uploaded asset → \`/workspace/uploads/<name>\`. Only scripts you wrote with \`file_write\` are executable as \`entryPath\` / \`steps\`.`,
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- the match is prose in this LLM tool-description string, not rendered HTML
    inputSchema: runCodeArgs,
    execute: async (ctx: ToolCtx, args: RunCodeArgs) => {
      const { organizationId, threadId, messageId, userId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'run_code requires a thread context (organizationId + threadId).',
        };
      }
      if (!userId) {
        return {
          ok: false as const,
          code: 'NO_USER_CONTEXT' as const,
          message: 'run_code requires userId in the tool context.',
        };
      }

      // Load every workspace file. The path the LLM passed must exist.
      const rows = await ctx.runQuery(
        internal.thread_files.internal_queries.listThreadFiles,
        { threadId },
      );
      const workspaceFiles = rows.filter(
        (r: { organizationId: string }) => r.organizationId === organizationId,
      );
      if (workspaceFiles.length === 0) {
        return {
          ok: false as const,
          code: 'EMPTY_WORKSPACE' as const,
          message:
            'No files in the thread workspace. Use file_write to stage scripts first.',
        };
      }

      // Resolve target paths the LLM asked us to execute.
      let stepPaths: string[];
      if (args.steps !== undefined) {
        stepPaths = args.steps.map((s) => s.path);
      } else {
        // entryPath is guaranteed by the superRefine mutex above when
        // steps is absent, but TS narrows it loosely — guard explicitly.
        if (args.entryPath === undefined) {
          return {
            ok: false as const,
            code: 'INVALID_STEP_PATH' as const,
            message: 'run_code requires entryPath or steps.',
          };
        }
        stepPaths = [args.entryPath];
      }
      // Only `agent_write` files land in /workspace/code/ — they are the
      // executable surface. `user_upload` lives in /workspace/uploads/ and
      // `run_output` lives in /workspace/output/; neither is executable
      // via entryPath/steps. If the user wants to run a user-uploaded
      // script, they can copy it into /workspace/code/ with file_write.
      const seen = new Set<string>();
      const knownPaths = new Set(
        workspaceFiles
          .filter((f: { source: string }) => f.source === 'agent_write')
          .map((f: { path: string }) => f.path),
      );
      for (const p of stepPaths) {
        if (!SCRIPT_EXT_REGEX.test(p)) {
          return {
            ok: false as const,
            code: 'INVALID_STEP_PATH' as const,
            message: `Step path "${p}" has no recognized script extension (.py / .js / .cjs / .mjs / .sh).`,
          };
        }
        if (seen.has(p)) {
          return {
            ok: false as const,
            code: 'DUPLICATE_STEP_PATH' as const,
            message: `Step path "${p}" appears more than once. Each step must be unique within a single run_code call.`,
          };
        }
        if (!knownPaths.has(p)) {
          return {
            ok: false as const,
            code: 'STEP_PATH_NOT_FOUND' as const,
            message: `Step path "${p}" is not in the workspace. Call file_write first.`,
          };
        }
        seen.add(p);
      }

      // Org package policy check.
      const policy = (await ctx
        .runQuery(
          internal.governance.run_code_policy.getRunCodePolicyInternal,
          {
            organizationId,
          },
        )
        .catch((err: unknown) => {
          console.warn('[run_code] policy lookup failed:', err);
          return null;
        })) as PackageRow | null;
      const policyResult = checkPackagesAgainstPolicy(policy, args.packages);
      if (!policyResult.ok) {
        return policyResult;
      }

      // Dispatch runtimes:
      //   - Single-step with .sh → 'bash' (entrypoint runs `exec bash`).
      //   - Multi-step touching .sh (alone or mixed) → 'polyglot'
      //     (Python-hosted dispatcher routes each step to python3 / node /
      //     bash by extension; no dedicated bash multi-step wrapper).
      //   - Otherwise unchanged: 'polyglot' iff multiple runtimes are
      //     needed, else the single-runtime spawner.
      const runtimesNeeded = new Set<'python' | 'node' | 'bash'>();
      for (const p of stepPaths) {
        const lang = inferStepLanguage(p);
        if (lang !== null) runtimesNeeded.add(lang);
      }
      const multiStep = stepPaths.length > 1;
      let spawnerLanguage: 'python' | 'node' | 'bash' | 'polyglot';
      if (!multiStep) {
        spawnerLanguage = runtimesNeeded.has('bash')
          ? 'bash'
          : runtimesNeeded.has('node')
            ? 'node'
            : 'python';
      } else if (runtimesNeeded.size >= 2 || runtimesNeeded.has('bash')) {
        spawnerLanguage = 'polyglot';
      } else {
        spawnerLanguage = runtimesNeeded.has('node') ? 'node' : 'python';
      }
      if (spawnerLanguage === 'polyglot' && stepPaths.length < 2) {
        return {
          ok: false as const,
          code: 'POLYGLOT_REQUIRES_STEPS' as const,
          message:
            'Polyglot runs (mixed Python / Node / bash) require `steps` mode with multiple files.',
        };
      }

      // Mint a Caddy-aliased download URL per thread file so the spawner
      // fetches bytes itself (binary-safe; bypasses the body cap). No bytes
      // flow through this action's memory. Files are routed by `source`:
      //   - agent_write → /workspace/code/<path>   (executable scripts)
      //   - run_output  → /workspace/output/<path> (previous run artifacts)
      //   - user_upload → /workspace/uploads/<path>(user-supplied assets)
      const filesPayload: Array<{ path: string; url: string }> = [];
      const priorOutputDownloadsPayload: Array<{
        name: string;
        url: string;
      }> = [];
      const userUploadDownloadsPayload: Array<{
        name: string;
        url: string;
      }> = [];
      for (const wf of workspaceFiles) {
        const rawUrl = await ctx.storage.getUrl(wf.storageId);
        if (rawUrl === null) {
          return {
            ok: false as const,
            code: 'STORAGE_MISSING' as const,
            message: `workspace file storage missing for path=${wf.path} storageId=${wf.storageId}`,
          };
        }
        const url = toSandboxStorageUrl(rawUrl);
        if (wf.source === 'run_output') {
          priorOutputDownloadsPayload.push({ name: wf.path, url });
        } else if (wf.source === 'user_upload') {
          userUploadDownloadsPayload.push({ name: wf.path, url });
        } else {
          // agent_write (default) — staged at /workspace/code/<path>.
          filesPayload.push({ path: wf.path, url });
        }
      }

      const packagesByLang: { python?: string[]; node?: string[] } = {};
      if (args.packages?.python !== undefined) {
        packagesByLang.python = args.packages.python;
      }
      if (args.packages?.node !== undefined) {
        packagesByLang.node = args.packages.node;
      }

      const isSingleStep = stepPaths.length === 1 && args.steps === undefined;

      const sandboxArgs: Record<string, unknown> = {
        organizationId,
        uploadedBy: userId,
        threadId,
        ...(messageId !== undefined && { messageId }),
        language: spawnerLanguage,
        files: filesPayload,
        ...(priorOutputDownloadsPayload.length > 0 && {
          priorOutputDownloads: priorOutputDownloadsPayload,
        }),
        ...(userUploadDownloadsPayload.length > 0 && {
          userUploadDownloads: userUploadDownloadsPayload,
        }),
        ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
        ...(Object.keys(packagesByLang).length > 0 && { packagesByLang }),
        purpose: 'run_code',
        ...(args.sourceCitation !== undefined && {
          sourceCitationSkillSlug: args.sourceCitation.skillSlug,
          sourceCitationFiles: args.sourceCitation.fileReferences,
        }),
      };
      if (isSingleStep) {
        sandboxArgs.entryPath = stepPaths[0];
      } else {
        sandboxArgs.steps = stepPaths;
      }

      let raw: unknown;
      try {
        raw = await ctx.runAction(
          internal.node_only.sandbox.internal_actions.executeCode,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sandbox executeCode accepts this subset; passed verbatim
          sandboxArgs as never,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false as const,
          code: 'SANDBOX_FAILED' as const,
          message: `run_code failed before completion: ${msg}`,
        };
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- executeCode codegen result
      const run = raw as {
        status: 'completed' | 'failed' | 'cancelled';
        exitCode: number | null;
        errorCode?: string;
        errorMessage?: string;
        stdoutPreview: string;
        stderrPreview: string;
        durationMs: number;
        files: Array<{
          path: string;
          storageId: string;
          size: number;
          contentType: string;
        }>;
        executionId: string;
        steps?: Array<unknown>;
      };

      const success = run.status === 'completed';
      const emptyFilesHint = `run_code succeeded in ${run.durationMs}ms. No output files were harvested.

If the script was supposed to produce a deliverable file, only paths under \`/workspace/output/\` are harvested back into the thread workspace — files written to the cwd, \`/tmp\`, or \`/workspace/code/\` are discarded when the container exits.

Wrong (file is lost, NOT harvested):
  open("report.pptx", "wb").write(data)              # Python
  fs.writeFileSync("report.json", data)              // Node

Correct (harvested into the thread workspace):
  open("/workspace/output/report.pptx", "wb").write(data)
  fs.writeFileSync("/workspace/output/report.json", data)

Same rule for bash: \`cp report.pdf /workspace/output/report.pdf\`.

If your script genuinely had no file deliverable (e.g. a sanity check or package install), you can ignore this — the run did succeed.`;
      const message = success
        ? run.files.length > 0
          ? `run_code succeeded in ${run.durationMs}ms. Produced ${run.files.length} output file(s) at /workspace/output/: ${run.files.map((f) => f.path).join(', ')}.`
          : emptyFilesHint
        : run.errorCode
          ? `run_code FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read stderrPreview, fix the script via file_write, then call run_code again.`
          : `run_code finished with status=${run.status} and no output files.`;

      return {
        ok: true as const,
        success,
        executionId: run.executionId,
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
        ...(run.steps !== undefined && { steps: run.steps }),
        message,
      };
    },
  }),
};
