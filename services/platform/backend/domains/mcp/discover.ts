/**
 * What a modern client (2026-07-28) learns before anything else, and how
 * every modern answer names the server.
 *
 * `server/discover` takes the place `initialize` has for a legacy client,
 * without opening anything: the revisions the endpoint speaks, what it can
 * do, the server instructions and who it is — the same facts `initialize`
 * answers, so a client learns the same whichever era it speaks. On the
 * modern revision every result says it is complete (`resultType`) and names
 * the server in its `_meta`, and the answers a client may cache say for how
 * long and that they are the key holder's own (`ttlMs`, `cacheScope`).
 */

import { SERVER_INSTRUCTIONS } from '../../../lib/mcp/instructions';
import {
  MCP_CACHE_SCOPE,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_CAPABILITIES,
  MCP_SERVER_INFO,
} from '../../../lib/mcp/server';
import { META_SERVER_INFO } from './eras';

/** `server/discover`'s answer, before the modern decoration. */
export function discoverResult(): Record<string, unknown> {
  return {
    supportedVersions: [...MCP_PROTOCOL_VERSIONS],
    capabilities: MCP_SERVER_CAPABILITIES,
    instructions: SERVER_INSTRUCTIONS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A result as the modern revision answers it: complete, naming the server
 * in its `_meta` beside whatever the result already carried there, and —
 * for an answer a client may cache — how long it stays fresh and that it
 * is the caller's own.
 */
export function modernResult(
  result: unknown,
  freshForMs?: number,
): Record<string, unknown> {
  const body = isRecord(result) ? result : {};
  const meta = isRecord(body._meta) ? body._meta : {};
  return {
    ...body,
    resultType: 'complete',
    _meta: { ...meta, [META_SERVER_INFO]: MCP_SERVER_INFO },
    ...(freshForMs === undefined
      ? {}
      : { ttlMs: freshForMs, cacheScope: MCP_CACHE_SCOPE }),
  };
}
