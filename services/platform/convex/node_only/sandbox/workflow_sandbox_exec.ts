'use node';

/**
 * Sandbox-step execution backends (node runtime).
 *
 * Two modes behind one contract — both NEVER throw; failures are encoded in the
 * returned `{ ok, status, error }` so the workflow branches via a following
 * condition step (same convention as the `agent` action):
 *
 *  - runSandboxScript: deterministic frozen-script run. Reuses the existing
 *    `executeCode` spawner path (no hot-path refactor); the workflow
 *    `executionId` is passed as the thread key.
 *  - runSandboxAgent: ephemeral Claude-Code run — create → inject creds/VK →
 *    run → harvest (incl. the mandatory `output/summary.md` handoff) → teardown,
 *    mirroring the `run_external_agent` orchestration with
 *    `ownerType: 'workflow_run'`.
 *
 * NOTE: the behavioral bodies (pack:// script resolution + input staging for the
 * deterministic mode, and the full ephemeral session orchestration for the agent
 * mode) are the next implementation increment; they require the pack-reader
 * (Phase 5) and faithful mirroring of run_external_agent respectively, and are
 * gated on live e2e verification. Until then both return a structured
 * `status: 'pending'` result so the step type is end-to-end dispatchable and
 * type-safe.
 */
import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';

const inputArgValidator = v.array(
  v.object({
    as: v.string(),
    from: v.union(
      v.object({ fileId: v.string() }),
      v.object({ folderId: v.string() }),
      v.object({ content: v.string() }),
    ),
  }),
);

const outputArgValidator = v.optional(
  v.object({
    collectDir: v.optional(v.string()),
    resultFile: v.optional(v.string()),
  }),
);

/** Unified sandbox-step result. Big data stays as file ids; result is small. */
export const sandboxRunResultValidator = v.object({
  mode: v.union(v.literal('agent'), v.literal('script')),
  ok: v.boolean(),
  status: v.string(),
  result: v.optional(v.any()),
  /** Parsed `output/summary.md` (agent runs) — the legible handoff. */
  summary: v.optional(v.string()),
  outputFileIds: v.array(v.string()),
  outputFolderId: v.optional(v.string()),
  transcriptFileId: v.optional(v.string()),
  exitCode: v.optional(v.number()),
  stdoutPreview: v.optional(v.string()),
  stderrPreview: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  error: v.optional(v.string()),
});

export const runSandboxScript = internalAction({
  args: {
    organizationId: v.string(),
    executionId: v.string(),
    stepSlug: v.string(),
    script: v.string(),
    language: v.union(
      v.literal('python'),
      v.literal('node'),
      v.literal('bash'),
    ),
    params: v.optional(v.record(v.string(), v.any())),
    inputs: inputArgValidator,
    output: outputArgValidator,
    timeoutMs: v.optional(v.number()),
  },
  returns: sandboxRunResultValidator,
  handler: async (_ctx, _args) => {
    // TODO(phase-3b): resolve pack:// script + stage inputs, reuse executeCode,
    // map storageIds -> outputFileIds, read output/result.json into `result`.
    return {
      mode: 'script' as const,
      ok: false,
      status: 'pending',
      outputFileIds: [],
      error:
        'deterministic sandbox run not yet wired (pending pack resolution)',
    };
  },
});

export const runSandboxAgent = internalAction({
  args: {
    organizationId: v.string(),
    executionId: v.string(),
    stepSlug: v.string(),
    agentSlug: v.string(),
    instructions: v.optional(v.string()),
    budget: v.object({
      maxCents: v.number(),
      maxWallClockMs: v.number(),
      maxTurns: v.optional(v.number()),
    }),
    model: v.optional(v.string()),
    inputs: inputArgValidator,
    output: outputArgValidator,
  },
  returns: sandboxRunResultValidator,
  handler: async (_ctx, _args) => {
    // TODO(phase-3c): ephemeral session create -> inject creds/VK -> run agent
    // (interactionMode 'autonomous') -> harvest outputs + output/summary.md
    // (synthesize fallback) -> teardown (sessionDestroy + revokeVirtualKey).
    return {
      mode: 'agent' as const,
      ok: false,
      status: 'pending',
      outputFileIds: [],
      error: 'ephemeral agent sandbox run not yet wired',
    };
  },
});
