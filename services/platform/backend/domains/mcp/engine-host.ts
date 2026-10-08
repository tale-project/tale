/**
 * What an MCP tool call runs on: the automation engine's dispatch table over
 * the organization's automation store, and the organization's capability
 * surface. The protocol layer (`protocol.ts`) routes a `tools/call` to one of
 * the two through the `McpHost` this module binds to the database.
 */

import type { Sql } from 'postgres';

import { loadConnectorCatalog } from '../../../lib/connectors/dispatcher.ts';
import { dispatch } from '../../../lib/engine/api/dispatch.ts';
import {
  hasCodeRunner,
  setCodeRunner,
} from '../../../lib/engine/core/runner.ts';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm.ts';
import {
  pgAutomationStore,
  type PgStoreScope,
} from '../automations/dispatch-store.ts';
import { dispatchCapabilityAs } from '../chat/capabilities.ts';
import type { McpCaller } from './caller.ts';
import type { McpHost } from './protocol.ts';

/** Install the engine seams one dispatch needs (cheap and idempotent). */
function assembleEngineHost(): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  loadConnectorCatalog();
}

/**
 * Whom the engine attributes the caller's saves and starts to: the door
 * `api-key:<userId>` (`lib/shared/run-starter.ts`), plus the key itself, so
 * the runs it starts book their spend to the key as well.
 */
export function engineScope(caller: McpCaller): PgStoreScope {
  const { apiKeyId } = caller.credential;
  return {
    organizationId: caller.organizationId,
    actor: `api-key:${caller.userId}`,
    ...(apiKeyId !== undefined ? { apiKeyId } : {}),
  };
}

/** One engine method against the caller's organization, live execution
 * enabled: the store's own run-control methods authorize the actor. */
async function dispatchEngineMethod(
  sql: Sql,
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  assembleEngineHost();
  const store = pgAutomationStore(sql, engineScope(caller));
  return dispatch(method, params, { store, allowLive: true });
}

/** The two surfaces a tool call reaches, bound to the database. */
export function mcpHost(sql: Sql): McpHost {
  return {
    engine: (caller, method, params) =>
      dispatchEngineMethod(sql, caller, method, params),
    capability: (caller, method, params) =>
      dispatchCapabilityAs(sql, {
        organizationId: caller.organizationId,
        userId: caller.userId,
        method,
        params,
      }),
  };
}
