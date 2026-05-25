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

const SCRIPT_EXT_REGEX = /\.(py|cjs|mjs|js)$/i;

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
    description: `**run_code** — execute code in the thread's sandbox using the current workspace as the source tree.

WORKFLOW:
1. \`file_write\` every script you need (the workspace IS the sandbox source tree — no inline file param)
2. \`run_code({entryPath: "gen.py", packages: {python: ["python-pptx==1.0.2"]}})\` for a one-shot
   OR \`run_code({steps: [{path: "gen.py"}, {path: "verify.py"}]})\` for sequential steps in one container
3. Any file the script writes under \`/workspace/output/\` is harvested back into the thread workspace and appears in the canvas

PACKAGES:
- Pip specs go in \`packages.python\` (e.g. \`python-pptx==1.0.2\`)
- npm specs go in \`packages.node\` (e.g. \`pptxgenjs\`)
- The org policy gates what packages can be installed — denied packages return a structured error so you can adapt.

TIMEOUTS / LIMITS:
- Default 30s wall-clock, max 300s
- Memory cap 1 GB
- Max 16 harvested output files per run

The sandbox sees \`/workspace/code/\` (your scripts) and \`/workspace/output/\` (where to write outputs). \`/workspace/output/\` is pre-populated with the current workspace files too, so scripts that read user uploads should glob there.`,
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
      const seen = new Set<string>();
      const knownPaths = new Set(
        workspaceFiles.map((f: { path: string }) => f.path),
      );
      for (const p of stepPaths) {
        if (!SCRIPT_EXT_REGEX.test(p)) {
          return {
            ok: false as const,
            code: 'INVALID_STEP_PATH' as const,
            message: `Step path "${p}" has no recognized script extension (.py / .js / .cjs / .mjs).`,
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

      // Dispatch runtimes — polyglot when both python + node files are
      // present, otherwise the single-runtime spawner.
      const runtimesNeeded = new Set<'python' | 'node'>();
      for (const p of stepPaths) {
        const lang = inferStepLanguage(p);
        if (lang !== null) runtimesNeeded.add(lang);
      }
      let spawnerLanguage: 'python' | 'node' | 'polyglot';
      if (runtimesNeeded.size === 2) spawnerLanguage = 'polyglot';
      else if (runtimesNeeded.has('node')) spawnerLanguage = 'node';
      else spawnerLanguage = 'python';
      if (spawnerLanguage === 'polyglot' && stepPaths.length < 2) {
        return {
          ok: false as const,
          code: 'POLYGLOT_REQUIRES_STEPS' as const,
          message:
            'Polyglot runs (mixed Python + Node) require `steps` mode with multiple files.',
        };
      }

      // Fetch each workspace file's content to seed the spawner mount.
      const filesPayload: Array<{ path: string; content: string }> = [];
      for (const wf of workspaceFiles) {
        const blob = await ctx.storage.get(wf.storageId);
        if (blob === null) {
          console.warn(
            `[run_code] storage missing for path=${wf.path} storageId=${wf.storageId}`,
          );
          continue;
        }
        const buf = Buffer.from(await blob.arrayBuffer());
        filesPayload.push({ path: wf.path, content: buf.toString('utf8') });
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
      const message = success
        ? `run_code succeeded; produced ${run.files.length} workspace file(s) in ${run.durationMs}ms. Files: ${run.files.map((f) => f.path).join(', ') || '(none)'}.`
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
