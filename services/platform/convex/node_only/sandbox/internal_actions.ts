'use node';

// `executeCode` — the action the `artifact_run` agent tool calls.
//
// Owns the spawner round-trip + storage transactionality:
//   1. reserveSlotAndInsert mutation (atomic quota + audit row insert).
//   2. setRunning('installing') mutation + start a 60s heartbeat loop.
//   3. POST /v1/execute on the spawner with AbortSignal wired through.
//   4. Upload every output blob; if all succeed, single batched
//      `insertOutputFiles` mutation. On any storage failure, delete the
//      blobs we already wrote so we don't orphan `_storage`.
//   5. Upload stdout/stderr to `_storage` when over the preview cap.
//   6. finalize mutation with the structured result.
//
// Every failure path goes through the same `failExecution` helper which
// finalizes the audit row, finalizes the artifact row if one was tied to
// this run, and rolls back any uploaded storage blobs. This makes the
// "canvas spinner stuck forever" failure mode (R1 finding) structurally
// impossible — there is one terminate-and-clean code path, not six.
//
// Error rule:
//   - Infrastructure failures (spawner unreachable, action timeout, quota
//     mutation throw) → finalize + THROW so the agent SDK surfaces them.
//   - User-code failures (exit ≠ 0, sandbox timeout, OOM, install failure)
//     → finalize + RETURN structured result so the LLM can read and react.

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  SANDBOX_CODE_PREVIEW_MAX,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_OUTPUT_FILES_PER_RUN,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_OUTPUT_UPLOAD_SLOTS_PREALLOC,
  SANDBOX_STDERR_PREVIEW_MAX,
  SANDBOX_STDOUT_PREVIEW_MAX,
} from '../../sandbox/schema';
import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxStepResultValidator,
  type SandboxErrorCode,
  type SandboxRunProgressKind,
  type SandboxStepResult,
} from '../../sandbox/wire';
import { spawnerCancel, spawnerExecute } from './helpers/spawner_client';

const HEARTBEAT_INTERVAL_MS = 60_000;

// Explicit handler return type. Required to break a self-referential type
// cycle: without it, the inferred type of `executeCode` depends on its own
// handler's return type (which reaches `internal.sandbox.*` through
// `_generated/api.d.ts`). The cycle collapses every Convex consumer in the
// codebase to `any` — see PR #1727 CI breakage.
type ExecuteCodeResult = {
  executionId: Id<'sandboxExecutions'>;
  success: boolean;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: SandboxErrorCode;
  errorMessage?: string;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  files: Array<{
    name: string;
    fileMetadataId: Id<'fileMetadata'>;
    storageId: Id<'_storage'>;
    size: number;
    contentType: string;
  }>;
  steps?: SandboxStepResult[];
  /**
   * Pre-stage attestation summary surfaced from the spawner. Populated on
   * every artifact-bound run that had prior-output downloads; omitted
   * otherwise. The agent tool re-shapes this for the LLM-visible result
   * so the model can see exactly which prior files made it into
   * `/workspace/output/` and which were skipped (with structured reason).
   */
  preStage?: {
    staged: string[];
    skipped: Array<{ name: string; reason: string; detail: string }>;
  };
};

interface FailContext {
  ctx: ActionCtx;
  executionId: Id<'sandboxExecutions'>;
  artifactId?: Id<'artifacts'>;
  uploadedStorageIds: Set<string>;
  startedAt: number;
}

/**
 * One-stop failure handler. Finalizes the audit row, finalizes the artifact
 * row (so the canvas spinner stops), and cascade-deletes any `_storage`
 * blobs we already wrote. Always returns the structured result the caller
 * can `return` directly.
 */
/**
 * Roll back `_storage` blobs we already wrote in the action's in-memory
 * set. Used by `failExecution` AND by the success path when
 * `insertOutputFiles` reports `skippedTerminal` (race with user-cancel).
 * Clears the set after deletion so the finally block doesn't double-free.
 */
async function rollbackUploadedBlobs(
  ctx: { storage: { delete: (id: Id<'_storage'>) => Promise<void> } },
  ids: Set<string>,
  context: string,
): Promise<void> {
  for (const sid of ids) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- delete needs Id<'_storage'>
      await ctx.storage.delete(sid as unknown as Id<'_storage'>);
    } catch (err) {
      console.warn(`[${context}] storage.delete(${sid}) failed:`, err);
    }
  }
  ids.clear();
}

async function failExecution(
  fc: FailContext,
  status: 'failed' | 'cancelled',
  errorCode: SandboxErrorCode,
  errorMessage: string,
  extra?: {
    stdoutPreview?: string;
    stderrPreview?: string;
    exitCode?: number | null;
  },
): Promise<ExecuteCodeResult> {
  const durationMs = Date.now() - fc.startedAt;
  await rollbackUploadedBlobs(
    fc.ctx,
    fc.uploadedStorageIds,
    'sandbox.failExecution',
  );

  try {
    await fc.ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
      executionId: fc.executionId,
      status,
      errorCode,
      errorMessage,
      ...(extra?.stdoutPreview !== undefined && {
        stdoutPreview: extra.stdoutPreview,
      }),
      ...(extra?.stderrPreview !== undefined && {
        stderrPreview: extra.stderrPreview,
      }),
      ...(extra?.exitCode !== undefined &&
        extra.exitCode !== null && { exitCode: extra.exitCode }),
      outputFiles: [],
      durationMs,
      actualSeconds: durationMs / 1000,
    });
  } catch (err) {
    console.warn(`[sandbox.failExecution] audit finalize failed:`, err);
  }

  if (fc.artifactId) {
    try {
      await fc.ctx.runMutation(
        internal.artifacts.internal_mutations.finalizeArtifactRun,
        {
          artifactId: fc.artifactId,
          runStatus: status,
          runErrorCode: errorCode,
          runErrorMessage: errorMessage,
          ...(extra?.exitCode !== undefined &&
            extra.exitCode !== null && { runExitCode: extra.exitCode }),
          ...(extra?.stdoutPreview !== undefined && {
            runStdoutPreview: extra.stdoutPreview,
          }),
          ...(extra?.stderrPreview !== undefined && {
            runStderrPreview: extra.stderrPreview,
          }),
          runOutputFiles: [],
          runExecutionId: fc.executionId,
        },
      );
    } catch (err) {
      console.warn(`[sandbox.failExecution] artifact finalize failed:`, err);
    }
  }

  return {
    executionId: fc.executionId,
    success: false,
    status,
    exitCode: extra?.exitCode ?? null,
    errorCode,
    errorMessage,
    stdoutPreview: extra?.stdoutPreview ?? '',
    stderrPreview: extra?.stderrPreview ?? '',
    durationMs,
    truncated: { stdout: false, stderr: false, files: 0 },
    files: [],
  };
}

function buildInstallProgress(packages: string[] | undefined): {
  kind: SandboxRunProgressKind;
  package?: string;
  version?: string;
} {
  if (!packages || packages.length === 0) {
    return { kind: 'installing' };
  }
  // `python-pptx==1.0.2` → { package: 'python-pptx', version: '1.0.2' }.
  // Anything that doesn't match the canonical pip/npm spec falls back to
  // the no-version variant; the UI message map handles both via ICU.
  const first = packages[0];
  if (first === undefined) return { kind: 'installing' };
  const match = first.match(/^([^@=<>!~]+)(?:[@=]=?([^@=<>!~ ]+))?/);
  if (match && match[1]) {
    return {
      kind: 'installingPackage',
      package: match[1].trim(),
      ...(match[2] !== undefined && { version: match[2].trim() }),
    };
  }
  return { kind: 'installing' };
}

export const executeCode = internalAction({
  args: {
    organizationId: v.string(),
    uploadedBy: v.string(),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),

    language: sandboxLanguageValidator,
    /**
     * Files to stage under /workspace/code/<path>. Required for both
     * modes — single-script needs the entry file, multi-script needs every
     * step's file. Forwarded verbatim to the spawner; the spawner
     * re-validates path safety.
     */
    files: v.array(v.object({ path: v.string(), content: v.string() })),
    /**
     * Single-script mode: relative path inside `files[]` to exec. The
     * runtime entrypoint receives this and exec()s `/workspace/code/<entryPath>`
     * directly — no synthetic mirror. Mutually exclusive with `steps`;
     * the mutex is enforced below before the reservation mutation, and
     * re-enforced at the spawner boundary.
     */
    entryPath: v.optional(v.string()),
    /**
     * Multi-script mode: paths inside `files[]` to execute sequentially
     * in the same container. See artifact_run_tool / spawner ExecuteRequest
     * for the full contract. Mutually exclusive with `entryPath`.
     */
    steps: v.optional(v.array(v.string())),
    /**
     * Legacy single-bucket package list. For `language: 'python' | 'node'`
     * requests, this routes to whichever installer matches. Mutually
     * compatible with {@link packagesByLang} — when both are set, the
     * action sends both fields verbatim and the spawner picks the right
     * one per language.
     */
    packages: v.optional(v.array(v.string())),
    /**
     * Per-language package buckets. Required for `language: 'polyglot'`
     * (the spawner installs both buckets in one container). For single-
     * language requests, the bucket matching `language` is used and the
     * other is ignored.
     */
    packagesByLang: v.optional(
      v.object({
        python: v.optional(v.array(v.string())),
        node: v.optional(v.array(v.string())),
      }),
    ),
    timeoutMs: v.optional(v.number()),
    // NOTE: `allowSdist` / `allowInstallScripts` are intentionally NOT
    // accepted as action args. The spawner-side install guards (`pip
    // --only-binary=:all:` and `npm --ignore-scripts`) are hardcoded
    // server-side here so a prompt-injected LLM cannot disable them
    // (round-2 R2-B4). To grant a per-org carve-out, add an
    // `orgs.sandboxPolicy` table and gate the override there instead of
    // surfacing the knob to the LLM.
    purpose: v.string(),
    // When set, the action wires PHASE events from the spawner SSE to
    // patchArtifactRunProgress and finalizeArtifactRun — canvas shows
    // live progress instead of a frozen spinner.
    artifactId: v.optional(v.id('artifacts')),
    /**
     * For `skill_run` invocations: the skill slug being executed (mutually
     * exclusive with artifactId in practice). Populates the
     * `sandboxExecutions.skillSlug` column for forensics.
     */
    skillSlug: v.optional(v.string()),
    /**
     * SHA-256 of SKILL.md at execution time. Lets forensics correlate a
     * stuck/failed run with the exact bundle revision that was loaded.
     */
    skillVersionHash: v.optional(v.string()),
    /**
     * Pre-stage source override. Default behaviour ("latest succeeded
     * run") applies when omitted or when `fromRun === 'latest'`. Pass a
     * specific `artifactRuns` row id to pin pre-staging to that run.
     */
    inputs: v.optional(
      v.object({
        fromRun: v.string(),
      }),
    ),
    /**
     * When true (and `threadId` is set), every chat-uploaded attachment
     * on the calling thread is staged into `/workspace/output/` before
     * user code runs — same mechanism that artifact pre-stage uses for
     * prior outputs. Used by `skill_run` so a bound skill can operate
     * on whatever the user just attached without each skill author
     * threading storage IDs by hand.
     *
     * Off by default for artifact-driven runs (`runCode` etc.) so the
     * existing prior-output staging contract is unchanged.
     */
    stageThreadAttachments: v.optional(v.boolean()),
  },
  returns: v.object({
    executionId: v.id('sandboxExecutions'),
    success: v.boolean(),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    exitCode: v.union(v.number(), v.null()),
    errorCode: v.optional(sandboxErrorCodeValidator),
    errorMessage: v.optional(v.string()),
    stdoutPreview: v.string(),
    stderrPreview: v.string(),
    durationMs: v.number(),
    truncated: v.object({
      stdout: v.boolean(),
      stderr: v.boolean(),
      files: v.number(),
    }),
    files: v.array(
      v.object({
        name: v.string(),
        fileMetadataId: v.id('fileMetadata'),
        storageId: v.id('_storage'),
        size: v.number(),
        contentType: v.string(),
        sha256: v.optional(v.string()),
      }),
    ),
    steps: v.optional(v.array(sandboxStepResultValidator)),
    // Pre-stage attestation surfaced from the spawner — present whenever
    // the request had `priorOutputDownloads`. `staged[]` is the list of
    // names that actually landed in /workspace/output/ before user code
    // ran; `skipped[]` carries any expected files the spawner couldn't
    // stage, with a structured reason. When skipped[] is non-empty, the
    // action takes the PRE_STAGE_FAILED path; this field still lets the
    // LLM-facing tool show what worked vs what didn't.
    preStage: v.optional(
      v.object({
        staged: v.array(v.string()),
        skipped: v.array(
          v.object({
            name: v.string(),
            reason: v.string(),
            detail: v.string(),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<ExecuteCodeResult> => {
    // Exactly one of `entryPath` or `steps` must be set. The spawner
    // enforces this at the wire boundary, but we re-check here so a
    // misuse from another caller (e.g. a future free-form executor)
    // fails fast with a useful diagnostic instead of confusing 400s
    // from the spawner.
    const entryProvided = args.entryPath !== undefined;
    const stepsProvided = args.steps !== undefined && args.steps.length > 0;
    if (entryProvided === stepsProvided) {
      throw new ConvexError({
        code: 'INPUT_REJECTED',
        message:
          'executeCode requires exactly one of `entryPath` (single-script) or `steps[]` (multi-script).',
      });
    }
    if (args.files.length === 0) {
      throw new ConvexError({
        code: 'INPUT_REJECTED',
        message: 'executeCode requires `files[]` carrying the script contents.',
      });
    }

    const timeoutMs = Math.min(
      Math.max(args.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, 1_000),
      SANDBOX_MAX_TIMEOUT_MS,
    );
    const estimatedSeconds = Math.ceil(timeoutMs / 1000);

    // ---- codePreview / codeStorageId split ----
    // Single-script mode: persist the entry file's content as the executed
    // source. Multi-step mode: the spawner generates the executed wrapper
    // itself, so persist a stable synthesized preview keyed off the step
    // list — the audit row still shows what was requested without
    // falsely advertising any of the user's individual scripts as "the
    // executed code".
    const sourceForPreview = entryProvided
      ? (args.files.find((f) => f.path === args.entryPath)?.content ?? '')
      : `[multi-step] ${args.steps?.join(' → ') ?? ''}`;
    const codeBytes = Buffer.byteLength(sourceForPreview, 'utf8');
    let codePreview = sourceForPreview;
    let codeStorageId: Id<'_storage'> | undefined;
    if (codeBytes > SANDBOX_CODE_PREVIEW_MAX) {
      const blob = new Blob([sourceForPreview], { type: 'text/plain' });
      codeStorageId = await ctx.storage.store(blob);
      codePreview = sourceForPreview.slice(0, SANDBOX_CODE_PREVIEW_MAX);
    }

    // ---- atomic reservation (concurrent cap + daily CPU budget + insert) ----
    // If reservation throws (QUOTA_EXCEEDED, daily budget, etc.) the blob we
    // just stored is orphaned — it never lands on an audit row to be owned.
    // The wider `failExecution`-driven rollback set isn't yet constructed at
    // this point, so we delete here in the catch (audit finding R2-B7 #1).
    let executionId: Id<'sandboxExecutions'>;
    try {
      executionId = await ctx.runMutation(
        internal.sandbox.internal_mutations.reserveSlotAndInsert,
        {
          organizationId: args.organizationId,
          uploadedBy: args.uploadedBy,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          ...(args.messageId !== undefined && { messageId: args.messageId }),
          ...(args.toolCallId !== undefined && {
            toolCallId: args.toolCallId,
          }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          ...(args.artifactId !== undefined && { artifactId: args.artifactId }),
          ...(args.skillSlug !== undefined && { skillSlug: args.skillSlug }),
          ...(args.skillVersionHash !== undefined && {
            skillVersionHash: args.skillVersionHash,
          }),
          // Audit-row attribution: single-script → the executed file;
          // multi-step → the first step (still a meaningful pointer into
          // the artifact tree for forensic grep).
          path: args.entryPath ?? args.steps?.[0] ?? '<unknown>',
          language: args.language,
          purpose: args.purpose,
          codePreview,
          ...(codeStorageId !== undefined && { codeStorageId }),
          // Audit-row attribution: flatten polyglot buckets back into a
          // single list so historical grep ("which runs installed
          // markitdown?") still works regardless of which language route
          // they took. Order: legacy `packages` first, then python bucket,
          // then node bucket — preserves the "first spec wins" semantics
          // that `buildInstallProgress` relies on for the install banner.
          packages: [
            ...(args.packages ?? []),
            ...(args.packagesByLang?.python ?? []),
            ...(args.packagesByLang?.node ?? []),
          ],
          // installOptions is intentionally NOT forwarded: install-safety
          // is hardcoded server-side (round-2 R2-B4). The schema field
          // remains optional for backward compatibility with old rows.
          estimatedSeconds,
        },
      );
    } catch (err) {
      // Reservation failed — the codeStorageId blob is now orphaned. Delete
      // it before propagating so a quota-bounce-loop doesn't accrete
      // unowned `_storage` rows (audit finding R2-B7 #1).
      if (codeStorageId !== undefined) {
        try {
          await ctx.storage.delete(codeStorageId);
        } catch (deleteErr) {
          console.warn(
            '[sandbox.executeCode] codeStorageId rollback after reservation failure failed:',
            deleteErr,
          );
        }
      }
      // Quota errors are user-facing — surface as ConvexError. The tool's
      // wrapper translates this into structured agent-visible output.
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
        (err.data as { code?: string }).code === 'QUOTA_EXCEEDED'
      ) {
        const dataMessage =
          err.data && typeof err.data === 'object' && 'message' in err.data
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose; we just type-narrowed the message key
              String((err.data as { message?: string }).message)
            : 'Sandbox quota exceeded';
        throw new ConvexError({
          code: 'QUOTA_EXCEEDED',
          message: dataMessage,
        });
      }
      throw err;
    }

    const startedAt = Date.now();
    const uploadedStorageIds = new Set<string>();
    const fc: FailContext = {
      ctx,
      executionId,
      ...(args.artifactId !== undefined && { artifactId: args.artifactId }),
      uploadedStorageIds,
      startedAt,
    };

    // ---- flip status to installing, start heartbeat ----
    // The spawner emits a real `installing` phase event later, but flipping
    // to `installing` here means the watchdog can also reap rows that get
    // stuck before the spawner ever responds (the `queued` sweep handles
    // throws between this point and reserveSlotAndInsert, but `installing`
    // also signals the canvas to show a progress spinner immediately).
    try {
      await ctx.runMutation(internal.sandbox.internal_mutations.setRunning, {
        executionId,
        status: 'installing',
      });
    } catch (err) {
      return failExecution(
        fc,
        'failed',
        'SPAWNER_UNAVAILABLE',
        `failed to flip audit row to installing: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fire heartbeat from a separate function so we can also call it inline
    // around long blocking work (storage uploads of multi-MB output files
    // can otherwise hog the event loop long enough that the interval timer's
    // fires get coalesced and `heartbeatAt` ages past the watchdog cutoff,
    // causing the watchdog to wrongly mark this live run as stuck —
    // audit finding R2-B6 #3).
    const tickHeartbeat = async (): Promise<void> => {
      try {
        await ctx.runMutation(internal.sandbox.internal_mutations.heartbeat, {
          executionId,
        });
      } catch (err) {
        // Don't swallow silently — a stalled heartbeat path is exactly the
        // failure mode the watchdog mis-classifies as "stuck execution"
        // (R2-B6 #2). Logging it makes the regression visible in production
        // before users notice the wrong-side ghost result.
        console.warn('[sandbox.executeCode] heartbeat mutation failed:', err);
      }
    };
    const heartbeat = setInterval(() => {
      void tickHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const abort = new AbortController();

    // ---- live stdout/stderr tail coalescer ----
    // The spawner emits `event: stdout` / `event: stderr` per-line (stdout)
    // and per-chunk (stderr). We buffer them and flush via one mutation per
    // ~250 ms or once the buffer exceeds the threshold, whichever first —
    // so a chatty `pip install` doesn't fire one Convex mutation per line.
    // Drift between the live tail and the canonical preview written at
    // `finalizeArtifactRun` is bounded by the same 16-KB cap on each side.
    const OUTPUT_FLUSH_DEBOUNCE_MS = 250;
    const OUTPUT_FLUSH_THRESHOLD_BYTES = 2048;
    let pendingStdout = '';
    let pendingStderr = '';
    let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputFlushInFlight = false;
    let outputBufferingStopped = false;
    const flushOutputBuffer = async (): Promise<void> => {
      if (outputFlushInFlight) return;
      if (!pendingStdout && !pendingStderr) return;
      if (!args.artifactId) {
        pendingStdout = '';
        pendingStderr = '';
        return;
      }
      const stdoutDelta = pendingStdout;
      const stderrDelta = pendingStderr;
      pendingStdout = '';
      pendingStderr = '';
      outputFlushInFlight = true;
      try {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.appendArtifactRunOutput,
          {
            artifactId: args.artifactId,
            executionId,
            ...(stdoutDelta && { stdoutDelta }),
            ...(stderrDelta && { stderrDelta }),
          },
        );
      } catch (err) {
        // Tail is UX-only; never block the run on a failed append.
        console.warn(
          '[sandbox.executeCode] appendArtifactRunOutput failed:',
          err,
        );
      } finally {
        outputFlushInFlight = false;
        if (
          !outputBufferingStopped &&
          (pendingStdout || pendingStderr) &&
          !outputFlushTimer
        ) {
          outputFlushTimer = setTimeout(() => {
            outputFlushTimer = null;
            void flushOutputBuffer();
          }, OUTPUT_FLUSH_DEBOUNCE_MS);
        }
      }
    };
    const scheduleOutputFlush = (): void => {
      if (outputBufferingStopped) return;
      if (outputFlushTimer || outputFlushInFlight) return;
      outputFlushTimer = setTimeout(() => {
        outputFlushTimer = null;
        void flushOutputBuffer();
      }, OUTPUT_FLUSH_DEBOUNCE_MS);
    };
    const maybeFlushIfLarge = (): void => {
      if (
        pendingStdout.length + pendingStderr.length >=
        OUTPUT_FLUSH_THRESHOLD_BYTES
      ) {
        if (outputFlushTimer) {
          clearTimeout(outputFlushTimer);
          outputFlushTimer = null;
        }
        void flushOutputBuffer();
      }
    };
    const onStdoutTail = args.artifactId
      ? (text: string) => {
          if (outputBufferingStopped) return;
          pendingStdout += text;
          maybeFlushIfLarge();
          scheduleOutputFlush();
        }
      : undefined;
    const onStderrTail = args.artifactId
      ? (text: string) => {
          if (outputBufferingStopped) return;
          pendingStderr += text;
          maybeFlushIfLarge();
          scheduleOutputFlush();
        }
      : undefined;

    // ---- pre-stage prior run outputs ----
    // Sandbox-wobbly-origami plan §1: instead of base64-inlining prior outputs
    // into the spawner request body, we hand the spawner a list of
    // download URLs (rewritten through `toSandboxStorageUrl()` so they
    // resolve against the internal Caddy alias) and let it fetch each in
    // parallel. Avoids the 10 MiB cap on prior outputs and the JSON-over-
    // base64 wire encoding entirely.
    let priorOutputDownloads: Array<{ name: string; url: string }> = [];
    let priorOutputSkippedNote: string | undefined;
    // Captured here so the post-spawner attestation step (see §3 of the
    // crispy-curry plan) can diff `priorStage.staged[]` against what we
    // actually asked for. `sha256` is undefined for entries derived from
    // legacy `artifactRunFiles` rows; the attestation treats those as
    // "presence only" rather than "byte-exact".
    const priorOutputExpected: Array<{ name: string; sha256?: string }> = [];
    if (args.artifactId !== undefined) {
      try {
        const latest = await ctx.runQuery(
          internal.artifacts.internal_queries.getLatestRunOutputs,
          {
            artifactId: args.artifactId,
            expectedOrganizationId: args.organizationId,
            ...(args.inputs?.fromRun !== undefined && {
              fromRun: args.inputs.fromRun,
            }),
          },
        );
        const candidates = latest.files;
        const totalBytes = candidates.reduce((sum, f) => sum + f.size, 0);
        console.info(
          `[sandbox.preStage] artifact=${args.artifactId} source=${latest.source} candidates=${candidates.length} totalBytes=${totalBytes} fromRun=${args.inputs?.fromRun ?? 'default-latest'}`,
        );
        // Best-effort lazy migration: if the query had to fall back to the
        // walk-back path, run the derive mutation so the next pre-stage
        // hits the manifest in O(1). Never blocks the current run on
        // failure — the walk-back already supplied the data we need.
        if (latest.needsManifestDerive) {
          try {
            const r = await ctx.runMutation(
              internal.artifacts.internal_mutations
                .deriveOutputManifestFromHistory,
              { artifactId: args.artifactId },
            );
            console.info(
              `[sandbox.preStage] manifest-derived artifact=${args.artifactId} inserted=${r.inserted} alreadyPresent=${r.alreadyPresent}`,
            );
          } catch (deriveErr) {
            console.warn(
              `[sandbox.preStage] manifest derive failed (non-fatal):`,
              deriveErr,
            );
          }
        }
        const skipped: string[] = [];
        for (const file of candidates) {
          // Build a sandbox-bound download URL. `getUrl()` returns the
          // public form; rewrite it through `toSandboxStorageUrl()` so the
          // spawner's fetch goes through the internal Caddy alias rather
          // than the publicly-resolvable hostname.
          let rawUrl: string | null;
          try {
            rawUrl = await ctx.storage.getUrl(file.storageId);
          } catch (urlErr) {
            console.warn(
              `[sandbox.preStage] getUrl(${file.storageId}) failed for ${file.name}:`,
              urlErr,
            );
            skipped.push(file.name);
            continue;
          }
          if (rawUrl === null) {
            skipped.push(file.name);
            continue;
          }
          priorOutputDownloads.push({
            name: file.name,
            url: toSandboxStorageUrl(rawUrl),
          });
          priorOutputExpected.push({
            name: file.name,
            ...(file.sha256 !== undefined && { sha256: file.sha256 }),
          });
        }
        if (skipped.length > 0) {
          priorOutputSkippedNote = `[tale-sandbox] prior-output blobs missing in storage, skipped: ${skipped.join(', ')}\n`;
          console.warn(
            `[sandbox.preStage] SKIP-MISSING artifact=${args.artifactId} skipped=${JSON.stringify(skipped)}`,
          );
        }
        if (priorOutputDownloads.length > 0) {
          console.info(
            `[sandbox.preStage] STAGED artifact=${args.artifactId} files=${JSON.stringify(priorOutputDownloads.map((f) => f.name))}`,
          );
        }
      } catch (err) {
        // Pre-staging is best-effort — never block the run on a load
        // failure. Surface a one-liner so users notice the regression in
        // CI but the script still gets its chance.
        console.warn(
          '[sandbox.executeCode] prior-output pre-stage failed:',
          err,
        );
        priorOutputDownloads = [];
        priorOutputSkippedNote = `[tale-sandbox] prior-output pre-stage failed: ${err instanceof Error ? err.message : String(err)}\n`;
      }
    }
    // Thread-attachment staging — additive to artifact pre-stage. When
    // `skill_run` (or any caller) sets `stageThreadAttachments`, every
    // chat-uploaded file on the thread is appended to
    // `priorOutputDownloads` so the spawner fetches and lands it in
    // `/workspace/output/<filename>` before user code runs.
    //
    // Filenames collide only if two attachments share a basename — the
    // spawner already de-duplicates by overwriting in the order it
    // receives, so the LAST appended file wins. Order matters: we put
    // artifact prior outputs first (existing semantic), thread
    // attachments after, so a chat upload with the same name as a
    // prior output replaces it (the user's most recent intent wins).
    //
    // Skipped reasons collected here flow through the same stderr-tail
    // channel as the artifact-side skipped notes so the LLM sees a
    // uniform "what didn't stage" surface.
    if (args.stageThreadAttachments === true && args.threadId !== undefined) {
      try {
        const attachments = await ctx.runQuery(
          internal.file_metadata.internal_queries.listChatAttachmentsForThread,
          {
            organizationId: args.organizationId,
            threadId: args.threadId,
          },
        );
        const skippedNames: string[] = [];
        for (const f of attachments) {
          let rawUrl: string | null;
          try {
            rawUrl = await ctx.storage.getUrl(f.storageId);
          } catch (urlErr) {
            console.warn(
              `[sandbox.preStage] thread-attachment getUrl(${f.storageId}) failed for ${f.fileName}:`,
              urlErr,
            );
            skippedNames.push(f.fileName);
            continue;
          }
          if (rawUrl === null) {
            skippedNames.push(f.fileName);
            continue;
          }
          priorOutputDownloads.push({
            name: f.fileName,
            url: toSandboxStorageUrl(rawUrl),
          });
        }
        if (priorOutputDownloads.length > 0) {
          console.info(
            `[sandbox.preStage] STAGED thread=${args.threadId} attachments=${JSON.stringify(attachments.map((a) => a.fileName))}`,
          );
        }
        if (skippedNames.length > 0) {
          const note = `[tale-sandbox] thread attachments missing in storage, skipped: ${skippedNames.join(', ')}\n`;
          priorOutputSkippedNote =
            priorOutputSkippedNote === undefined
              ? note
              : `${priorOutputSkippedNote}${note}`;
        }
      } catch (err) {
        console.warn(
          '[sandbox.executeCode] thread-attachment pre-stage failed:',
          err,
        );
        const note = `[tale-sandbox] thread-attachment pre-stage failed: ${err instanceof Error ? err.message : String(err)}\n`;
        priorOutputSkippedNote =
          priorOutputSkippedNote === undefined
            ? note
            : `${priorOutputSkippedNote}${note}`;
      }
    }

    if (priorOutputSkippedNote !== undefined && onStderrTail !== undefined) {
      // Route the note through the live-tail channel so it lands in the
      // canvas stderr panel alongside the script's own output.
      onStderrTail(priorOutputSkippedNote);
    }

    // ---- pre-allocate upload slots + persist quota counter ----
    // Plan §3: hand the spawner N pre-signed upload URLs up front (median
    // run = 1 file, p90 = 2; pre-alloc 2 to cover both without round-trip).
    // The remaining quota lives server-side so the spawner can lazily ask
    // for more via EP1 without us pre-vending all 16 URLs every run.
    const preAllocSlots: Array<{ url: string }> = [];
    try {
      for (let i = 0; i < SANDBOX_OUTPUT_UPLOAD_SLOTS_PREALLOC; i += 1) {
        const raw = await ctx.storage.generateUploadUrl();
        preAllocSlots.push({ url: toSandboxStorageUrl(raw) });
      }
    } catch (err) {
      return failExecution(
        fc,
        'failed',
        'SPAWNER_UNAVAILABLE',
        `failed to pre-allocate output upload slots: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const remainingQuota =
      SANDBOX_MAX_OUTPUT_FILES_PER_RUN - preAllocSlots.length;
    try {
      await ctx.runMutation(
        internal.sandbox.internal_mutations.applyInitOutputSlots,
        {
          executionId,
          slots: preAllocSlots.map((s) => s.url),
          quotaRemaining: remainingQuota,
        },
      );
    } catch (err) {
      console.warn(`[sandbox.executeCode] applyInitOutputSlots failed:`, err);
      // Non-fatal: the run can still proceed using the pre-allocated
      // slots; only the lazy EP1 path needs the quota counter.
    }

    // Resolve the sandbox-facing callback endpoints. The spawner uses
    // these to (a) request additional upload URLs via EP1 and (b) report
    // each successful storageId via EP2.
    //
    // Two ports are involved: storage upload/download is on convex:3210
    // (the admin/storage API, what `generateUploadUrl()` returns), while
    // user-defined httpActions live on convex:3211 (the HTTP API). Caddy
    // routes `/api/storage/*` → 3210 and `/api/*` → 3211. When we bypass
    // Caddy by talking directly to convex (`SANDBOX_STORAGE_INTERNAL_BASE_URL=
    // http://convex:3210`), the storage URLs work on the configured base
    // but the sandbox callbacks need an explicit port swap to 3211 — or
    // the operator overrides via SANDBOX_HTTP_API_BASE_URL.
    const storageBase = (
      process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL ??
      process.env.SITE_URL ??
      'http://127.0.0.1:3210'
    ).replace(/\/$/, '');
    const httpApiBase = (
      process.env.SANDBOX_HTTP_API_BASE_URL ??
      storageBase.replace(/:3210(\/|$)/, ':3211$1')
    ).replace(/\/$/, '');
    const outputUrlEndpoint = `${httpApiBase}/api/sandbox/output_upload_url`;
    const reportUploadedEndpoint = `${httpApiBase}/api/sandbox/record_uploaded`;

    try {
      const spawnerResult = await spawnerExecute(
        {
          executionId: String(executionId),
          organizationId: args.organizationId,
          language: args.language,
          // The mutual-exclusion gate at the top of the handler guarantees
          // exactly one of `entryPath` / `steps` lands in the body. We
          // forward both possibilities; the spawner's own validator
          // enforces the wire contract a second time.
          files: args.files,
          ...(args.entryPath !== undefined && { entryPath: args.entryPath }),
          ...(args.steps !== undefined &&
            args.steps.length > 0 && { steps: args.steps }),
          ...(args.packages !== undefined && { packages: args.packages }),
          ...(args.packagesByLang !== undefined && {
            packagesByLang: args.packagesByLang,
          }),
          ...(priorOutputDownloads.length > 0 && { priorOutputDownloads }),
          outputUploadSlots: preAllocSlots,
          outputUrlEndpoint,
          reportUploadedEndpoint,
          timeoutMs,
        },
        abort.signal,
        {
          ...(onStdoutTail && { onStdout: onStdoutTail }),
          ...(onStderrTail && { onStderr: onStderrTail }),
          onPhase: args.artifactId
            ? async (phase) => {
                // Structured progress — UI renders the localized text via
                // the `chat.runnable.progress.*` i18n keys. We never write
                // English literals into the artifact row anymore.
                const runProgress =
                  phase === 'installing'
                    ? buildInstallProgress([
                        ...(args.packages ?? []),
                        ...(args.packagesByLang?.python ?? []),
                        ...(args.packagesByLang?.node ?? []),
                      ])
                    : phase === 'running'
                      ? { kind: 'running' as const }
                      : phase === 'preparing'
                        ? { kind: 'preparing' as const }
                        : undefined;
                const runStatus =
                  phase === 'installing'
                    ? 'installing'
                    : phase === 'running'
                      ? 'running'
                      : phase === 'preparing'
                        ? 'installing'
                        : undefined;
                if (!runStatus) return;
                await ctx.runMutation(
                  internal.artifacts.internal_mutations
                    .patchArtifactRunProgress,
                  {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by args.artifactId guard
                    artifactId: args.artifactId as NonNullable<
                      typeof args.artifactId
                    >,
                    runStatus,
                    ...(runProgress && { runProgress }),
                    runExecutionId: executionId,
                  },
                );
              }
            : undefined,
        },
      );

      // Stop accepting more live-tail deltas. Any in-flight or pending
      // flush completes; subsequent SSE-callback invocations no-op. The
      // canonical preview is about to be written by `finalize` /
      // `finalizeArtifactRun`, so further appends would only race that
      // write to no benefit.
      outputBufferingStopped = true;
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }

      // ---- pre-stage attestation (crispy-curry plan §3) ----
      // The spawner ships back `priorStage.staged[]` listing every file
      // it actually wrote to /workspace/output/ before user code ran.
      // Diff against what we asked it to inject; any expected file that
      // didn't land → fail the run BEFORE we promote the spawner's output
      // blobs to fileMetadata, so the LLM can never see `success:true`
      // alongside a missing prior file. The skipped[] reasons (url_expired,
      // http_error, write_failed, etc.) are surfaced in the structured
      // errorMessage so the agent can decide whether to retry, pin
      // `inputs.from_run` to an older snapshot, or surface the issue.
      //
      // We add the spawner's outputFiles to uploadedStorageIds first so
      // failExecution cleans them — the bytes already landed in storage
      // via EP2 even though user code ran against a corrupted workspace.
      if (
        spawnerResult.priorStage !== undefined &&
        spawnerResult.priorStage.skipped.length > 0
      ) {
        for (const f of spawnerResult.outputFiles) {
          uploadedStorageIds.add(f.storageId);
        }
        const stagedNames = new Set(
          spawnerResult.priorStage.staged.map((s) => s.name),
        );
        const expectedMissing = priorOutputExpected.filter(
          (e) => !stagedNames.has(e.name),
        );
        const missingNames = expectedMissing.map((e) => e.name);
        console.warn(
          `[sandbox.preStage] PRE_STAGE_FAILED artifact=${args.artifactId ?? '(none)'} missing=${JSON.stringify(missingNames)} skipped=${JSON.stringify(spawnerResult.priorStage.skipped)}`,
        );
        return failExecution(
          fc,
          'failed',
          'PRE_STAGE_FAILED',
          JSON.stringify({
            missing: missingNames,
            skipped: spawnerResult.priorStage.skipped,
            message:
              'pre-stage attestation: spawner did not stage every expected prior-output file before user code ran',
          }),
          {
            stdoutPreview: Buffer.from(spawnerResult.stdoutBase64, 'base64')
              .toString('utf8')
              .slice(0, SANDBOX_STDOUT_PREVIEW_MAX),
            stderrPreview: Buffer.from(spawnerResult.stderrBase64, 'base64')
              .toString('utf8')
              .slice(0, SANDBOX_STDERR_PREVIEW_MAX),
            ...(spawnerResult.exitCode !== null && {
              exitCode: spawnerResult.exitCode,
            }),
          },
        );
      }

      // ---- upload-pipeline completeness gate (crispy-curry plan §4) ----
      // `uploadStats.failures` non-empty means at least one harvested file
      // either failed its upload POST or its EP2 record-back. The audit
      // row's `uploadedStorageIds[]` already cleaned the partials; treat
      // this as a fatal run so the LLM doesn't trust a workspace state
      // that doesn't match what's in the manifest after finalize.
      if (
        spawnerResult.uploadStats !== undefined &&
        spawnerResult.uploadStats.failures.length > 0 &&
        // Only escalate to UPLOAD_INCOMPLETE when the spawner didn't
        // already classify this as a specific upload-pipeline error. The
        // spawner's classifyFailure path may have already emitted
        // UPLOAD_FAILED / UPLOAD_QUOTA_EXCEEDED / UPLOAD_REPORT_FAILED;
        // preserve those rather than relabeling.
        spawnerResult.errorCode === undefined
      ) {
        for (const f of spawnerResult.outputFiles) {
          uploadedStorageIds.add(f.storageId);
        }
        const failed = spawnerResult.uploadStats.failures.map((f) => ({
          fileName: f.fileName,
          httpStatus: f.httpStatus,
          errorSnippet: f.errorSnippet,
        }));
        console.warn(
          `[sandbox.upload] UPLOAD_INCOMPLETE artifact=${args.artifactId ?? '(none)'} failures=${JSON.stringify(failed)}`,
        );
        return failExecution(
          fc,
          'failed',
          'UPLOAD_INCOMPLETE',
          JSON.stringify({
            failures: failed,
            message:
              'output-upload completeness: at least one harvested file failed its upload POST or EP2 record-back',
          }),
          {
            stdoutPreview: Buffer.from(spawnerResult.stdoutBase64, 'base64')
              .toString('utf8')
              .slice(0, SANDBOX_STDOUT_PREVIEW_MAX),
            stderrPreview: Buffer.from(spawnerResult.stderrBase64, 'base64')
              .toString('utf8')
              .slice(0, SANDBOX_STDERR_PREVIEW_MAX),
            ...(spawnerResult.exitCode !== null && {
              exitCode: spawnerResult.exitCode,
            }),
          },
        );
      }

      // ---- register file metadata (presigned upload pipeline) ----
      // Sandbox-wobbly-origami: the spawner POSTed each output blob to a
      // presigned URL itself, so by the time we reach here the bytes are
      // already in `_storage` and we have the allocated storageId on each
      // outputFiles entry. We just need to insert the sibling fileMetadata
      // rows. Track every storageId we accept so `failExecution` can roll
      // them back if a subsequent mutation throws.
      const stagedForInsert: Array<{
        name: string;
        storageId: Id<'_storage'>;
        size: number;
        contentType: string;
        sha256: string;
      }> = [];
      for (const f of spawnerResult.outputFiles) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- spawner-side validator already enforced the storageId is a non-empty string; cast to the branded id for the mutation arg
        const storageId = f.storageId as unknown as Id<'_storage'>;
        uploadedStorageIds.add(String(storageId));
        stagedForInsert.push({
          name: f.name,
          storageId,
          size: f.size,
          contentType: f.contentType,
          sha256: f.sha256,
        });
      }

      const insertResult = await ctx.runMutation(
        internal.sandbox.output_mutations.insertOutputFiles,
        {
          executionId,
          organizationId: args.organizationId,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          uploadedBy: args.uploadedBy,
          files: stagedForInsert,
        },
      );

      // If the audit row was terminalized between the spawner's SSE result
      // and this mutation (e.g., user clicked Stop near completion), the
      // mutation refuses to insert fileMetadata rows. Roll back the blobs
      // we already wrote — without this they orphan since neither the
      // audit row nor the artifactRunFiles will reference them (audit
      // follow-up F6 — cancel-race blob leak).
      if (insertResult.skippedTerminal) {
        console.warn(
          `[sandbox.executeCode] insertOutputFiles skipped — audit row already terminal; rolling back ${uploadedStorageIds.size} blob(s)`,
        );
        await rollbackUploadedBlobs(
          ctx,
          uploadedStorageIds,
          'sandbox.executeCode.cancel-race',
        );
        const cancelDurationMs = Date.now() - startedAt;
        return {
          executionId,
          success: false,
          status: 'cancelled',
          exitCode: spawnerResult.exitCode,
          errorCode: 'CANCELLED',
          errorMessage:
            'Run was cancelled while harvesting outputs; uploaded blobs rolled back.',
          stdoutPreview: '',
          stderrPreview: '',
          durationMs: cancelDurationMs,
          truncated: { stdout: false, stderr: false, files: 0 },
          files: [],
        };
      }
      const insertedFiles = insertResult.insertedFiles;

      // ---- stdout/stderr previews + overflow storage ----
      const stdoutText = Buffer.from(
        spawnerResult.stdoutBase64,
        'base64',
      ).toString('utf8');
      const stderrText = Buffer.from(
        spawnerResult.stderrBase64,
        'base64',
      ).toString('utf8');
      const stdoutPreview = stdoutText.slice(0, SANDBOX_STDOUT_PREVIEW_MAX);
      const stderrPreview = stderrText.slice(0, SANDBOX_STDERR_PREVIEW_MAX);
      let stdoutStorageId: Id<'_storage'> | undefined;
      let stderrStorageId: Id<'_storage'> | undefined;
      if (stdoutText.length > SANDBOX_STDOUT_PREVIEW_MAX) {
        await tickHeartbeat();
        const blob = new Blob([stdoutText], { type: 'text/plain' });
        stdoutStorageId = await ctx.storage.store(blob);
        uploadedStorageIds.add(String(stdoutStorageId));
      }
      if (stderrText.length > SANDBOX_STDERR_PREVIEW_MAX) {
        await tickHeartbeat();
        const blob = new Blob([stderrText], { type: 'text/plain' });
        stderrStorageId = await ctx.storage.store(blob);
        uploadedStorageIds.add(String(stderrStorageId));
      }

      const durationMs = spawnerResult.durationMs;
      const actualSeconds = durationMs / 1000;

      await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
        executionId,
        status: spawnerResult.status,
        ...(spawnerResult.exitCode !== null && {
          exitCode: spawnerResult.exitCode,
        }),
        ...(spawnerResult.errorCode !== undefined && {
          errorCode: spawnerResult.errorCode,
        }),
        ...(spawnerResult.errorMessage !== undefined && {
          errorMessage: spawnerResult.errorMessage,
        }),
        stdoutPreview,
        stderrPreview,
        ...(stdoutStorageId !== undefined && { stdoutStorageId }),
        ...(stderrStorageId !== undefined && { stderrStorageId }),
        outputFiles: insertedFiles.map((f) => ({
          name: f.name,
          fileMetadataId: f.fileMetadataId,
          size: f.size,
          contentType: f.contentType,
          sha256: f.sha256,
        })),
        truncated: spawnerResult.truncated,
        durationMs,
        actualSeconds,
        ...(spawnerResult.steps !== undefined && {
          steps: spawnerResult.steps,
        }),
        ...(spawnerResult.uploadStats !== undefined && {
          uploadStats: spawnerResult.uploadStats,
        }),
        ...(spawnerResult.timing !== undefined && {
          timing: spawnerResult.timing,
        }),
      });

      // When this run is tied to a runnable artifact, finalize the artifact
      // row so the canvas-runnable-code-renderer sees the completed state
      // + output file chips. The audit row above already holds the
      // per-execution forensics; the artifact row holds the *latest* state
      // for fast canvas reads.
      if (args.artifactId) {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.finalizeArtifactRun,
          {
            artifactId: args.artifactId,
            runStatus: spawnerResult.status,
            ...(spawnerResult.exitCode !== null && {
              runExitCode: spawnerResult.exitCode,
            }),
            ...(spawnerResult.errorCode !== undefined && {
              runErrorCode: spawnerResult.errorCode,
            }),
            ...(spawnerResult.errorMessage !== undefined && {
              runErrorMessage: spawnerResult.errorMessage,
            }),
            runStdoutPreview: stdoutPreview,
            runStderrPreview: stderrPreview,
            ...(stdoutStorageId !== undefined && {
              runStdoutStorageId: stdoutStorageId,
            }),
            ...(stderrStorageId !== undefined && {
              runStderrStorageId: stderrStorageId,
            }),
            runOutputFiles: insertedFiles.map((f) => ({
              name: f.name,
              fileMetadataId: f.fileMetadataId,
              storageId: f.storageId,
              size: f.size,
              contentType: f.contentType,
              sha256: f.sha256,
            })),
            runExecutionId: executionId,
          },
        );
      }

      // Successful path — the storage IDs are now owned by mutations; drop
      // them from the rollback set so the finally block doesn't double-free.
      uploadedStorageIds.clear();

      return {
        executionId,
        success: spawnerResult.status === 'completed',
        status: spawnerResult.status,
        exitCode: spawnerResult.exitCode,
        ...(spawnerResult.errorCode !== undefined && {
          errorCode: spawnerResult.errorCode,
        }),
        ...(spawnerResult.errorMessage !== undefined && {
          errorMessage: spawnerResult.errorMessage,
        }),
        stdoutPreview,
        stderrPreview,
        durationMs,
        truncated: spawnerResult.truncated,
        files: insertedFiles,
        ...(spawnerResult.steps !== undefined && {
          steps: spawnerResult.steps,
        }),
        ...(spawnerResult.priorStage !== undefined && {
          preStage: {
            staged: spawnerResult.priorStage.staged.map((s) => s.name),
            skipped: spawnerResult.priorStage.skipped.map((s) => ({
              name: s.name,
              reason: s.reason,
              detail: s.detail,
            })),
          },
        }),
      };
    } catch (err) {
      // Infra failure: best-effort spawner cancel (idempotent if container
      // already gone) and route through failExecution so the audit + artifact
      // rows both terminate AND any uploaded blobs are reclaimed.
      const message = err instanceof Error ? err.message : String(err);
      try {
        await spawnerCancel(String(executionId));
      } catch (cancelErr) {
        console.warn(
          `[sandbox.executeCode] best-effort spawnerCancel failed:`,
          cancelErr,
        );
      }
      await failExecution(fc, 'failed', 'SPAWNER_UNAVAILABLE', message);
      throw new Error(`Sandbox spawner failed: ${message}`, { cause: err });
    } finally {
      clearInterval(heartbeat);
      // Stop accepting/scheduling live-tail flushes — finalize has already
      // written (or is about to write) the canonical preview, and a pending
      // setTimeout here would keep the action alive past its useful work.
      outputBufferingStopped = true;
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      // Abort any in-flight fetch from spawnerExecute so the spawner-side
      // request can tear down promptly when the action exits (success,
      // structured failure, OR thrown infra error).
      abort.abort('action-exit');
    }
  },
});

/**
 * User-Stop cascade — kills every in-flight sandbox execution on a thread.
 *
 * Without this, clicking the chat's "Stop" button aborts the SDK stream but
 * leaves the spawner happily executing whatever the LLM started: container
 * burns CPU for up to `SANDBOX_MAX_TIMEOUT_MS`, quota keeps draining, canvas
 * spinner persists, and the eventually-arriving result silently overwrites
 * what the user wanted to cancel.
 *
 * Wiring: `convex/threads/cancel_generation.ts` schedules this via
 * `ctx.scheduler.runAfter(0, ...)` after abortStream'ing the SDK streams.
 * Scheduler (not direct runAction) because the calling mutation can't await
 * an action — and shouldn't, since the user is owed an immediate
 * Stop-acknowledged response.
 *
 * For each non-terminal execution:
 *  1. POST /v1/cancel/:id to the spawner — SIGKILLs the container and
 *     (per the same-PR change in server.ts/spawn.ts) writes a final SSE
 *     `event: result` with status:'cancelled' to the still-listening
 *     `executeCode` action, which then routes through its normal finalize.
 *  2. Also call `cancelExecutionRecord` directly — closes the window where
 *     the spawner-side cancel fails (network blip, container already gone)
 *     and the audit/artifact rows would otherwise stay non-terminal until
 *     the 15-min watchdog reap. The mutation is terminal-state-guarded so
 *     racing with `executeCode`'s own finalize is safe.
 */
export const cancelExecutionsForThread = internalAction({
  // `threadId` carried as `v.string()` because the upstream `threads` table
  // is provided by `@convex-dev/agent`; the platform schema stores its id
  // as a string on every reference (see `sandboxExecutions.threadId`).
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx: ActionCtx, args) => {
    const rows = await ctx.runQuery(
      internal.sandbox.internal_mutations.listNonTerminalByThread,
      { threadId: args.threadId },
    );
    let cancelled = 0;
    for (const row of rows) {
      try {
        await spawnerCancel(String(row._id));
      } catch (err) {
        // Best-effort — if the spawner is unreachable or the container is
        // already gone, we still mark the row cancelled below so the canvas
        // clears. The 404-on-unknown-id case is the most common and harmless.
        console.warn(
          `[sandbox.cancelExecutionsForThread] spawnerCancel(${row._id}) failed (continuing):`,
          err,
        );
      }
      try {
        await ctx.runMutation(
          internal.sandbox.internal_mutations.cancelExecutionRecord,
          { executionId: row._id, reason: 'Execution cancelled by user' },
        );
        cancelled += 1;
      } catch (err) {
        console.warn(
          `[sandbox.cancelExecutionsForThread] cancelExecutionRecord(${row._id}) failed:`,
          err,
        );
      }
    }
    return cancelled;
  },
});
