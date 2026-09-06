/**
 * The live runner behind the `sandbox.run_script` platform capability — the
 * deterministic sibling of the agent host.
 *
 * A script is an asset of an org SKILL bundle: the runner stages the whole
 * bundle at `/agent/code/skills/<skill>/`, each declared `files` mount at
 * `/agent/uploads/<name>/`, the params object at `/agent/code/params.json`,
 * then runs the entry in the run's shared workflow session, harvests
 * `/agent/output`, and parses the declared result file into `result`.
 *
 * One atomic capability call: unlike an agent turn it never suspends the run
 * — the exec is bounded, and a script that needs longer belongs in smaller
 * steps. Everything org-scoped is bound by the dispatch (the run decides
 * whose session and whose folders), never by the document.
 */

import type {
  SandboxScriptOutcome,
  SandboxScriptRun,
} from '../../../lib/connectors/natives/sandbox-script';
import type { ActionCtx } from '../lib/ctx';
import {
  sessionReadFile,
  sessionStageFiles,
} from '../node_only/sandbox/helpers/session_client';
import {
  harvestSessionOutput,
  OUTPUT_DIR,
  runStepsInSession,
} from '../node_only/sandbox/session_exec';
import {
  ensureWorkflowSession,
  resolveRunSkillViewer,
  stageSkillBundle,
  stageWorkflowFiles,
} from './agent_host';

/** Default per-run exec ceiling. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 120_000;
/** Hard ceiling: the capability call runs inside one stepper job and holds
 * the run's sandbox slot for its whole duration. A longer pipeline belongs in
 * smaller steps (or behind the agent lane, which suspends). */
export const MAX_SCRIPT_TIMEOUT_MS = 240_000;
/** A result file bigger than this is a data artifact, not a verdict. */
const MAX_RESULT_FILE_BYTES = 1_000_000;
/** How much of stdout/stderr the outcome carries back to the document. */
const PREVIEW_BYTES = 4096;

function scriptTimeoutMs(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_SCRIPT_TIMEOUT_MS;
  return Math.min(Math.max(requested, 1_000), MAX_SCRIPT_TIMEOUT_MS);
}

/** `/agent/code/skills/<skill>/<entry>` with the entry confined to the
 * bundle — a `..` or absolute entry would run a file the skill never
 * shipped. */
export function scriptEntryPath(skill: string, entry: string): string {
  const clean = entry.replace(/^\/+/, '');
  if (
    clean === '' ||
    clean.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(
      `the script entry ${JSON.stringify(entry)} must be a path inside the skill bundle`,
    );
  }
  return `/agent/code/skills/${skill}/${clean}`;
}

/** The outcome plus the diagnostics the runner adds when it has them. */
export type SandboxScriptOutcomeWide = SandboxScriptOutcome & {
  resultError?: string;
  harvestSkipped?: Array<{ path: string; reason: string }>;
  errorMessage?: string;
};

/**
 * The real script runner over the automations ctx — the run decides whose
 * session and whose folders, never the document.
 */
export function workflowScriptRunner(
  ctx: ActionCtx,
): (run: SandboxScriptRun) => Promise<SandboxScriptOutcomeWide> {
  return async (run) => {
    // Refuse a bad entry BEFORE a session is provisioned or anything staged.
    const entryPath = scriptEntryPath(run.skill, run.entry);

    const sessionId = await ensureWorkflowSession(
      ctx,
      run.organizationId,
      run.runId,
    );

    await stageSkillBundle(
      ctx,
      run.organizationId,
      sessionId,
      run.skill,
      `code/skills/${run.skill}`,
      await resolveRunSkillViewer(ctx, run.organizationId, run.runId),
    );
    await stageWorkflowFiles(
      ctx,
      run.organizationId,
      sessionId,
      run.files,
      'uploads/',
    );
    // params.json is written on EVERY run — an empty object included — so a
    // previous node's params can never leak into this one through the shared
    // session.
    const params = JSON.stringify(run.params ?? {});
    const staged = await sessionStageFiles(sessionId, [
      {
        path: 'code/params.json',
        contentBase64: Buffer.from(params, 'utf8').toString('base64'),
      },
    ]);
    if (staged.skipped.length > 0) {
      throw new Error(
        `staging params.json failed: ${staged.skipped
          .map((s) => `${s.path} (${s.reason})`)
          .join(', ')}`,
      );
    }

    const started = Date.now();
    const exec = await runStepsInSession(sessionId, {
      stepPaths: [entryPath],
      ...(run.packages !== undefined && { packagesByLang: run.packages }),
      timeoutMs: scriptTimeoutMs(run.timeoutMs),
    });

    const { files, harvestSkipped } = await harvestSessionOutput(ctx, {
      organizationId: run.organizationId,
      sessionId,
    });

    // The result file is the script's own verdict — read it back directly so
    // the caller gets structure, not a blob reference. Missing or unparsable
    // is reported, never fatal: the exec status still tells the truth.
    const resultFile = run.resultFile ?? 'result.json';
    let result: unknown;
    let resultError: string | undefined;
    const read = await sessionReadFile(
      sessionId,
      `${OUTPUT_DIR}/${resultFile}`,
    ).catch((err: unknown) => {
      resultError = err instanceof Error ? err.message : String(err);
      return null;
    });
    if (read === null) {
      resultError ??= `the script wrote no ${resultFile}`;
    } else if (read.bytes.byteLength > MAX_RESULT_FILE_BYTES) {
      resultError = `${resultFile} is larger than the ${MAX_RESULT_FILE_BYTES}-byte result ceiling`;
    } else {
      try {
        result = JSON.parse(Buffer.from(read.bytes).toString('utf8'));
      } catch (err) {
        resultError = `${resultFile} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return {
      ok: exec.status === 'completed' && exec.exitCode === 0,
      status: exec.status,
      ...(result !== undefined ? { result } : {}),
      ...(resultError !== undefined ? { resultError } : {}),
      files: files.map((file) => ({
        name: file.path.split('/').at(-1) ?? file.path,
        storageId: file.storageId,
        size: file.size,
        contentType: file.contentType,
      })),
      ...(harvestSkipped.length > 0 ? { harvestSkipped } : {}),
      ...(exec.exitCode !== null ? { exitCode: exec.exitCode } : {}),
      ...(exec.errorMessage !== undefined
        ? { errorMessage: exec.errorMessage }
        : {}),
      stdoutPreview: exec.stdout.slice(0, PREVIEW_BYTES),
      stderrPreview: exec.stderr.slice(0, PREVIEW_BYTES),
      durationMs: Date.now() - started,
    };
  };
}
