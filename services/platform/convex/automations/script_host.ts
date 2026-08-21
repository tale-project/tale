'use node';

/**
 * The live runner behind the `sandbox.run_script` platform capability — the
 * deterministic sibling of the agent host.
 *
 * A script is an asset of an org SKILL bundle (the new world has no pack
 * script paths): the runner stages the whole bundle at
 * `/agent/code/skills/<skill>/`, each declared `files` mount at
 * `/agent/uploads/<name>/`, the params object at `/agent/code/params.json`,
 * then runs the entry in the run's shared workflow session, harvests
 * `/agent/output`, and parses the declared result file into `result`.
 *
 * One atomic capability call: unlike an agent turn it never suspends the run
 * — the exec is bounded well inside the platform's action ceiling, and a
 * script that needs longer belongs in smaller steps.
 */

import type {
  SandboxScriptOutcome,
  SandboxScriptRun,
  SandboxScriptRunner,
} from '../../lib/connectors/natives/sandbox-script';
import type { ActionCtx } from '../_generated/server';
import {
  sessionReadFile,
  sessionStageFiles,
} from '../node_only/sandbox/helpers/session_client';
import {
  harvestSessionOutput,
  runStepsInSession,
} from '../node_only/sandbox/session_exec';
import {
  ensureWorkflowSession,
  resolveRunSkillViewer,
  stageSkillBundle,
  stageWorkflowFiles,
} from './agent_host';

/** Default per-run exec ceiling. */
const DEFAULT_SCRIPT_TIMEOUT_MS = 120_000;
/** Hard ceiling: the capability call runs inside a nested Convex action, so
 * the exec must settle well inside that window. A longer pipeline belongs in
 * smaller steps (or behind the agent lane, which suspends). */
const MAX_SCRIPT_TIMEOUT_MS = 240_000;
/** A result file bigger than this is a data artifact, not a verdict. */
const MAX_RESULT_FILE_BYTES = 1_000_000;

function scriptTimeoutMs(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_SCRIPT_TIMEOUT_MS;
  return Math.min(Math.max(requested, 1_000), MAX_SCRIPT_TIMEOUT_MS);
}

/** `code/skills/<skill>/<entry>` with the entry confined to the bundle. */
function entryPathOf(skill: string, entry: string): string {
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

/** The real script runner, bound to one organization like every capability
 * backend — the run decides whose session and whose folders, never the
 * document. */
export function workflowScriptRunner(ctx: ActionCtx): SandboxScriptRunner {
  return async (run: SandboxScriptRun): Promise<SandboxScriptOutcomeWide> => {
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
      throw new Error('staging params.json failed');
    }

    const started = Date.now();
    const exec = await runStepsInSession(sessionId, {
      stepPaths: [entryPathOf(run.skill, run.entry)],
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
      `/agent/output/${resultFile}`,
    ).catch((err) => {
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
      ...(exec.exitCode != null ? { exitCode: exec.exitCode } : {}),
      ...(exec.errorMessage !== undefined
        ? { errorMessage: exec.errorMessage }
        : {}),
      stdoutPreview: exec.stdout.slice(0, 4096),
      stderrPreview: exec.stderr.slice(0, 4096),
      durationMs: Date.now() - started,
    };
  };
}

/** The outcome plus the optional diagnostics the runner adds. */
type SandboxScriptOutcomeWide = SandboxScriptOutcome & {
  resultError?: string;
  harvestSkipped?: Array<{ path: string; reason: string }>;
  errorMessage?: string;
};
