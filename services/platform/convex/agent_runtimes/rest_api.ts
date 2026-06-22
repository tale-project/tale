/**
 * REST surface for the `tale-daemon` external runtimes.
 *
 *   POST /api/v1/runtimes/register   {daemonId, name?, adapters[], workspaceKeys?}
 *   POST /api/v1/runtimes/heartbeat  {daemonId}                  → {cancel[]}
 *   POST /api/v1/runs/claim          {daemonId, adapterTypes[]}  → {run|null, retryAfterMs}
 *   POST /api/v1/runs/{id}/events    {daemonId, type, message?}  → {cancelRequested}
 *   POST /api/v1/runs/{id}/complete  {daemonId, summary, diffStat?, sessionRef?, usage?}
 *   POST /api/v1/runs/{id}/fail      {daemonId, error, retryable?}
 *
 * Auth: Better Auth API key (same `withRestAuth` pipeline as the other
 * /api/v1 surfaces — key → user → org). Org isolation is re-checked inside
 * every mutation, and run endpoints additionally verify the claiming
 * daemonId, so a leaked run id from another tenant is inert. The claim
 * response carries `retryAfterMs` so the server drives the daemon's poll
 * backoff (3s hot → 60s idle).
 */

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  extractPathParts,
  jsonError,
  jsonOk,
  withRestAuth,
} from '../lib/rest/helpers';

const RUNS_PREFIX = '/api/v1/runs/';

/** Server-driven poll pacing: hot when work was handed out, lazy when idle. */
const RETRY_AFTER_HOT_MS = 3_000;
const RETRY_AFTER_IDLE_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch (error) {
    console.warn('[ExternalRuns] malformed JSON body', error);
    return null;
  }
}

function requireString(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export const registerRuntime = withRestAuth(
  'runtime:register',
  async (rc, request) => {
    const body = await readJsonBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);
    const daemonId = requireString(body, 'daemonId');
    if (!daemonId) return jsonError('daemonId is required', 400);
    const adaptersRaw = body.adapters;
    if (!Array.isArray(adaptersRaw) || adaptersRaw.length === 0) {
      return jsonError('adapters[] is required', 400);
    }
    const adapters = adaptersRaw.filter(isRecord).flatMap((adapter) => {
      const adapterType = adapter.adapterType;
      if (typeof adapterType !== 'string' || !adapterType) return [];
      const capabilities = isRecord(adapter.capabilities)
        ? {
            jsonOutput: adapter.capabilities.jsonOutput === true,
            sessionResume: adapter.capabilities.sessionResume === true,
            costReporting: adapter.capabilities.costReporting === true,
            mcp: adapter.capabilities.mcp === true,
          }
        : undefined;
      return [
        {
          adapterType,
          version:
            typeof adapter.version === 'string' ? adapter.version : undefined,
          capabilities,
        },
      ];
    });
    if (adapters.length === 0) {
      return jsonError('adapters[] must contain adapterType entries', 400);
    }
    const workspaceKeys = Array.isArray(body.workspaceKeys)
      ? body.workspaceKeys.filter(
          (key): key is string => typeof key === 'string',
        )
      : undefined;

    const result = await rc.ctx.runMutation(
      internal.agent_runtimes.internal_mutations.registerRuntime,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        daemonId,
        name: optionalString(body, 'name'),
        adapters,
        workspaceKeys,
      },
    );
    return jsonOk(result);
  },
);

export const heartbeatRuntime = withRestAuth(
  'runtime:heartbeat',
  async (rc, request) => {
    const body = await readJsonBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);
    const daemonId = requireString(body, 'daemonId');
    if (!daemonId) return jsonError('daemonId is required', 400);

    const result = await rc.ctx.runMutation(
      internal.agent_runtimes.internal_mutations.heartbeatRuntime,
      { organizationId: rc.org.organizationId, daemonId },
    );
    return jsonOk(result);
  },
);

export const claimRun = withRestAuth('runtime:claim', async (rc, request) => {
  const body = await readJsonBody(request);
  if (!body) return jsonError('Invalid JSON body', 400);
  const daemonId = requireString(body, 'daemonId');
  if (!daemonId) return jsonError('daemonId is required', 400);
  const adapterTypes = Array.isArray(body.adapterTypes)
    ? body.adapterTypes.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (adapterTypes.length === 0) {
    return jsonError('adapterTypes[] is required', 400);
  }

  const run: unknown = await rc.ctx.runMutation(
    internal.external_runs.internal_mutations.claimExternalRun,
    {
      organizationId: rc.org.organizationId,
      daemonId,
      adapterTypes,
    },
  );
  // Resolve + inject the agent's env/secrets at claim time (decrypt-at-run):
  // ciphertext stays at rest in `agentEnv`; the decrypted values ride only this
  // authenticated claim response, and the daemon merges them into the process.
  let claimedRun = run;
  if (isRecord(run) && typeof run.agentSlug === 'string') {
    const { env } = await rc.ctx.runAction(
      internal.agents.agent_env_actions.resolveAgentEnv,
      { organizationId: rc.org.organizationId, agentSlug: run.agentSlug },
    );
    if (Object.keys(env).length > 0) claimedRun = { ...run, env };
  }
  return jsonOk({
    run: claimedRun,
    retryAfterMs: run ? RETRY_AFTER_HOT_MS : RETRY_AFTER_IDLE_MS,
  });
});

/** Brand a daemon-supplied run id; bogus ids fail org/daemon checks server-side. */
function asExternalRunId(value: string): Id<'externalRuns'> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ownership re-checked in the mutation
  return value as Id<'externalRuns'>;
}

/** POST /api/v1/runs/{id}/(events|complete|fail) dispatcher. */
export const runSubActions = withRestAuth(
  'runtime:events',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, RUNS_PREFIX);
    if (!id || !subPath) return jsonError('Unknown runs endpoint', 404);
    const body = await readJsonBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);
    const daemonId = requireString(body, 'daemonId');
    if (!daemonId) return jsonError('daemonId is required', 400);
    const externalRunId = asExternalRunId(id);

    try {
      switch (subPath) {
        case 'events': {
          const type = requireString(body, 'type');
          if (
            type !== 'started' &&
            type !== 'progress' &&
            type !== 'heartbeat'
          ) {
            return jsonError('type must be started|progress|heartbeat', 400);
          }
          const result = await rc.ctx.runMutation(
            internal.external_runs.internal_mutations.recordExternalRunEvent,
            {
              organizationId: rc.org.organizationId,
              daemonId,
              externalRunId,
              eventType: type,
              message: optionalString(body, 'message'),
            },
          );
          return jsonOk(result);
        }
        case 'complete': {
          const summary = requireString(body, 'summary');
          if (!summary) return jsonError('summary is required', 400);
          const usage = isRecord(body.usage) ? body.usage : {};
          const result = await rc.ctx.runMutation(
            internal.external_runs.internal_mutations.completeExternalRun,
            {
              organizationId: rc.org.organizationId,
              daemonId,
              externalRunId,
              summary,
              diffStat: optionalString(body, 'diffStat'),
              sessionRef: optionalString(body, 'sessionRef'),
              inputTokens: optionalNumber(usage, 'inputTokens'),
              outputTokens: optionalNumber(usage, 'outputTokens'),
              costCents: optionalNumber(usage, 'costCents'),
            },
          );
          return result.ok
            ? jsonOk(result)
            : jsonError(result.reason ?? 'complete rejected', 409);
        }
        case 'fail': {
          const error = requireString(body, 'error');
          if (!error) return jsonError('error is required', 400);
          const result = await rc.ctx.runMutation(
            internal.external_runs.internal_mutations.failExternalRun,
            {
              organizationId: rc.org.organizationId,
              daemonId,
              externalRunId,
              error,
              retryable: body.retryable === true,
            },
          );
          return result.ok ? jsonOk(result) : jsonError('fail rejected', 409);
        }
        default:
          return jsonError('Unknown runs endpoint', 404);
      }
    } catch (error) {
      // Malformed ids reach the mutation layer as validator errors.
      if (error instanceof ConvexError) {
        return jsonError('Invalid run id', 400);
      }
      console.error('[ExternalRuns] run sub-action failed', error);
      return jsonError('Internal error', 500);
    }
  },
);
