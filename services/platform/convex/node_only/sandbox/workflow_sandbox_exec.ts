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
 * NOTE: `runSandboxScript` is implemented (pack:// resolution + input staging +
 * `executeCode` reuse). `runSandboxAgent` — the full ephemeral session
 * orchestration mirroring `run_external_agent` (create → inject → run → harvest
 * `output/summary.md` → teardown) — is the next implementation increment and is
 * gated on live e2e verification; until then it returns a structured
 * `status: 'pending'` result so the step type stays end-to-end dispatchable and
 * type-safe.
 */
import { readFile } from 'node:fs/promises';

import { type Infer, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import { toId } from '../../lib/type_cast_helpers';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { resolveSkillAssetPathChecked } from '../../skills/file_utils';

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

// Explicit handler return type — breaks the circular `internal` type inference
// that would otherwise degrade the generated api types to `any` (this module is
// part of `internal` AND calls `internal.*.executeCode`).
type SandboxRunResult = Infer<typeof sandboxRunResultValidator>;

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
  handler: async (ctx, args): Promise<SandboxRunResult> => {
    const fail = (error: string): SandboxRunResult => ({
      mode: 'script',
      ok: false,
      status: 'failed',
      outputFileIds: [],
      error,
    });

    const storeAsUrl = async (content: string): Promise<string> => {
      const storageId = await ctx.storage.store(new Blob([content]));
      const raw = await ctx.storage.getUrl(storageId);
      if (!raw) throw new Error('failed to mint storage url');
      return toSandboxStorageUrl(raw);
    };

    try {
      // Resolve the frozen pack:// script to its bundled content.
      const PREFIX = 'pack://';
      if (!args.script.startsWith(PREFIX)) {
        return fail(`script must be a pack:// reference, got "${args.script}"`);
      }
      const rest = args.script.slice(PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return fail(`invalid pack:// reference "${args.script}"`);
      const packSlug = rest.slice(0, slash);
      const relPath = rest.slice(slash + 1);
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const scriptPath = await resolveSkillAssetPathChecked(
        orgSlug,
        packSlug,
        relPath,
      );
      const scriptContent = await readFile(scriptPath, 'utf8');
      const scriptName = relPath.split('/').pop() ?? 'script';

      // Stage the script + inline-content inputs as code files; fileId inputs as
      // workspace uploads. (folderId staging is a later increment.)
      const files: Array<{ path: string; url: string }> = [
        { path: scriptName, url: await storeAsUrl(scriptContent) },
      ];
      const userUploadDownloads: Array<{ name: string; url: string }> = [];
      for (const input of args.inputs) {
        if ('content' in input.from) {
          files.push({
            path: input.as,
            url: await storeAsUrl(input.from.content),
          });
        } else if ('fileId' in input.from) {
          const raw = await ctx.storage.getUrl(
            toId<'_storage'>(input.from.fileId),
          );
          if (!raw) return fail(`input file not found: ${input.from.fileId}`);
          userUploadDownloads.push({
            name: input.as,
            url: toSandboxStorageUrl(raw),
          });
        } else {
          return fail('folderId input staging is not yet supported');
        }
      }
      if (args.params) {
        files.push({
          path: 'params.json',
          url: await storeAsUrl(JSON.stringify(args.params)),
        });
      }

      const res = await ctx.runAction(
        internal.node_only.sandbox.internal_actions.executeCode,
        {
          organizationId: args.organizationId,
          uploadedBy: 'workflow',
          threadId: args.executionId,
          language: args.language,
          files,
          ...(userUploadDownloads.length > 0 && { userUploadDownloads }),
          entryPath: scriptName,
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
          purpose: `sandbox step ${args.stepSlug}`,
        },
      );

      // Read the small structured verdict (result.json) back into `result`.
      let result: unknown;
      const resultFileName = args.output?.resultFile ?? 'result.json';
      const resultFile = res.files.find((f) => f.path.endsWith(resultFileName));
      if (resultFile) {
        const blob = await ctx.storage.get(resultFile.storageId);
        if (blob) {
          try {
            result = JSON.parse(await blob.text());
          } catch (e) {
            console.warn('[sandbox] result.json parse failed', e);
          }
        }
      }

      return {
        mode: 'script' as const,
        ok: res.success,
        status: res.status,
        ...(result !== undefined && { result }),
        outputFileIds: res.files.map((f) => f.storageId as string),
        ...(res.exitCode !== null && { exitCode: res.exitCode }),
        stdoutPreview: res.stdoutPreview,
        stderrPreview: res.stderrPreview,
        durationMs: res.durationMs,
        ...(res.errorMessage !== undefined && { error: res.errorMessage }),
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
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
  handler: async (_ctx, _args): Promise<SandboxRunResult> => {
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
