/**
 * Native backend for the `sandbox` platform connector: deterministic script
 * execution in the organization's sandbox.
 *
 * This module is the thin, testable rim — input narrowing and the caller
 * contract. The actual sandbox work (session, staging, exec, harvest) is the
 * injected runner's, which the Convex surface binds per invocation the same
 * way the WebDAV store is bound. The capability is workflow-only: a script
 * runs inside its automation run's session, so a caller without a run has no
 * session to run in.
 */

import { z } from 'zod';

import type {
  NativeIntegrationContext,
  NativeIntegrationImpl,
} from '../dispatcher';
import { IntegrationError } from '../errors';

const runScriptInput = z
  .object({
    skill: z.string().min(1),
    entry: z.string().min(1),
    language: z.enum(['python', 'node', 'bash']).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    files: z.record(z.string(), z.unknown()).optional(),
    output: z
      .object({ resultFile: z.string().min(1).optional() })
      .strict()
      .optional(),
    packages: z
      .object({
        python: z.array(z.string().min(1)).optional(),
        node: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

/** One script run, as the runner receives it — org and run bound by the
 * dispatch, never by the document. */
export interface SandboxScriptRun {
  organizationId: string;
  runId: string;
  skill: string;
  entry: string;
  language?: 'python' | 'node' | 'bash';
  params?: Record<string, unknown>;
  files?: Record<string, unknown>;
  resultFile?: string;
  packages?: { python?: string[]; node?: string[] };
  timeoutMs?: number;
}

export interface SandboxScriptOutcome {
  ok: boolean;
  status: string;
  result?: unknown;
  files: Array<{
    name: string;
    storageId: string;
    size: number;
    contentType: string;
  }>;
  exitCode?: number;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
}

export type SandboxScriptRunner = (
  run: SandboxScriptRun,
) => Promise<SandboxScriptOutcome>;

export function sandboxScriptNatives(
  runner: SandboxScriptRunner,
): Readonly<Record<string, NativeIntegrationImpl>> {
  const runScript: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = runScriptInput.safeParse(input);
    if (!parsed.success) {
      throw new IntegrationError(
        'INPUT_INVALID',
        `sandbox.run_script: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
          .join('; ')}`,
        {},
      );
    }
    if (ctx.caller?.kind !== 'workflow') {
      throw new IntegrationError(
        'INPUT_INVALID',
        "sandbox.run_script runs only inside an automation run — it executes in the run's own sandbox session",
        {},
      );
    }
    const value = parsed.data;
    return await runner({
      organizationId: ctx.organizationId,
      runId: ctx.caller.runId,
      skill: value.skill,
      entry: value.entry,
      ...(value.language !== undefined ? { language: value.language } : {}),
      ...(value.params !== undefined ? { params: value.params } : {}),
      ...(value.files !== undefined ? { files: value.files } : {}),
      ...(value.output?.resultFile !== undefined
        ? { resultFile: value.output.resultFile }
        : {}),
      ...(value.packages !== undefined ? { packages: value.packages } : {}),
      ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
    });
  };

  return { 'sandbox.run_script': runScript };
}
