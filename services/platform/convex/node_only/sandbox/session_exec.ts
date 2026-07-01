'use node';

/**
 * Stage 2 of the persistent-session design: run chat `run_code` inside the
 * thread's persistent sandbox session instead of a fresh ephemeral container.
 *
 * This is the sole chat `run_code` execution path — `run_code_tool` calls it
 * directly (the ephemeral one-shot path is no longer used by chat). An error
 * here surfaces to the model as a run_code failure.
 *
 * v1 scope (validate against a live session, then harden): single- and
 * multi-step scripts + package install run as sequential in-session execs;
 * harvest reads top-level `/user/output` files and upserts only new/changed
 * ones (sha256) — the persistent workspace means prior outputs already live
 * there, so the re-stage/re-harvest churn of the ephemeral path is gone. Known
 * follow-ups: nested output dirs, a `fileMetadata` row per output (as the
 * ephemeral path writes via `insertOutputFiles`), and a durable
 * `sandboxSessionOps` audit row.
 */

import { createHash, randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction } from '../../_generated/server';
import { inferStepLanguage } from '../../agent_tools/files/_shared';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  drainSessionExecResilient,
  sessionListFiles,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';

const SANDBOX_MAX_OUTPUT_FILES_PER_RUN = 16;
const OUTPUT_DIR = '/user/output';

// Explicit return type — the handler references `internal` (which transitively
// includes this action), so TS cannot infer its return type without a cycle.
interface SessionExecResultShape {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  files: Array<{
    path: string;
    storageId: string;
    size: number;
    contentType: string;
  }>;
}

function interpreterCommand(absPath: string): string[] | null {
  const lang = inferStepLanguage(absPath);
  if (lang === 'python') return ['python3', absPath];
  if (lang === 'node') return ['node', absPath];
  if (lang === 'bash') return ['bash', absPath];
  return null;
}

/** Strip the `/user/` mount prefix — `sessionStageFiles` paths are relative to
 *  the workspace root (`/user`). `/user/code/gen.py` → `code/gen.py`. */
function stagePathOf(absolutePath: string): string {
  return absolutePath.replace(/^\/user\//, '');
}

export const executeCodeInSession = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    uploadedBy: v.string(),
    // Absolute /user/code/<script> paths (already validated by run_code_tool).
    stepPaths: v.array(v.string()),
    packagesByLang: v.optional(
      v.object({
        python: v.optional(v.array(v.string())),
        node: v.optional(v.array(v.string())),
      }),
    ),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    executionId: v.string(),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    exitCode: v.union(v.number(), v.null()),
    stdoutPreview: v.string(),
    stderrPreview: v.string(),
    durationMs: v.number(),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.string(),
        size: v.number(),
        contentType: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<SessionExecResultShape> => {
    const startedAt = Date.now();
    const execId = randomUUID();
    const timeoutMs = args.timeoutMs ?? 30_000;

    const { sessionId, created } = await ctx.runAction(
      internal.node_only.sandbox.thread_session.ensureThreadSession,
      {
        organizationId: args.organizationId,
        threadId: args.threadId,
        createdBy: args.uploadedBy,
      },
    );

    // Stage inputs. On a fresh session, reconstruct the whole workspace from
    // threadFiles; on a warm/resumed one, only re-stage the mutable inputs
    // (scripts/uploads) — prior `run_output` files persist in the workspace.
    const rows = await ctx.runQuery(
      internal.thread_files.internal_queries.listThreadFiles,
      { threadId: args.threadId },
    );
    const toStage: { path: string; url: string }[] = [];
    for (const r of rows as Array<{
      organizationId: string;
      path: string;
      storageId: Id<'_storage'>;
      source: 'user_upload' | 'agent_write' | 'run_output';
    }>) {
      if (r.organizationId !== args.organizationId) continue;
      if (r.source === 'run_output' && !created) continue;
      const raw = await ctx.storage.getUrl(r.storageId);
      if (raw === null) continue;
      toStage.push({
        path: stagePathOf(r.path),
        url: toSandboxStorageUrl(raw),
      });
    }
    if (toStage.length > 0) {
      await sessionStageFiles(sessionId, toStage);
    }

    const abort = new AbortController();
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    const runExec = async (command: string[], perTimeout: number) =>
      drainSessionExecResilient(
        sessionId,
        {
          execId: randomUUID(),
          command,
          cwd: '/user/code',
          collectOutput: true,
          timeoutMs: perTimeout,
        },
        abort.signal,
      );

    // Install declared packages first (persist in the session for later runs).
    const py = args.packagesByLang?.python ?? [];
    const node = args.packagesByLang?.node ?? [];
    if (py.length > 0) {
      const r = await runExec(
        ['python3', '-m', 'pip', 'install', '--no-input', ...py],
        Math.min(timeoutMs, 300_000),
      );
      stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
    }
    if (node.length > 0) {
      const r = await runExec(
        ['npm', 'install', '-g', ...node],
        Math.min(timeoutMs, 300_000),
      );
      stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
    }

    // Run each step in order; stop at the first failure.
    let exitCode: number | null = 0;
    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    for (const absPath of args.stepPaths) {
      const command = interpreterCommand(absPath);
      if (command === null) {
        status = 'failed';
        stderrParts.push(`No interpreter for "${absPath}".`);
        exitCode = 1;
        break;
      }
      const r = await runExec(command, timeoutMs);
      stdoutParts.push(Buffer.from(r.stdoutBase64, 'base64').toString('utf8'));
      stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
      exitCode = r.exitCode;
      if (r.status !== 'completed' || (r.exitCode ?? 0) !== 0) {
        status = r.status === 'cancelled' ? 'cancelled' : 'failed';
        break;
      }
    }

    // Harvest top-level /user/output, upserting only new/changed files (sha256).
    const files: Array<{
      path: string;
      storageId: string;
      size: number;
      contentType: string;
    }> = [];
    const entries = (await sessionListFiles(sessionId, OUTPUT_DIR)) ?? [];
    for (const e of entries) {
      if (e.type !== 'file') continue;
      if (files.length >= SANDBOX_MAX_OUTPUT_FILES_PER_RUN) break;
      const absPath = `${OUTPUT_DIR}/${e.name}`;
      const read = await sessionReadFile(sessionId, absPath);
      if (read === null) continue;
      const buf = Buffer.from(read.bytes);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const existing = await ctx.runQuery(
        internal.thread_files.internal_queries.getThreadFileByPath,
        { threadId: args.threadId, path: absPath },
      );
      if (existing !== null && existing.sha256 === sha256) continue; // unchanged
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      const storageId = await ctx.storage.store(new Blob([ab]));
      await ctx.runMutation(
        internal.thread_files.internal_mutations.upsertThreadFile,
        {
          organizationId: args.organizationId,
          threadId: args.threadId,
          path: absPath,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id branded at runtime
          storageId: storageId as Id<'_storage'>,
          size: buf.byteLength,
          contentType: read.contentType,
          sha256,
          source: 'run_output' as const,
        },
      );
      files.push({
        path: absPath,
        storageId,
        size: buf.byteLength,
        contentType: read.contentType,
      });
    }

    const stdout = stdoutParts.join('');
    const stderr = stderrParts.join('');
    return {
      executionId: execId,
      status,
      exitCode,
      stdoutPreview: stdout.slice(0, 4096),
      stderrPreview: stderr.slice(0, 4096),
      durationMs: Date.now() - startedAt,
      files,
    };
  },
});
