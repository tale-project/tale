import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { mcpCallLogLine, recordMcpActivity } from '../domains/mcp/activity.ts';
import { callerFromRest } from '../domains/mcp/caller.ts';
import { mcpHost } from '../domains/mcp/engine-host.ts';
import {
  judgeMcpOrigin,
  loggableOrigin,
  mcpOriginEnforced,
} from '../domains/mcp/origin.ts';
import { handleMcpRequest } from '../domains/mcp/protocol.ts';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';
import { DEFAULT_BODY_BYTES, restBodyLimit, type RestEnv } from './shared.ts';

/**
 * POST /api/v1/mcp — the platform MCP endpoint. The door proves the caller
 * (`callerFromRest`: the key, the organization, the member's role) and hands
 * the request to the MCP domain's protocol layer (`handleMcpRequest`:
 * JSON-RPC framing, initialize/ping/tools, the developer gate on persisting
 * tools, refusals-as-data), whose tool calls reach the engine dispatch over
 * the pg `DispatchStore` (live execution enabled; the store's own
 * run-control methods authorize the actor) and the capability surface
 * (`mcpHost`).
 */

/** Charge one unit of a user-scoped lane: null when it may proceed, the
 * wait when the budget is spent. */
async function chargeLane(
  sql: Sql,
  lane: 'rest:api' | 'rest:execute',
  userId: string,
): Promise<{ retryAfterMs: number } | null> {
  try {
    await checkUserRateLimit(sql, lane, userId);
    return null;
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { retryAfterMs: error.retryAfter };
    }
    throw error;
  }
}

export function createRestMcpRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  const host = mcpHost(deps.sql);

  // The protocol layer reads the body itself, so the door's default byte
  // cap is applied here as middleware (a 413 in the door envelope).
  app.post('/mcp', restBodyLimit(DEFAULT_BODY_BYTES), async (c) => {
    // A browser page from another site must not drive a key it holds: a
    // request that carries an Origin the deployment does not accept is
    // logged, and refused once the operator enforces the rule
    // (`domains/mcp/origin.ts`). CLI and server clients send no Origin.
    const origin = c.req.header('origin');
    if (judgeMcpOrigin(origin) === 'mismatch') {
      console.warn(
        `[mcp] origin-mismatch origin=${loggableOrigin(origin ?? '')} org=${c.get('organizationId')} user=${c.get('userId')} enforced=${mcpOriginEnforced()}`,
      );
      if (mcpOriginEnforced()) {
        return c.json(
          {
            error:
              'Requests from this origin are not accepted on the MCP endpoint — a browser page reaches it only from an origin the operator allows',
            code: 'ORIGIN_FORBIDDEN',
          },
          403,
        );
      }
    }
    // A JSON-RPC batch carries up to twenty calls, so one HTTP header
    // cannot name a start: the key is a tool argument (`idempotencyKey`
    // on start_run, run_deployed and invoke_capability). The header used
    // to be accepted and silently discarded — the worst of the three
    // options (2026-09-14 evaluation, h9).
    if (c.req.header('idempotency-key') !== undefined) {
      return c.json(
        {
          error:
            'Idempotency-Key is not read on the MCP endpoint — a batch carries up to 20 calls; pass idempotencyKey in the arguments of start_run, run_deployed or invoke_capability instead',
          code: 'INVALID_HEADER',
          data: {
            issues: [
              {
                path: 'Idempotency-Key',
                message:
                  'is not read on this endpoint — pass idempotencyKey in the tool arguments',
              },
            ],
          },
        },
        400,
      );
    }
    const caller = callerFromRest(c);
    return handleMcpRequest(caller, c.req.raw, {
      host,
      // Every answered call writes one log line and adds to its day's
      // counters — never what it carried (`domains/mcp/activity.ts`).
      observe: async (record) => {
        console.log(mcpCallLogLine(caller, record));
        await recordMcpActivity(deps.sql, caller, record);
      },
      // The door charged this HTTP request once; every further tool call a
      // batch carries draws from the same `rest:api` budget, so a batch is
      // never cheaper than the requests it stands for.
      admit: () => chargeLane(deps.sql, 'rest:api', caller.userId),
      // A tool that executes an automation draws one execution from the
      // budget the REST API's run starts draw from, after its role check.
      charge: (lane) => chargeLane(deps.sql, lane, caller.userId),
    });
  });

  // No session to DELETE, no SSE stream to GET: the door's catch-all
  // answers every other verb with 405 and `Allow: POST` — registering them
  // here made the same catch-all list them as served.

  return app;
}
