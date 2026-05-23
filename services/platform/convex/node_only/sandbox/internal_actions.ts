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
import {
  SANDBOX_CODE_PREVIEW_MAX,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
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

// Aggregate-size cap for pre-staging the artifact's previous run outputs
// into the next container's `/workspace/output/`. Above this we skip the
// pre-stage entirely and surface a single stderr line so the user sees
// why — masking would be worse than failing fast on huge artifacts.
// 10 MiB matches the order-of-magnitude of a typical pptx / pdf so the
// flow covers the common case without unbounded storage I/O per run.
const MAX_PRIOR_OUTPUT_BYTES = 10 * 1024 * 1024;

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
  // Roll back any _storage blobs we already wrote so we don't orphan them.
  for (const sid of fc.uploadedStorageIds) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- delete needs Id<'_storage'>
      await fc.ctx.storage.delete(sid as unknown as Id<'_storage'>);
    } catch (err) {
      console.warn(
        `[sandbox.failExecution] storage.delete(${sid}) failed:`,
        err,
      );
    }
  }
  fc.uploadedStorageIds.clear();

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
     * Pre-stage source override. Default behaviour ("latest succeeded
     * run") applies when omitted or when `fromRun === 'latest'`. Pass a
     * specific `artifactRuns` row id to pin pre-staging to that run.
     */
    inputs: v.optional(
      v.object({
        fromRun: v.string(),
      }),
    ),
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
      }),
    ),
    steps: v.optional(v.array(sandboxStepResultValidator)),
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
    // If this is an artifact-bound run AND the artifact has output files
    // from a previous run, copy them into the next container's
    // /workspace/output/ so a follow-up `artifact_run` (e.g. validate
    // after generate, in separate calls) doesn't dead-end on
    // FileNotFoundError. `steps: [...]` is still the canonical idiom; this
    // is the backstop when the LLM forgets.
    let priorOutputFiles: Array<{ name: string; contentBase64: string }> = [];
    let priorOutputSkippedNote: string | undefined;
    if (args.artifactId !== undefined) {
      try {
        // Reads from the new `artifactRuns` / `artifactRunFiles` tables
        // first; falls back to the deprecated `artifacts.runOutputFiles`
        // field for artifacts not yet covered by the backfill (per the
        // migration plan in llm-majestic-hamming.md).
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
        if (totalBytes > MAX_PRIOR_OUTPUT_BYTES) {
          priorOutputSkippedNote = `[tale-sandbox] prior outputs ${totalBytes} bytes exceed ${MAX_PRIOR_OUTPUT_BYTES} cap; not pre-staging\n`;
        } else {
          const skipped: string[] = [];
          for (const file of candidates) {
            const blob = await ctx.storage.get(file.storageId);
            if (blob === null) {
              skipped.push(file.name);
              continue;
            }
            const buf = Buffer.from(await blob.arrayBuffer());
            priorOutputFiles.push({
              name: file.name,
              contentBase64: buf.toString('base64'),
            });
          }
          if (skipped.length > 0) {
            priorOutputSkippedNote = `[tale-sandbox] prior-output blobs missing in storage, skipped: ${skipped.join(', ')}\n`;
          }
        }
      } catch (err) {
        // Pre-staging is best-effort — never block the run on a load
        // failure. Surface a one-liner so users notice the regression in
        // CI but the script still gets its chance.
        console.warn(
          '[sandbox.executeCode] prior-output pre-stage failed:',
          err,
        );
        priorOutputFiles = [];
        priorOutputSkippedNote = `[tale-sandbox] prior-output pre-stage failed: ${err instanceof Error ? err.message : String(err)}\n`;
      }
    }
    if (priorOutputSkippedNote !== undefined && onStderrTail !== undefined) {
      // Route the note through the live-tail channel so it lands in the
      // canvas stderr panel alongside the script's own output.
      onStderrTail(priorOutputSkippedNote);
    }

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
          ...(priorOutputFiles.length > 0 && { priorOutputFiles }),
          timeoutMs,
          // Hardcoded sandbox-safety: pip --only-binary=:all: + npm
          // --ignore-scripts are ALWAYS in force. The LLM cannot disable
          // them via tool input (round-2 R2-B4).
          options: { allowSdist: false, allowInstallScripts: false },
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

      // ---- file upload (all-or-nothing) ----
      // Each ctx.storage.store can take seconds for multi-MB blobs; an
      // explicit heartbeat between uploads keeps `heartbeatAt` fresh so the
      // watchdog doesn't reap this row mid-upload (audit finding R2-B6 #3).
      const stagedForInsert: Array<{
        name: string;
        storageId: Id<'_storage'>;
        size: number;
        contentType: string;
      }> = [];
      for (const f of spawnerResult.outputFiles) {
        await tickHeartbeat();
        try {
          const bytes = Buffer.from(f.contentBase64, 'base64');
          const blob = new Blob([bytes], { type: f.contentType });
          const storageId = await ctx.storage.store(blob);
          uploadedStorageIds.add(String(storageId));
          stagedForInsert.push({
            name: f.name,
            storageId,
            size: f.size,
            contentType: f.contentType,
          });
        } catch (err) {
          return failExecution(
            fc,
            'failed',
            'SPAWNER_UNAVAILABLE',
            `Output upload failed: ${err instanceof Error ? err.message : String(err)}`,
            {
              stdoutPreview: spawnerResult.stdoutBase64
                ? Buffer.from(spawnerResult.stdoutBase64, 'base64')
                    .toString('utf8')
                    .slice(0, SANDBOX_STDOUT_PREVIEW_MAX)
                : '',
              stderrPreview: spawnerResult.stderrBase64
                ? Buffer.from(spawnerResult.stderrBase64, 'base64')
                    .toString('utf8')
                    .slice(0, SANDBOX_STDERR_PREVIEW_MAX)
                : '',
            },
          );
        }
      }

      const insertedFiles = await ctx.runMutation(
        internal.sandbox.output_mutations.insertOutputFiles,
        {
          organizationId: args.organizationId,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          uploadedBy: args.uploadedBy,
          files: stagedForInsert,
        },
      );

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
        })),
        truncated: spawnerResult.truncated,
        durationMs,
        actualSeconds,
        ...(spawnerResult.steps !== undefined && {
          steps: spawnerResult.steps,
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
