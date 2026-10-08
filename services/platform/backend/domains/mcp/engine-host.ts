/**
 * What an MCP tool call runs on: the automation engine's dispatch table over
 * the organization's automation store, the platform's own tools, and the
 * organization's capability surface. The protocol layer (`protocol.ts`)
 * routes a `tools/call` to one of them through the `McpHost` this module
 * binds to the database.
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
import { mcpDocs } from './docs.ts';
import { dispatchPlatformTool } from './platform-tools.ts';
import type { McpHost } from './tools.ts';

/** Install the engine seams one dispatch needs (cheap and idempotent). */
function assembleEngineHost(): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  loadConnectorCatalog();
}

/**
 * Whom the engine attributes the caller's saves and starts to: the door
 * `api-key:<userId>` (`lib/shared/run-starter.ts`), plus the key itself, so
 * the runs it starts book their spend to the key as well. A version it saves
 * records the door, the key and the client (0181). Its reads answer only
 * the automations the app would show the person: one installed only in
 * projects they cannot read is "not found".
 */
export function engineScope(caller: McpCaller): PgStoreScope {
  const { apiKeyId } = caller.credential;
  return {
    organizationId: caller.organizationId,
    actor: `api-key:${caller.userId}`,
    ...(apiKeyId !== undefined ? { apiKeyId } : {}),
    via: 'mcp',
    ...(caller.clientName !== undefined
      ? { clientName: caller.clientName }
      : {}),
    visibleOnly: true,
  };
}

/** One engine method against the caller's organization, live execution
 * enabled: the store's own run-control methods authorize the actor.
 * `get_docs` serves the endpoint's references beside the engine's own. */
async function dispatchEngineMethod(
  sql: Sql,
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  assembleEngineHost();
  const store = pgAutomationStore(sql, engineScope(caller));
  return dispatch(method, params, { store, allowLive: true, docs: mcpDocs });
}

/** The two surfaces a tool call reaches, bound to the database. */
export function mcpHost(sql: Sql): McpHost {
  return {
    engine: (caller, method, params) =>
      dispatchEngineMethod(sql, caller, method, params),
    platform: (caller, method, params) =>
      dispatchPlatformTool(sql, caller, method, params),
    capability: (caller, method, params) =>
      dispatchCapabilityAs(sql, {
        organizationId: caller.organizationId,
        userId: caller.userId,
        method,
        params,
      }),
  };
}
