import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';

import {
  AUTOMATION_SUBJECT_ID,
  EMBEDDING_SLUG,
} from '../../../lib/shared/constants/usage.ts';
import {
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl,
} from '../../core/node_only/sandbox/workspace_tools_bridge.ts';
import {
  readTurnOpRef,
  type TurnOpRef,
} from '../../core/sandbox/tool_names.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import type { DirectCallSubject } from '../governance/direct-calls.ts';
import { deferredEmbeddingMeter } from '../knowledge/embedding-meter.ts';
import { sandboxDoorBodyLimit, toolResultTooLarge } from './door-body-limit.ts';
import { resolveSessionOpAttribution } from './op-attribution.ts';
import { servingPlatform } from './serving-platform.ts';
import { getSessionTokenByHash } from './sessions.ts';
import { sandboxToolShimHandlers } from './shim.ts';

/**
 * The in-sandbox WORKSPACE-TOOL dispatch surface —
 * `POST /api/tools/{execute,status}` — the 0.5 twin of
 * `convex/sandbox/tools_http.ts`, with the SAME contract the baked
 * `tale-connectors-mcp` bridge speaks: `{tool, args}` in, a structured JSON
 * status body out (only an auth failure answers non-2xx, because the body
 * is relayed verbatim to the model as tool-result text).
 *
 * Auth: `Authorization: Bearer <session VK>` → sha256 → the session-token
 * row; the org, user, grant set and task run come FROM THAT ROW, never the
 * body — a container cannot spoof another org, widen its grants, or claim
 * another thread, user or run. The body itself is capped before it is read (the 413 is the
 * one other non-2xx; see door-body-limit.ts). The dispatch itself is the
 * REUSED bridge running on the ctx shim. `/status` lists the token's grants
 * and the release version this backend's build is labelled with (`platform`,
 * see serving-platform.ts).
 */

const BEARER_PREFIX = 'Bearer ';

interface DispatchAuth {
  organizationId: string;
  sessionId: string;
  toolGrants: string[];
  userId?: string;
  mintedKeyId?: string;
  /** A task turn's run, named by its exec. */
  taskRunExecId?: string;
  /** The turn the token serves (`scope.turnOp`), when it records one. */
  turn?: TurnOpRef;
}

async function authSessionToken(
  sql: Sql,
  request: Request,
): Promise<DispatchAuth | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = await getSessionTokenByHash(sql, tokenHash);
  if (row === null) return null;
  const turn = readTurnOpRef(row.scope.turnOp);
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    toolGrants: row.scope.toolGrants ?? [],
    ...(row.scope.userId !== undefined ? { userId: row.scope.userId } : {}),
    ...(row.llmGatewayKeyId !== null
      ? { mintedKeyId: row.llmGatewayKeyId }
      : {}),
    ...(row.scope.taskRun !== undefined
      ? { taskRunExecId: row.scope.taskRun.execId }
      : {}),
    ...(turn !== undefined ? { turn } : {}),
  };
}

/**
 * Whose spend an agent's knowledge search is: the turn's own subject — its
 * run's person (or nobody, for a run a trigger started), the key that
 * started it and the projects it is in — read off the turn the token names,
 * else the session's latest turn; the token's user when no turn is known.
 */
async function searchSubjectOf(
  sql: Sql,
  auth: {
    organizationId: string;
    sessionId: string;
    userId?: string;
    turn?: TurnOpRef;
  },
): Promise<DirectCallSubject> {
  let turn: { kind: string; execId: string } | undefined = auth.turn;
  if (turn === undefined) {
    const latest = await sql<{ kind: string; execId: string }[]>`
      SELECT kind, exec_id AS "execId" FROM app.sandbox_session_ops
      WHERE org_id = ${auth.organizationId} AND session_id = ${auth.sessionId}
        AND kind IN ('task-agent', 'workflow-agent')
      ORDER BY started_at_ms DESC
      LIMIT 1
    `;
    turn = latest[0];
  }
  const attribution =
    turn !== undefined
      ? await resolveSessionOpAttribution(sql, {
          organizationId: auth.organizationId,
          sessionId: auth.sessionId,
          execId: turn.execId,
          kind: turn.kind,
        })
      : null;
  return {
    userId: attribution?.userId ?? auth.userId ?? AUTOMATION_SUBJECT_ID,
    agentSlug: EMBEDDING_SLUG,
    ...(attribution?.apiKeyId !== undefined
      ? { apiKeyId: attribution.apiKeyId }
      : {}),
    ...(attribution?.projectIds !== undefined
      ? { projectIds: attribution.projectIds }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createToolDispatchRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();
  app.use('*', sandboxDoorBodyLimit(toolResultTooLarge));

  app.post('/execute', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return c.json({ status: 'error', message: 'Unauthorized.' }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        status: 'invalid_args',
        message: 'The request body must be JSON: {tool, args}.',
      });
    }
    const tool =
      isRecord(body) && typeof body.tool === 'string' ? body.tool : '';
    const callArgs = isRecord(body) && isRecord(body.args) ? body.args : {};
    if (tool === '') {
      return c.json({
        status: 'invalid_args',
        message: 'A "tool" name is required.',
      });
    }
    if (!auth.toolGrants.includes(tool)) {
      return c.json({
        status: 'unavailable',
        blockers: [
          {
            code: 'not_granted',
            guidance:
              `The workspace tool "${tool}" is not granted to this agent. ` +
              'Call workspace_status to see what is available.',
          },
        ],
      });
    }
    const shim = createCtxShim(sandboxToolShimHandlers(deps.sql));
    const result = await dispatchWorkspaceToolImpl(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 bridge; every ctx facility it touches is covered by sandboxToolShimHandlers
      shim as unknown as Parameters<typeof dispatchWorkspaceToolImpl>[0],
      {
        organizationId: auth.organizationId,
        sessionId: auth.sessionId,
        ...(auth.userId !== undefined ? { userId: auth.userId } : {}),
        ...(auth.mintedKeyId !== undefined
          ? { mintedKeyId: auth.mintedKeyId }
          : {}),
        ...(auth.taskRunExecId !== undefined
          ? { taskRunExecId: auth.taskRunExecId }
          : {}),
        ...(auth.turn !== undefined ? { turn: auth.turn } : {}),
        // A knowledge search's query embedding is the turn's spend.
        embeddingMeter: deferredEmbeddingMeter(deps.sql, {
          organizationId: auth.organizationId,
          subject: () => searchSubjectOf(deps.sql, auth),
        }),
        tool,
        callArgs,
      },
    );
    return c.json(result);
  });

  app.post('/status', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return c.json({ status: 'error', message: 'Unauthorized.' }, 401);
    }
    // Both halves are the server's own — the grants from the token row, the
    // version from this process's build stamp. Nothing but the bearer token
    // is read from the request.
    return c.json({
      ...workspaceToolStatusImpl(auth.toolGrants),
      platform: servingPlatform(),
    });
  });

  return app;
}
