/**
 * run_code — execute code in the thread workspace sandbox.
 *
 * Reads every file currently in the calling thread's `threadFiles` table,
 * mounts them at `/user/code/<path>` inside the sandbox, runs either
 * a single entry script or a sequential list of steps, and harvests any
 * files produced under `/user/output/` back into the workspace
 * (source `'run_output'`).
 *
 * The thread workspace IS the workspace — there is no separate file
 * injection channel. The LLM must `file_write` everything it wants the
 * sandbox to see first, then call `run_code`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import {
  type RunCodePolicyConfig,
  runCodePolicyConfigSchema,
} from '../../lib/shared/schemas/governance';
import { internal } from '../_generated/api';
import {
  buildDownloadUrl,
  toSandboxStorageUrl,
} from '../lib/helpers/public_storage_url';
import { inferStepLanguage, refinePackagesObject } from './files/_shared';
import { packageBaseName } from './files/_shared';
import { appendFilePart } from './files/helpers/append_file_part';
import { parseWorkspacePath, relOf } from './files/sandbox_paths';
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
        'Single-script mode: absolute path of a script under `/user/code`, e.g. `/user/code/gen.py`. Mutually exclusive with `steps`.',
      ),
    steps: z
      .array(z.object({ path: z.string().min(1).max(200) }))
      .min(1)
      .max(RUN_CODE_MAX_STEPS)
      .optional()
      .describe(
        'Multi-step mode: scripts to execute sequentially in one container — each `path` is an absolute `/user/code/<script>`. Step N sees step N-1 outputs in `/user/output/`. Mutually exclusive with `entryPath`.',
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

function checkPackagesAgainstPolicy(
  policy: RunCodePolicyConfig | null,
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

interface SandboxStateEntry {
  path: string;
  fileId: string;
  size: number;
  contentType: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compact human-readable rendering of the sandbox-state manifest, appended to
 * the tool-result message. The structured `sandboxState` field carries the
 * full data (incl. every `fileId`); this is the at-a-glance summary.
 */
function formatSandboxState(area: {
  uploads: SandboxStateEntry[];
  code: SandboxStateEntry[];
  outputs: SandboxStateEntry[];
}): string {
  const lines: string[] = [];
  const render = (root: string, entries: SandboxStateEntry[]) => {
    if (entries.length === 0) return;
    const shown = entries.slice(0, 12);
    const names = shown
      .map((e) => `${e.path.slice(root.length + 1)} (${formatBytes(e.size)})`)
      .join(', ');
    const more =
      entries.length > shown.length
        ? ` … +${entries.length - shown.length} more`
        : '';
    lines.push(`  ${root}: ${names}${more}`);
  };
  render('/user/uploads', area.uploads);
  render('/user/code', area.code);
  render('/user/output', area.outputs);
  if (lines.length === 0) return '';
  return `Sandbox state (reference files by path; pass a file's fileId to the image / document_write tools):\n${lines.join('\n')}`;
}

export const runCodeTool: ToolDefinition = {
  name: 'run_code' as const,
  tool: createTool({
    description: `**run_code** — execute code in the thread's sandbox using the current workspace as the source tree. Python 3, Node.js, and bash are available (extension-routed: \`.py\` → python3, \`.js\`/\`.cjs\`/\`.mjs\` → node, \`.sh\` → bash). Pick the language that fits the task (or whatever a relevant skill recommends).

WORKFLOW:
1. \`file_write\` every script you need (the workspace IS the sandbox source tree — no inline file param)
2. \`run_code({entryPath: "/user/code/<script>"})\` for a one-shot
   OR \`run_code({steps: [{path: "/user/code/step_a.py"}, {path: "/user/code/step_b.py"}]})\` for sequential steps sharing one container
3. Any file the script writes under \`/user/output/\` is harvested back into the thread workspace and appears in the canvas

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
- \`/user/code/\`    — scripts you authored via \`file_write\` (this is where \`entryPath\` / \`steps\` resolve);
- \`/user/output/\`  — files produced by **previous** \`run_code\` calls; this is also where the current run writes its outputs (any file written here is harvested back into the thread);
- \`/user/uploads/\` — files the user uploaded into the thread (kept separate from code-output artifacts).

Reading a previous run's output → \`/user/output/<name>\`. Reading a user-uploaded asset → \`/user/uploads/<name>\`. Only scripts you wrote with \`file_write\` are executable as \`entryPath\` / \`steps\`.

Every result includes a **\`sandboxState\`** manifest — the current files under each dir, each with its \`fileId\`. Read it before acting: don't regenerate an output already listed there, and hand a file's \`fileId\` to the \`image\` (analyze) or \`document_write\` tool.`,
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
      // entry/steps are absolute `/user/code/<script>` paths (what file_write
      // returns). Resolve to the sandbox-relative form the spawner + matching
      // use. Only `/user/code` scripts run.
      {
        const rels: string[] = [];
        for (const raw of stepPaths) {
          let parsed;
          try {
            parsed = parseWorkspacePath(raw);
          } catch {
            parsed = null;
          }
          if (parsed === null || parsed.source !== 'agent_write') {
            return {
              ok: false as const,
              code: 'INVALID_STEP_PATH' as const,
              message: `Step path "${raw}" must be an absolute workspace script under /user/code/ (e.g. /user/code/gen.py).`,
            };
          }
          rels.push(parsed.rel);
        }
        stepPaths = rels;
      }
      // Only `agent_write` files land in /user/code/ — they are the
      // executable surface. `user_upload` lives in /user/uploads/ and
      // `run_output` lives in /user/output/; neither is executable
      // via entryPath/steps. If the user wants to run a user-uploaded
      // script, they can copy it into /user/code/ with file_write.
      const seen = new Set<string>();
      const knownPaths = new Set(
        workspaceFiles
          .filter((f: { source: string }) => f.source === 'agent_write')
          .map((f: { path: string }) => relOf(f.path)),
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
      //   - agent_write → /user/code/<path>   (executable scripts)
      //   - run_output  → /user/output/<path> (previous run artifacts)
      //   - user_upload → /user/uploads/<path>(user-supplied assets)
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
        // The stored path is the canonical absolute `/user/<root>/<rel>`; the
        // spawner stages each source into its dir by the *relative* name.
        const rel = relOf(wf.path);
        if (wf.source === 'run_output') {
          priorOutputDownloadsPayload.push({ name: rel, url });
        } else if (wf.source === 'user_upload') {
          userUploadDownloadsPayload.push({ name: rel, url });
        } else {
          // agent_write (default) — staged at /user/code/<rel>.
          filesPayload.push({ path: rel, url });
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
      // Persistent per-thread session path (Phase 2), gated off by default.
      // Any failure here falls back to the ephemeral one-shot path, so the
      // flag can never regress the tool.
      const useSession = process.env.SANDBOX_RUNCODE_SESSIONS === 'true';
      try {
        if (useSession) {
          try {
            raw = await ctx.runAction(
              internal.node_only.sandbox.session_exec.executeCodeInSession,
              {
                organizationId,
                threadId,
                uploadedBy: userId ?? '',
                stepPaths: stepPaths.map((rel) => `/user/code/${rel}`),
                ...(Object.keys(packagesByLang).length > 0 && {
                  packagesByLang,
                }),
                ...(args.timeoutMs !== undefined && {
                  timeoutMs: args.timeoutMs,
                }),
              },
            );
          } catch (sessErr) {
            console.warn(
              '[run_code] session path failed; falling back to ephemeral:',
              sessErr,
            );
            raw = await ctx.runAction(
              internal.node_only.sandbox.internal_actions.executeCode,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- executeCode accepts this subset; passed verbatim
              sandboxArgs as never,
            );
          }
        } else {
          raw = await ctx.runAction(
            internal.node_only.sandbox.internal_actions.executeCode,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- executeCode accepts this subset; passed verbatim
            sandboxArgs as never,
          );
        }
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

      const emptyFilesHint = `run_code succeeded in ${run.durationMs}ms. No output files were harvested.

If the script was supposed to produce a deliverable file, only paths under \`/user/output/\` are harvested back into the thread workspace — files written to the cwd, \`/tmp\`, or \`/user/code/\` are discarded when the container exits.

Wrong (file is lost, NOT harvested):
  open("report.pptx", "wb").write(data)              # Python
  fs.writeFileSync("report.json", data)              // Node

Correct (harvested into the thread workspace):
  open("/user/output/report.pptx", "wb").write(data)
  fs.writeFileSync("/user/output/report.json", data)

Same rule for bash: \`cp report.pdf /user/output/report.pdf\`.

If your script genuinely had no file deliverable (e.g. a sanity check or package install), you can ignore this — the run did succeed.`;
      const message = success
        ? run.files.length > 0
          ? `run_code succeeded in ${run.durationMs}ms. Produced ${run.files.length} output file(s) at /user/output/: ${run.files.map((f) => f.path).join(', ')}.`
          : emptyFilesHint
        : run.errorCode
          ? `run_code FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read stderrPreview, fix the script via file_write, then call run_code again.`
          : `run_code finished with status=${run.status} and no output files.`;

      // Sandbox-state manifest: the current workspace files grouped by area,
      // each with its `fileId` (storage id). Reported on every run (success
      // OR failure) so the model always has ground truth — what it already
      // produced (don't regenerate), what the user uploaded (edit it), and the
      // id to hand to the image / document_write tools.
      const sandboxState: {
        uploads: SandboxStateEntry[];
        code: SandboxStateEntry[];
        outputs: SandboxStateEntry[];
      } = { uploads: [], code: [], outputs: [] };
      const stateRows = await ctx.runQuery(
        internal.thread_files.internal_queries.listThreadFiles,
        { threadId },
      );
      for (const e of stateRows
        .filter(
          (r: { organizationId: string }) =>
            r.organizationId === organizationId,
        )
        .map(
          (r: {
            path: string;
            storageId: string;
            size: number;
            contentType: string;
            source: 'user_upload' | 'agent_write' | 'run_output';
          }) => ({
            entry: {
              path: r.path,
              fileId: r.storageId,
              size: r.size,
              contentType: r.contentType,
            },
            source: r.source,
          }),
        )) {
        if (e.source === 'user_upload') sandboxState.uploads.push(e.entry);
        else if (e.source === 'run_output') sandboxState.outputs.push(e.entry);
        else sandboxState.code.push(e.entry);
      }
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
        ...(run.steps !== undefined && { steps: run.steps }),
        sandboxState,
        message: messageWithState,
      };
    },
  }),
};
