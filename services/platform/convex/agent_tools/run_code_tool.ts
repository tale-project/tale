/**
 * run_code — execute code in the thread workspace sandbox.
 *
 * Three modes behind an explicit `mode` discriminator: `script` runs a
 * workspace file staged via `file_write`, `inline` runs a snippet directly,
 * `install` provisions packages without running anything. Every mode may
 * declare `packages` to install first; files produced under `/user/output/`
 * are harvested back into the workspace (source `'run_output'`).
 *
 * The thread workspace IS the workspace — there is no separate file
 * injection channel. The LLM must `file_write` everything it wants the
 * sandbox to execute as a script; multi-step work is sequential run_code
 * calls against the turn's persistent session (there is no `steps` array).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import {
  type RunCodePolicyConfig,
  runCodePolicyConfigSchema,
} from '../../lib/shared/schemas/governance';
import { internal } from '../_generated/api';
import { buildDownloadUrl } from '../lib/helpers/public_storage_url';
import { getWorkspaceThreadId } from '../threads/get_parent_thread_id';
import {
  evaluatePackageAgainstPolicy,
  packageBaseName,
  refinePackagesObject,
} from './files/_shared';
import { appendFilePart } from './files/helpers/append_file_part';
import {
  buildSandboxState,
  formatSandboxState,
} from './files/helpers/sandbox_state';
import { parseWorkspacePath, relOf } from './files/sandbox_paths';
import { validateInlineCode } from './inline_language';
import type { ToolDefinition } from './types';

const packagesField = z
  .strictObject({
    python: z
      .array(z.string().max(120))
      .max(20)
      .optional()
      .describe('pip specs, e.g. ["pandas", "python-pptx==1.0.2"].'),
    node: z
      .array(z.string().max(120))
      .max(20)
      .optional()
      .describe('npm specs (installed globally), e.g. ["sharp"].'),
  })
  .superRefine((val, ctx) => {
    refinePackagesObject(val, (issue) => ctx.addIssue(issue));
  });

/** Fields every mode accepts — spread into each strict variant. */
const runCodeSharedFields = {
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .optional()
    .describe(
      'Wall-clock cap in ms for the script/snippet run (default 30000; mode "install" defaults to 120000; max 300000). Declared package installs get their own budget and do not eat into this.',
    ),
  sourceCitation: z
    .object({
      skillSlug: z.string().min(1).max(64),
      fileReferences: z.array(z.string().min(1).max(200)).max(10),
    })
    .optional()
    .describe(
      'Optional provenance — when the script content was inspired by a skill, record which one. Surfaced on the audit row.',
    ),
};

const MODE_ERROR =
  'Pass mode: "script" | "inline" | "install". Examples: {"mode":"inline","code":"print(1)","language":"python"} · {"mode":"script","entryPath":"/user/code/gen.py","packages":{"python":["pandas"]}} · {"mode":"install","packages":{"python":["pandas"]}}';

// Strict variants on purpose: the provider-facing schema is flattened for
// OpenAI (all per-mode fields look optional — see `flattenUnionSchema` in
// resolve_model.ts), so cross-mode combinations like `mode: "script"` +
// `code` WILL arrive. Non-strict objects would silently strip the extra
// field and run something else than the model asked for; strict ones reject
// with a repairable unrecognized-keys error.
export const runCodeArgs = z
  .discriminatedUnion(
    'mode',
    [
      z.strictObject({
        mode: z
          .literal('script')
          .describe('Run a workspace script staged with file_write.'),
        entryPath: z
          .string()
          .min(1)
          .max(200)
          .describe(
            'Absolute script path under /user/code, e.g. "/user/code/gen.py" — the extension picks the interpreter (.py / .js / .cjs / .mjs / .sh).',
          ),
        packages: packagesField
          .optional()
          .describe(
            'Installed before the run; persist for later run_code calls in this turn.',
          ),
        ...runCodeSharedFields,
      }),
      z.strictObject({
        mode: z
          .literal('inline')
          .describe('Execute a snippet directly — nothing is staged.'),
        code: z
          .string()
          .min(1)
          .max(65_536)
          .describe(
            'Source to execute. Not stored in the workspace — for anything worth re-running or editing, file_write + mode "script" instead.',
          ),
        language: z
          .enum(['python', 'node', 'bash'])
          .describe(
            'Interpreter for `code`: python → python3, node → Node as ESM (`import` / top-level `await`, no `require`), bash → bash. Must match the code — contradictions are rejected, not auto-corrected.',
          ),
        packages: packagesField
          .optional()
          .describe(
            'Installed before the snippet runs; persist for later run_code calls in this turn.',
          ),
        ...runCodeSharedFields,
      }),
      z.strictObject({
        mode: z
          .literal('install')
          .describe('Install packages only — no code runs.'),
        packages: packagesField.describe(
          'At least one non-empty bucket. Installed packages persist for later run_code calls in this turn.',
        ),
        ...runCodeSharedFields,
      }),
    ],
    { error: MODE_ERROR },
  )
  .superRefine((val, ctx) => {
    if (val.mode === 'install') {
      const hasSpec =
        (val.packages.python?.length ?? 0) > 0 ||
        (val.packages.node?.length ?? 0) > 0;
      if (!hasSpec) {
        ctx.addIssue({
          code: 'custom',
          path: ['packages'],
          message:
            'mode "install" needs at least one package, e.g. {"mode": "install", "packages": {"python": ["pandas"]}}.',
        });
      }
    }
  });

type RunCodeArgs = z.infer<typeof runCodeArgs>;

const SCRIPT_EXT_REGEX = /\.(py|cjs|mjs|js|sh)$/i;

export function checkPackagesAgainstPolicy(
  policy: RunCodePolicyConfig | null,
  packages: { python?: string[]; node?: string[] } | undefined,
):
  | { ok: true }
  | {
      ok: false;
      code: 'PACKAGE_NOT_ALLOWED';
      package: string;
      message: string;
    } {
  if (!packages || !policy) return { ok: true };
  const buckets = [
    ['python', packages.python],
    ['node', packages.node],
  ] as const;
  for (const [bucket, specs] of buckets) {
    for (const spec of specs ?? []) {
      const verdict = evaluatePackageAgainstPolicy(spec, bucket, policy);
      if (verdict.allowed) continue;
      const base = packageBaseName(spec).toLowerCase();
      const why =
        verdict.reason === 'deny_match'
          ? `${bucket} package "${base}" is explicitly denied by org policy.`
          : `${bucket} package "${base}" is not on the org allowlist (mode=allowlist).`;
      return {
        ok: false as const,
        code: 'PACKAGE_NOT_ALLOWED' as const,
        package: spec,
        message: `${why} Remove it from \`packages\`, or ask an org admin to update the run_code policy.`,
      };
    }
  }
  return { ok: true };
}

/** Fence that survives `text` itself containing triple-backtick runs. */
function fenceFor(text: string): string {
  return text.includes('```') ? '````' : '```';
}

function emptyRunHint(durationMs: number): string {
  return `run_code succeeded in ${durationMs}ms. No output files were harvested and nothing was printed.

If the script was supposed to produce a deliverable file, only paths under \`/user/output/\` are harvested back into the thread workspace — files written to the cwd, \`/tmp\`, or \`/user/code/\` are discarded when the container exits.

Wrong (file is lost, NOT harvested):
  open("report.pptx", "wb").write(data)              # Python
  fs.writeFileSync("report.json", data)              // Node

Correct (harvested into the thread workspace):
  open("/user/output/report.pptx", "wb").write(data)
  fs.writeFileSync("/user/output/report.json", data)

Same rule for bash: \`cp report.pdf /user/output/report.pdf\`.

If your script genuinely had no deliverable (e.g. a sanity check or package install), you can ignore this — the run did succeed.`;
}

/**
 * Human-readable result message: outcome header + the run's terminal output.
 * stdout is embedded whenever non-empty (a shell-style run's deliverable IS
 * its stdout); stderr only on failure — successful runs route package-install
 * noise there. Previews arrive pre-capped (4096 chars) from session_exec.
 */
export function formatRunCodeResultMessage(
  run: {
    status: 'completed' | 'failed' | 'cancelled';
    exitCode: number | null;
    errorCode?: string;
    errorMessage?: string;
    stdoutPreview: string;
    stderrPreview: string;
    durationMs: number;
    files: Array<{ path: string }>;
    stagingSkipped?: Array<{ path: string; reason: string }>;
    harvestSkipped?: Array<{ path: string; reason: string }>;
  },
  opts?: { installOnly?: boolean; packageCount?: number },
): string {
  const success = run.status === 'completed';
  const stdout = run.stdoutPreview.trim();
  const stderr = run.stderrPreview.trim();

  let header: string;
  if (success) {
    if (opts?.installOnly) {
      // No deliverable expected — the harvest lecture would be noise here.
      header = `run_code installed ${opts.packageCount ?? 'the requested'} package(s) in ${run.durationMs}ms. They persist for later run_code calls in this turn.`;
    } else if (run.files.length > 0) {
      header = `run_code succeeded in ${run.durationMs}ms. Produced ${run.files.length} output file(s) at /user/output/: ${run.files.map((f) => f.path).join(', ')}.`;
    } else if (stdout.length > 0) {
      header = `run_code succeeded in ${run.durationMs}ms. (No output files were harvested — only files written under \`/user/output/\` come back into the workspace.)`;
    } else {
      header = emptyRunHint(run.durationMs);
    }
  } else {
    header = run.errorCode
      ? `run_code FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read the output below, fix the problem, then call run_code again.`
      : `run_code finished with status=${run.status}${run.exitCode !== null ? ` (exit code ${run.exitCode})` : ''}.`;
  }

  const blocks = [header];
  if (stdout.length > 0) {
    const fence = fenceFor(stdout);
    blocks.push(`stdout:\n${fence}\n${stdout}\n${fence}`);
  }
  if (!success && stderr.length > 0) {
    const fence = fenceFor(stderr);
    blocks.push(`stderr:\n${fence}\n${stderr}\n${fence}`);
  }
  // Ground truth about files the run could NOT see or return — without this
  // the model reads an empty dir or a missing deliverable as its own bug.
  if (run.stagingSkipped !== undefined && run.stagingSkipped.length > 0) {
    blocks.push(
      `⚠ NOT staged into the sandbox (scripts cannot read these):\n${run.stagingSkipped
        .map((s) => `- ${s.path} — ${s.reason}`)
        .join('\n')}`,
    );
  }
  if (run.harvestSkipped !== undefined && run.harvestSkipped.length > 0) {
    blocks.push(
      `⚠ Output files NOT harvested back into the workspace:\n${run.harvestSkipped
        .map((s) => `- ${s.path} — ${s.reason}`)
        .join('\n')}`,
    );
  }
  // Backstop for language mismatches the pre-flight heuristic let through:
  // bash choking on Python source has this one unmistakable signature.
  if (!success && stderr.includes('import: command not found')) {
    blocks.push(
      'Hint: `import: command not found` means bash tried to execute Python source. Resubmit with `language` matching the code (probably "python").',
    );
  }
  return blocks.join('\n\n');
}

export const runCodeTool: ToolDefinition = {
  name: 'run_code' as const,
  availability: 'any' as const,
  tool: createTool({
    description: `**run_code** — execute code in the thread's sandbox (Python 3, Node as ESM, bash). Modes: \`inline\` (code + language) — a snippet run directly, like a shell: one-off commands, quick computations, sandbox inspection; not stored (re-runnable work → "script") · \`script\` (entryPath) — a \`file_write\`-staged workspace script; extension picks the interpreter · \`install\` — packages only (big installs / a separate checkpoint).

EXAMPLES: {"mode": "inline", "language": "python", "code": "print(1+1)"} · {"mode": "script", "entryPath": "/user/code/gen.py"} · {"mode": "install", "packages": ["pandas"]}

PACKAGES: declare them in \`packages\` (works in every mode; the org policy gates them). Do NOT install ad-hoc from inline code — \`pip install x\` / \`npm install -g y\` are rejected with PREFER_PACKAGES (\`pip install -r\` and project-local \`npm install\` remain fine).

MULTI-STEP: repeated run_code calls (no steps array); the sandbox session persists within the turn.

PATHS: \`/user/code/\` your file_write scripts (what \`entryPath\` runs) · \`/user/output/\` deliverables — ONLY files written here are harvested back into the workspace and canvas (incl. prior runs' outputs) · \`/user/uploads/\` the user's files.

VISION: \`tale-vision <image-paths...> [--question "..."]\` analyzes images with the org's vision model (NDJSON line per image; results cached for the turn, so re-runs are free). For large batches raise timeoutMs (max 300000) and chunk across run_code calls.

LIMITS: 1 GB memory · ≤16 harvested files/run.

Results embed terminal output (stdout capped 4 KB; stderr on failure) and a \`sandboxState\` manifest (files per dir with \`fileId\`) — read it first: never regenerate an output already listed; hand a \`fileId\` to \`image\` (analyze) or \`document_write\`.`,
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- the match is prose in this LLM tool-description string, not rendered HTML
    inputSchema: runCodeArgs,
    execute: async (ctx: ToolCtx, args: RunCodeArgs) => {
      const { organizationId, threadId, userId } = ctx;
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
      // Sub-thread runs (spawned jobs, delegates) share the parent chat
      // thread's workspace and sandbox session — a worker's harvested
      // outputs land where the parent agent and the canvas read them.
      const workspaceThreadId = await getWorkspaceThreadId(ctx, threadId);

      // Inline pre-flight (Layer 2): the declared interpreter must plausibly
      // match the snippet, and ad-hoc installs are routed to `packages` where
      // the org policy can see them. Fail-open — see inline_language.ts.
      if (args.mode === 'inline') {
        const issue = validateInlineCode(args.code, args.language);
        if (issue !== null) {
          return {
            ok: false as const,
            code: issue.code,
            message: issue.message,
          };
        }
      }

      // Script mode resolves entryPath against the workspace; inline and
      // install modes skip it — the exec action stages what they need and
      // may run against an empty workspace.
      let stepPaths: string[] = [];
      if (args.mode === 'script') {
        // Load every workspace file. The path the LLM passed must exist.
        const rows = await ctx.runQuery(
          internal.thread_files.internal_queries.listThreadFiles,
          { threadId: workspaceThreadId },
        );
        const workspaceFiles = rows.filter(
          (r: { organizationId: string }) =>
            r.organizationId === organizationId,
        );
        if (workspaceFiles.length === 0) {
          return {
            ok: false as const,
            code: 'EMPTY_WORKSPACE' as const,
            message:
              'No files in the thread workspace. Use file_write to stage the script first, or run the code directly with mode "inline".',
          };
        }

        // entryPath is the absolute `/user/code/<script>` path file_write
        // returned. Resolve to the sandbox-relative form the spawner +
        // matching use. Only `/user/code` scripts run.
        let parsed;
        try {
          parsed = parseWorkspacePath(args.entryPath);
        } catch {
          parsed = null;
        }
        if (parsed === null || parsed.source !== 'agent_write') {
          return {
            ok: false as const,
            code: 'INVALID_ENTRY_PATH' as const,
            message: `entryPath "${args.entryPath}" must be an absolute workspace script under /user/code/ (e.g. /user/code/gen.py).`,
          };
        }
        const rel = parsed.rel;
        if (!SCRIPT_EXT_REGEX.test(rel)) {
          return {
            ok: false as const,
            code: 'INVALID_ENTRY_PATH' as const,
            message: `entryPath "${args.entryPath}" has no recognized script extension (.py / .js / .cjs / .mjs / .sh).`,
          };
        }
        // /user/code/ is the executable surface — keyed on LOCATION, not the
        // `source` provenance (file_write also authors /user/output
        // deliverables now, which must never become executable). If the user
        // wants to run a user-uploaded script, they can copy it into
        // /user/code/ with file_write.
        const knownPaths = new Set(
          workspaceFiles
            .filter((f: { path: string }) => f.path.startsWith('/user/code/'))
            .map((f: { path: string }) => relOf(f.path)),
        );
        if (!knownPaths.has(rel)) {
          return {
            ok: false as const,
            code: 'ENTRY_PATH_NOT_FOUND' as const,
            message: `entryPath "${args.entryPath}" is not in the workspace. Call file_write first.`,
          };
        }
        stepPaths = [rel];
      }

      // Org package policy check. The `run_code` governance policy is the
      // source of truth (file-based, mirrored into configCache); a missing
      // file ⇒ null ⇒ every package allowed.
      const rawPolicy = await ctx
        .runQuery(
          internal.governance.internal_queries.getPolicyConfigInternal,
          {
            organizationId,
            policyType: 'run_code',
          },
        )
        .catch((err: unknown) => {
          console.warn('[run_code] policy lookup failed:', err);
          return null;
        });
      const parsed = rawPolicy
        ? runCodePolicyConfigSchema.safeParse(rawPolicy)
        : null;
      const policy: RunCodePolicyConfig | null =
        parsed && parsed.success ? parsed.data : null;
      const policyResult = checkPackagesAgainstPolicy(policy, args.packages);
      if (!policyResult.ok) {
        return policyResult;
      }

      const packagesByLang: { python?: string[]; node?: string[] } = {};
      if (args.packages?.python !== undefined) {
        packagesByLang.python = args.packages.python;
      }
      if (args.packages?.node !== undefined) {
        packagesByLang.node = args.packages.node;
      }

      // A standalone install gets a 120s default — a cold pip/npm resolve
      // rarely fits the 30s interactive default the run modes keep.
      const timeoutMs =
        args.timeoutMs ?? (args.mode === 'install' ? 120_000 : undefined);

      // Execute in the thread's persistent sandbox session — it stages inputs
      // and harvests outputs; prior outputs persist in the workspace across
      // runs (no re-stage / re-harvest churn).
      let raw: unknown;
      try {
        raw = await ctx.runAction(
          internal.node_only.sandbox.session_exec.executeCodeInSession,
          {
            organizationId,
            threadId: workspaceThreadId,
            uploadedBy: userId,
            stepPaths: stepPaths.map((p) => `/user/code/${p}`),
            ...(args.mode === 'inline' && {
              inlineCode: { content: args.code, language: args.language },
            }),
            ...(Object.keys(packagesByLang).length > 0 && { packagesByLang }),
            ...(timeoutMs !== undefined && { timeoutMs }),
          },
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
        stagingSkipped?: Array<{ path: string; reason: string }>;
        harvestSkipped?: Array<{ path: string; reason: string }>;
        executionId: string;
      };

      const success = run.status === 'completed';

      // Surface each harvested deliverable as a downloadable chat card — the
      // same file-card the native document tools produce — so a file produced
      // by code is as visible as one produced by a dedicated tool (it also
      // stays in the canvas via the `run_output` thread file). `appendFilePart`
      // no-ops for sub-agent threads, so the `files` array below is still the
      // fallback the parent agent reads.
      if (success && run.files.length > 0) {
        for (const f of run.files) {
          // The card shows the file's basename; the harvested path is the
          // canonical absolute `/user/output/<name>`.
          const name = f.path.split('/').pop() ?? f.path;
          try {
            await appendFilePart(ctx, {
              fileName: name,
              mimeType: f.contentType,
              downloadUrl: buildDownloadUrl(f.storageId, name),
            });
          } catch (err) {
            console.warn(
              `[run_code] appendFilePart failed for ${f.path}:`,
              err,
            );
          }
        }
      }

      const message = formatRunCodeResultMessage(run, {
        installOnly: args.mode === 'install',
        packageCount:
          (args.packages?.python?.length ?? 0) +
          (args.packages?.node?.length ?? 0),
      });

      // Sandbox-state manifest: the current workspace files grouped by area,
      // each with its `fileId` (storage id). Reported on every run (success
      // OR failure) so the model always has ground truth — what it already
      // produced (don't regenerate), what the user uploaded (edit it), and the
      // id to hand to the image / document_write tools.
      const sandboxState = await buildSandboxState(ctx, {
        organizationId,
        workspaceThreadId,
      });
      const stateSummary = formatSandboxState(sandboxState);
      const messageWithState =
        stateSummary.length > 0 ? `${message}\n\n${stateSummary}` : message;

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
        ...(run.stagingSkipped !== undefined && {
          stagingSkipped: run.stagingSkipped,
        }),
        ...(run.harvestSkipped !== undefined && {
          harvestSkipped: run.harvestSkipped,
        }),
        sandboxState,
        message: messageWithState,
      };
    },
  }),
};
