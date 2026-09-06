import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { loadConnectorCatalog } from '../../lib/connectors/dispatcher.ts';
import { dispatch } from '../../lib/engine/api/dispatch.ts';
import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner.ts';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm.ts';
import {
  handleMcpRequest,
  mcpGetNotAllowed,
} from '../core/automations_builder/mcp_http.ts';
import { pgAutomationStore } from '../domains/automations/dispatch-store.ts';
import { dispatchCapabilityAs } from '../domains/chat/capabilities.ts';
import { createCtxShim, type ShimHandlers } from '../lib/ctx-shim.ts';
import type { RestEnv } from './shared.ts';

/**
 * POST /api/v1/mcp — the platform MCP endpoint. The 0.4 protocol layer
 * (`handleMcpRequest`: JSON-RPC framing, initialize/ping/tools, the
 * developer gate on persisting tools, refusals-as-data) is REUSED WHOLE;
 * its `rc.ctx.runAction` targets resolve to exactly two 0.5 handlers —
 * the engine dispatch over the pg `DispatchStore` (live execution
 * enabled; the store's own run-control methods authorize the actor) and
 * the capability surface — plus the member-role read the developer gate
 * makes.
 */

/** Install the engine seams one dispatch needs (cheap, idempotent — the
 * 0.4 `assembleBuilderHost`). */
export function assembleEngineHost(): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  loadConnectorCatalog();
}

/** One engine method against the org store, live — the 0.4
 * `dispatchEngineMethod` twin. */
export async function dispatchEngineMethod(
  sql: Sql,
  args: {
    organizationId: string;
    actor: string;
    method: string;
    params?: unknown;
  },
): Promise<unknown> {
  assembleEngineHost();
  const store = pgAutomationStore(sql, {
    organizationId: args.organizationId,
    actor: args.actor,
  });
  return dispatch(args.method, args.params ?? {}, { store, allowLive: true });
}

function mcpShimHandlers(sql: Sql): ShimHandlers {
  return {
    'members/internal_queries:getMemberRole': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the REST helper passes exactly this shape
      const args = raw as { userId: string; organizationId: string };
      const rows = await sql<{ role: string }[]>`
        SELECT "role" FROM "member"
        WHERE "organizationId" = ${args.organizationId}
          AND "userId" = ${args.userId}
        LIMIT 1
      `;
      return rows[0]?.role ?? null;
    },
    'chat/capabilities_action:dispatchCapabilityAs': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the MCP layer passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        method: string;
        params?: unknown;
      };
      return dispatchCapabilityAs(sql, args);
    },
    'automations_builder/run_session:dispatchEngineMethod': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the MCP layer passes exactly this shape
      const args = raw as {
        organizationId: string;
        actor: string;
        method: string;
        params?: unknown;
      };
      return dispatchEngineMethod(sql, args);
    },
  };
}

export function createRestMcpRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.post('/mcp', async (c) => {
    const rc = {
      ctx: createCtxShim(mcpShimHandlers(deps.sql)),
      org: {
        organizationId: c.get('organizationId'),
        orgSlug: c.get('orgSlug'),
      },
      user: { userId: c.get('userId') },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused protocol layer touches exactly the rc surface built above
    return handleMcpRequest(rc as never, c.req.raw);
  });

  app.get('/mcp', () => mcpGetNotAllowed());

  return app;
}
