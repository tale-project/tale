import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { verifyHostcallToken } from '../../../convex/connectors/hostcall_token.ts';
import {
  bridgeConnectorStatusImpl,
  runBridgeConnectorImpl,
} from '../../../convex/node_only/sandbox/connectors_bridge.ts';
import { findConnector } from '../../../lib/connectors/catalog.ts';
import { ConnectorError } from '../../../lib/connectors/errors.ts';
import { createLiveHost } from '../../../lib/connectors/live-host.ts';
import { resolveConnectorCredential } from '../connector_credentials/service.ts';
import { getSessionTokenByHash } from '../sandbox/sessions.ts';
import { runConnectorAction } from './service.ts';

/**
 * The in-sandbox CONNECTORS surface — `POST /api/connectors/{execute,
 * status,hostcall}` — the 0.5 twin of `convex/sandbox/connectors_http.ts`
 * plus `convex/connectors/hostcall_http.ts`.
 *
 * Two different authorities meet here, and neither trusts the body:
 *
 *  - `execute`/`status` authenticate the session VK → the token row, and
 *    take the ORG, the USER and the GRANT SET from that row. A container
 *    cannot name another org, widen its grants, or claim another user.
 *  - `hostcall` authenticates a one-run HMAC capability minted at dispatch,
 *    bound to (org, connector, action, credential). It carries no secret:
 *    the door re-resolves the credential itself, so a leaked token cannot
 *    become a credential.
 *
 * The decision bodies are REUSED from the 0.4 bridge (one wording of every
 * refusal, for the model that relays it); only the dispatch and credential
 * seams differ.
 */

const BEARER_PREFIX = 'Bearer ';

/**
 * The forensic trail for a bridge connector call: who/what/when/outcome
 * plus a sorted param-KEY fingerprint, never the values — the same shape
 * `recordToolCall` writes for in-sandbox tools, and the same ledger, since
 * a connector call IS a tool call from the agent's side. The `connector:`
 * prefix keeps the two readable apart in one query.
 *
 * A logging failure must never fail the call it describes.
 */
async function recordConnectorCall(
  sql: Sql,
  entry: {
    organizationId: string;
    sessionId: string;
    slug: string;
    operation: string;
    userId: string;
    outcome: string;
    callArgs: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await sql`
      INSERT INTO app.sandbox_tool_calls (
        org_id, session_id, tool, user_id, outcome, params_fingerprint,
        created_at_ms
      ) VALUES (
        ${entry.organizationId}, ${entry.sessionId},
        ${`connector:${entry.slug}.${entry.operation}`},
        ${entry.userId}, ${entry.outcome},
        ${Object.keys(entry.callArgs).sort().join(',')},
        ${Date.now()}
      )
    `;
  } catch (error) {
    console.warn('[connectors-bridge] audit write failed:', error);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

interface BridgeAuth {
  organizationId: string;
  sessionId: string;
  connectorGrants: string[];
  userId?: string;
}

async function authSessionToken(
  sql: Sql,
  request: Request,
): Promise<BridgeAuth | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) return null;
  const row = await getSessionTokenByHash(
    sql,
    createHash('sha256').update(token).digest('hex'),
  );
  if (row === null) return null;
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    connectorGrants: row.scope.connectorGrants,
    ...(row.scope.userId !== undefined ? { userId: row.scope.userId } : {}),
  };
}

const HTTP_VERBS = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

function isHostcallMethod(value: string): value is keyof typeof HTTP_VERBS {
  return value in HTTP_VERBS;
}

export function createConnectorBridgeRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.post('/execute', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return json(401, { status: 'error', message: 'Unauthorized.' });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(200, {
        status: 'invalid_args',
        message: 'The request body must be JSON: {slug, operation, args}.',
      });
    }
    const slug =
      isRecord(body) && typeof body.slug === 'string' ? body.slug : '';
    const operation =
      isRecord(body) && typeof body.operation === 'string'
        ? body.operation
        : '';
    const callArgs = isRecord(body) && isRecord(body.args) ? body.args : {};
    if (slug === '' || operation === '') {
      return json(200, {
        status: 'invalid_args',
        message: 'Both "slug" and "operation" are required.',
      });
    }
    // The grant set is what this agent was EQUIPPED with when its turn was
    // provisioned — never what the request claims.
    if (!auth.connectorGrants.includes(slug)) {
      return json(200, {
        status: 'unavailable',
        blockers: [
          {
            code: 'not_granted',
            guidance:
              `The "${slug}" connector is not equipped for this agent. ` +
              'The user can equip it in the chat composer or on the project Agents tab, then start a new message.',
          },
        ],
      });
    }
    if (auth.userId === undefined) {
      return json(200, {
        status: 'unavailable',
        blockers: [
          {
            code: 'no_user_context',
            guidance:
              'This session token carries no user context, so connector calls cannot run from it.',
          },
        ],
      });
    }
    const result = await runBridgeConnectorImpl(
      (dispatchArgs) =>
        runConnectorAction(deps.sql, {
          organizationId: dispatchArgs.organizationId,
          connector: dispatchArgs.connector,
          action: dispatchArgs.action,
          input: dispatchArgs.input,
          mode: 'live',
          caller: { kind: 'user', userId: dispatchArgs.userId },
          execSessionId: dispatchArgs.execSessionId,
        }),
      {
        organizationId: auth.organizationId,
        sessionId: auth.sessionId,
        userId: auth.userId,
        slug,
        operation,
        callArgs,
      },
    );
    await recordConnectorCall(deps.sql, {
      organizationId: auth.organizationId,
      sessionId: auth.sessionId,
      slug,
      operation,
      userId: auth.userId,
      outcome: result.status,
      callArgs,
    });
    return json(200, result);
  });

  app.post('/status', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return json(401, { status: 'error', message: 'Unauthorized.' });
    }
    return json(
      200,
      await bridgeConnectorStatusImpl(
        async (probe) => {
          try {
            const credential = await resolveConnectorCredential(deps.sql, {
              organizationId: probe.organizationId,
              connectorSlug: probe.connectorSlug,
            });
            return credential !== null;
          } catch (error) {
            console.warn(
              `[connectors-bridge] credential probe failed for ${probe.connectorSlug}:`,
              error,
            );
            return false;
          }
        },
        {
          organizationId: auth.organizationId,
          grants: auth.connectorGrants,
        },
      ),
    );
  });

  /**
   * The platform end of a live body's `ctx.http`. The body runs out of
   * process, but every request it makes is performed HERE, by the same live
   * host the in-process path uses — so the allowlist, https-only rule,
   * response caps and Authorization injection stay server-side.
   */
  app.post('/hostcall', async (c) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith(BEARER_PREFIX)
      ? header.slice(BEARER_PREFIX.length).trim()
      : '';
    const verdict = await verifyHostcallToken(token);
    if (!verdict.ok) {
      return json(401, {
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized.' },
      });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(400, {
        error: { code: 'BAD_REQUEST', message: 'The body must be JSON.' },
      });
    }
    if (
      !isRecord(body) ||
      body.kind !== 'http' ||
      typeof body.method !== 'string' ||
      typeof body.url !== 'string'
    ) {
      return json(400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Expected {kind: "http", method, url, req?}.',
        },
      });
    }
    const connector = findConnector(verdict.payload.connector);
    if (!connector) {
      return json(200, {
        error: {
          code: 'UNKNOWN_CONNECTOR',
          message: `no shipped connector is named "${verdict.payload.connector}"`,
        },
      });
    }
    if (!isHostcallMethod(body.method)) {
      return json(200, {
        error: {
          code: 'BAD_METHOD',
          message: `"${body.method}" is not an HTTP verb the connector host offers`,
        },
      });
    }
    const req = isRecord(body.req) ? body.req : {};
    const headers = stringRecord(req.headers);
    const reqBody = typeof req.body === 'string' ? req.body : undefined;
    const responseType = req.responseType === 'base64' ? 'base64' : undefined;
    try {
      const credential = await resolveConnectorCredential(deps.sql, {
        organizationId: verdict.payload.org,
        connectorSlug: verdict.payload.connector,
        ...(verdict.payload.credentialRef !== undefined
          ? { credentialRef: verdict.payload.credentialRef }
          : {}),
      });
      const host = createLiveHost({
        connector,
        action: verdict.payload.action,
        ...(credential?.endpoint !== undefined
          ? { endpoint: credential.endpoint }
          : {}),
        ...(credential?.config !== undefined
          ? { config: credential.config }
          : {}),
        ...(credential?.authHeader !== undefined
          ? { authHeader: credential.authHeader }
          : {}),
      });
      const response = await host.http[HTTP_VERBS[body.method]](body.url, {
        ...(headers !== undefined ? { headers } : {}),
        ...(reqBody !== undefined ? { body: reqBody } : {}),
        ...(responseType !== undefined ? { responseType } : {}),
      });
      return json(200, {
        status: response.status,
        headers: response.headers,
        bodyText: response.text(),
      });
    } catch (error) {
      // A coded refusal (allowlist, https-only, credential, response cap)
      // crosses as DATA so the in-sandbox façade rethrows it verbatim for
      // the body's own error handling.
      if (error instanceof ConnectorError) {
        return json(200, {
          error: { code: error.code, message: error.message },
        });
      }
      console.error('[connectors-hostcall] request failed', error);
      return json(200, {
        error: {
          code: 'REQUEST_FAILED',
          message:
            error instanceof Error ? error.message : 'the request failed',
        },
      });
    }
  });

  return app;
}
