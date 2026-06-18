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
 * Both modes are implemented: `runSandboxScript` (pack:// resolution + input
 * staging + `executeCode` reuse) and `runSandboxAgent` (the full ephemeral
 * session orchestration mirroring `run_external_agent`: create → provision →
 * inject creds/VK → run autonomous → harvest `output/summary.md` → teardown).
 * Behavioral correctness of the agent path is gated on live e2e verification
 * (real sandbox + Bifrost); the type/dispatch surface is exercised by units.
 */
import { readFile } from 'node:fs/promises';

import { type Infer, v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { type ActionCtx, internalAction } from '../../_generated/server';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
import { resolveAppAssetPathChecked } from '../../apps/file_utils';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import { toId } from '../../lib/type_cast_helpers';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import {
  sessionIdForWorkflowRun,
  workflowRunOwnerId,
} from '../../sandbox/session_naming';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRoutingFromRef,
  revokeVirtualKey,
} from './bifrost_admin';
import {
  type SessionStageFile,
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionEnvPatch,
  sessionListFiles,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';
import { stageIntegrationSkills } from './integration_skills';
import { runAgentInSessionImpl } from './run_agent';

// Mirrors run_external_agent: the gateway + integration-dispatch base URLs the
// in-sandbox agent reaches over the sandbox network, and the Tier-2 grants that
// can be brokered into the container env (gated per-run by the agent's bindings).
const EXTERNAL_AGENT_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://bifrost:8080';
const INTEGRATIONS_BASE_URL = (
  process.env.EXTERNAL_AGENT_INTEGRATIONS_URL || 'http://convex:3211'
).replace(/\/$/, '');
const BROKERABLE_GRANTS = ['github'];

// Global handoff contract (plan §3c): every ephemeral agent run is prompt-forced
// to finish by writing output/summary.md — the only artifact that survives the
// teardown, so it is the legible agent→agent / agent→human handoff.
const SUMMARY_MANDATE = [
  'MANDATORY HANDOFF: before you finish, write a file at output/summary.md that',
  'explains (1) what you did, (2) every file you produced — path + purpose,',
  '(3) the result/state, and (4) what is next. If you produced NO files, the',
  'summary MUST say so explicitly and why. This file is the ONLY thing that',
  'survives after this run; it is your handoff to the next agent or to a human.',
].join('\n');

// Grace added to the step's wall-clock budget for the session's hard TTL +
// idle timeout, so the SPAWNER reaps the container shortly after the budget
// elapses even if the platform-side `finally` teardown is skipped (a hard
// action kill). The container-side backstop; the opportunistic reap below
// closes the platform row + VK.
const EPHEMERAL_TTL_GRACE_MS = 5 * 60 * 1000;

/**
 * Opportunistic backstop (plan §3d): reap this org's leaked `workflow_run`
 * sessions whose bounded TTL elapsed — the rare hard-kill that skipped the
 * happy-path `finally`. Triggered by the next `sandbox`-step run (no cron —
 * mirrors `reconcileOrgSessions`' page-mount precedent). Best-effort and
 * bounded; a transient failure just leaves the row for the next run to retry.
 */
async function reapStaleWorkflowRunSessions(
  ctx: ActionCtx,
  organizationId: string,
): Promise<void> {
  const stale = await ctx.runQuery(
    internal.sandbox.session_queries.listStaleWorkflowRunSessions,
    { organizationId, limit: 10 },
  );
  for (const { sessionId } of stale) {
    try {
      await sessionDestroy(sessionId);
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] destroy failed:', e);
    }
    try {
      const { bifrostKeyIds } = await ctx.runMutation(
        internal.sandbox.session_mutations.revokeTokensForSession,
        { sessionId },
      );
      for (const keyId of bifrostKeyIds) {
        await revokeVirtualKey(keyId).catch((e) =>
          console.warn('[reapStaleWorkflowRunSessions] VK revoke failed:', e),
        );
      }
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] token revoke failed:', e);
    }
    try {
      await ctx.runMutation(
        internal.sandbox.session_mutations.markSessionRowDestroyed,
        { organizationId, sessionId },
      );
      await ctx.runMutation(
        internal.sandbox.session_mutations.deleteOpsForSession,
        { sessionId },
      );
    } catch (e) {
      console.warn('[reapStaleWorkflowRunSessions] row cleanup failed:', e);
    }
  }
}

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
      // An explicit content-type is REQUIRED: a typeless Blob makes
      // ctx.storage.store send an empty Content-Type header, which the storage
      // backend rejects ("BadHeader: invalid HTTP header"). text/plain is the
      // safe default — the sandbox stages these as plain workspace files.
      const storageId = await ctx.storage.store(
        new Blob([content], { type: 'text/plain' }),
      );
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
      // `pack://<app>/<path>` resolves against the APP bundle (apps/<app>/...).
      const appSlug = rest.slice(0, slash);
      const relPath = rest.slice(slash + 1);
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const scriptPath = await resolveAppAssetPathChecked(
        orgSlug,
        appSlug,
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
  handler: async (ctx, args): Promise<SandboxRunResult> => {
    const fail = (error: string): SandboxRunResult => ({
      mode: 'agent',
      ok: false,
      status: 'failed',
      outputFileIds: [],
      error,
    });

    // Resolve the org agent config (adapter kind, model, auth posture,
    // integration grants) — the slug names an org-chart agent, not the CLI
    // adapter that runAgentInSessionImpl wants.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const [delegate] = await loadDelegateAgents(
      ctx,
      [args.agentSlug],
      args.organizationId,
      orgSlug,
    );
    if (!delegate) {
      return fail(`agent "${args.agentSlug}" not found or misconfigured`);
    }
    const agentConfig = delegate.agentConfig;
    const agentKind = agentConfig.agentKind ?? 'claude-code';
    const byo = agentConfig.authMode === 'byo';
    const modelRef = args.model ?? delegate.model;
    const integrationBindings = agentConfig.integrationBindings ?? [];
    const brokerGrants = BROKERABLE_GRANTS.filter((g) =>
      integrationBindings.includes(g),
    );

    const sessionId = sessionIdForWorkflowRun(args.executionId, args.stepSlug);
    const execId = `${args.executionId}-${args.stepSlug}`;
    const startedAt = Date.now();
    // Bound the container's life to the step budget + grace so the spawner
    // reaps it even if the platform-side teardown is skipped (hard kill).
    const ttlMs = args.budget.maxWallClockMs + EPHEMERAL_TTL_GRACE_MS;

    let rowId: Id<'sandboxSessions'> | null = null;
    let mintedKeyId: string | null = null;

    try {
      // 0. Opportunistic backstop: reap this org's leaked workflow_run sessions
      // (TTL elapsed, finally skipped) before adding our own. Best-effort.
      try {
        await reapStaleWorkflowRunSessions(ctx, args.organizationId);
      } catch (reapErr) {
        console.warn('[runSandboxAgent] stale-session reap failed:', reapErr);
      }

      // 1. Create the ephemeral agent session (deterministic id → a step retry
      // reaps the orphan rather than duplicating).
      rowId = await ctx.runMutation(
        internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
        {
          organizationId: args.organizationId,
          sessionId,
          profile: 'agent',
          ownerType: 'workflow_run',
          ownerId: workflowRunOwnerId(args.executionId, args.stepSlug),
          createdBy: 'system',
          agentKind,
        },
      );
      try {
        try {
          await sessionCreate({
            sessionId,
            organizationId: args.organizationId,
            profile: 'agent',
            ttlMs,
            idleTimeoutMs: ttlMs,
          });
        } catch (createErr) {
          // A deterministic-id collision can only be an orphan (platform-side
          // creation is serialized by the reserve) — reap and retry once.
          if (!(createErr instanceof SessionDuplicateError)) throw createErr;
          await sessionDestroy(sessionId);
          await sessionCreate({
            sessionId,
            organizationId: args.organizationId,
            profile: 'agent',
            ttlMs,
            idleTimeoutMs: ttlMs,
          });
        }
      } catch (createErr) {
        await ctx.runMutation(
          internal.sandbox.session_mutations.setSessionStatus,
          { rowId, status: 'failed' },
        );
        rowId = null; // already terminal — skip the finally status flip
        throw createErr;
      }
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'active', lastActivityAt: Date.now() },
      );

      // 2. Provider provisioning + gateway auth-hardening (managed only) so the
      // mint below binds the VK to the org's upstream key. Provisioning is
      // best-effort (the mint fails closed if no key); auth-hardening is not.
      let gatewayToken: string | null = null;
      if (!byo) {
        try {
          const gatewayProviders = await loadOrgGatewayProviders(
            ctx,
            args.organizationId,
          );
          if (gatewayProviders.length > 0) {
            await provisionProviders(args.organizationId, gatewayProviders);
          }
        } catch (provisionErr) {
          console.warn(
            '[runSandboxAgent] provisioning failed (mint fails closed):',
            provisionErr,
          );
        }
        await applyGatewayConfig();
      }

      // 3. Inject Tier-2 broker credentials (e.g. GITHUB_TOKEN) for bound
      // integrations so the agent can self-fetch code — never persisted.
      try {
        const creds = await ctx.runAction(
          internal.node_only.sandbox.session_credentials
            .resolveSessionCredentials,
          {
            organizationId: args.organizationId,
            sessionId,
            grants: brokerGrants,
            kind: 'bootstrap',
          },
        );
        if (Object.keys(creds.env).length > 0) {
          const denied = await sessionEnvPatch(sessionId, { set: creds.env });
          if (denied.length > 0) {
            console.warn('[runSandboxAgent] env names denied:', denied);
          }
        }
      } catch (credErr) {
        console.warn(
          '[runSandboxAgent] credential injection failed (continuing):',
          credErr,
        );
      }

      // 4. Stage the agent's bound integration skills (best-effort).
      try {
        await stageIntegrationSkills(ctx, {
          organizationId: args.organizationId,
          sessionId,
        });
      } catch (skillErr) {
        console.warn(
          '[runSandboxAgent] integration skill staging failed (continuing):',
          skillErr,
        );
      }

      // 5. Stage declared inputs into the workspace (folderId is a later
      // increment; the primary agent path self-fetches via GITHUB_TOKEN).
      const stageFiles: SessionStageFile[] = [];
      for (const input of args.inputs) {
        if ('content' in input.from) {
          stageFiles.push({
            path: input.as,
            contentBase64: Buffer.from(input.from.content).toString('base64'),
          });
        } else if ('fileId' in input.from) {
          const raw = await ctx.storage.getUrl(
            toId<'_storage'>(input.from.fileId),
          );
          if (!raw) return fail(`input file not found: ${input.from.fileId}`);
          stageFiles.push({ path: input.as, url: toSandboxStorageUrl(raw) });
        } else {
          return fail('folderId input staging is not yet supported');
        }
      }
      if (stageFiles.length > 0) {
        const staged = await sessionStageFiles(sessionId, stageFiles);
        if (staged.skipped.length > 0) {
          console.warn('[runSandboxAgent] inputs skipped:', staged.skipped);
        }
      }

      // 6. Mint a per-run, budget+model-scoped virtual key (managed only). The
      // step config's budget bounds the key directly (no org-rolling-remaining
      // accounting — the workflow owns the budget for this run).
      if (!byo) {
        const vk = await mintVirtualKey({
          budgetCents: args.budget.maxCents,
          allowedModels: [modelRef],
          organizationId: args.organizationId,
          sessionId,
        });
        mintedKeyId = vk.keyId;
        gatewayToken = vk.key;
        await ctx.runMutation(
          internal.sandbox.session_mutations.insertSessionToken,
          {
            organizationId: args.organizationId,
            sessionId,
            tokenHash: hashVirtualKey(vk.key),
            bifrostKeyId: vk.keyId,
            scope: {
              agentKind,
              allowedModels: [modelRef],
              integrationGrants: brokerGrants,
              budgetCents: args.budget.maxCents,
            },
            expiresAt: startedAt + args.budget.maxWallClockMs,
          },
        );
      }

      // 7. Run the agent autonomously (no human in the loop, no steering).
      const prompt =
        args.instructions ??
        (agentConfig.instructions || 'Complete the assigned task.');
      const systemPromptAppend = [agentConfig.instructions, SUMMARY_MANDATE]
        .filter((s): s is string => Boolean(s))
        .join('\n\n');
      const useModel =
        modelRef && modelRef !== 'default'
          ? byo
            ? modelRef
            : resolveGatewayRoutingFromRef(modelRef).gatewayModel
          : undefined;
      const result = await runAgentInSessionImpl(ctx, {
        organizationId: args.organizationId,
        sessionId,
        execId,
        agentSlug: agentKind,
        prompt,
        ...(useModel !== undefined && { model: useModel }),
        authMode: byo ? 'byo' : 'managed',
        interactionMode: 'autonomous',
        systemPromptAppend,
        ...(args.budget.maxTurns !== undefined && {
          maxTurns: args.budget.maxTurns,
        }),
        ...(!byo &&
          gatewayToken !== null && {
            gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
            gatewayToken,
            integrationsBaseUrl: `${INTEGRATIONS_BASE_URL}/api/integrations`,
          }),
        timeoutMs: args.budget.maxWallClockMs,
      });

      // 8. Harvest output: store every file under the collect dir to _storage
      // and read the mandated output/summary.md handoff.
      const collectDir = args.output?.collectDir ?? 'output';
      const outputFileIds: string[] = [];
      let summary: string | undefined;
      try {
        const entries = await sessionListFiles(sessionId, collectDir);
        for (const entry of entries ?? []) {
          if (entry.type !== 'file') continue;
          const file = await sessionReadFile(
            sessionId,
            `${collectDir}/${entry.name}`,
          );
          if (!file) continue;
          const storageId = await ctx.storage.store(
            new Blob([file.bytes], { type: file.contentType }),
          );
          outputFileIds.push(storageId);
          if (entry.name === 'summary.md') {
            summary = new TextDecoder().decode(file.bytes);
          }
        }
      } catch (harvestErr) {
        console.warn('[runSandboxAgent] output harvest failed:', harvestErr);
      }
      // Synthesize a minimal handoff if the agent omitted the mandated file, so
      // "mandatory" never discards an otherwise-good run on a technicality.
      if (summary === undefined) {
        summary = result.finalText
          ? `(synthesized — agent did not write output/summary.md)\n\n${result.finalText}`
          : '(synthesized) The agent produced no output/summary.md and no final text.';
      }

      const ok =
        result.status === 'completed' &&
        (result.exitCode === 0 || result.exitCode === null);
      return {
        mode: 'agent',
        ok,
        status: result.status,
        summary,
        outputFileIds,
        ...(result.exitCode !== null && { exitCode: result.exitCode }),
        ...(result.finalText !== undefined && {
          stdoutPreview: result.finalText.slice(0, 2000),
        }),
        durationMs: Date.now() - startedAt,
        ...(!ok && { error: `agent run ${result.status}` }),
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    } finally {
      // Teardown ALWAYS: destroy the ephemeral session + revoke the VK so
      // nothing outlives the step (outputs were already harvested to _storage).
      // Each leg is independent best-effort so one failure can't mask the rest.
      try {
        await sessionDestroy(sessionId);
      } catch (e) {
        console.warn('[runSandboxAgent] session destroy failed:', e);
      }
      if (mintedKeyId) {
        try {
          await revokeVirtualKey(mintedKeyId);
        } catch (e) {
          console.warn('[runSandboxAgent] VK revoke failed:', e);
        }
      }
      if (rowId) {
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.setSessionStatus,
            { rowId, status: 'destroyed' },
          );
        } catch (e) {
          console.warn('[runSandboxAgent] row status update failed:', e);
        }
      }
    }
  },
});
