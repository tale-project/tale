/**
 * What the MCP endpoint keeps of each call: one counter row per person,
 * credential, method, tool and UTC day (`app.mcp_client_activity`, migration
 * 0180), and one log line. Neither ever holds what the call carried — no
 * argument, no result, no address — so a secret an agent pasted into a tool
 * call cannot end up here. The writes a call makes are audited on their own
 * (the request channel stamps them `via: mcp`); this record only counts.
 *
 * Recording never fails a call: the upsert is awaited so the counts are
 * true when the answer leaves, but an error is logged and swallowed.
 */

import type { Sql } from 'postgres';

import type { McpCaller } from './caller.ts';

/** The JSON-RPC methods the endpoint counts — the ones it serves. A method
 * it does not serve is answered and not counted, so a client cannot mint
 * rows by inventing method names. */
export const MCP_RECORDED_METHODS = [
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
] as const;

export type McpRecordedMethod = (typeof MCP_RECORDED_METHODS)[number];

export function isRecordedMethod(method: string): method is McpRecordedMethod {
  return (MCP_RECORDED_METHODS as readonly string[]).includes(method);
}

/** How one answered call went: `ok`; `refused` — a tool error the agent can
 * read (arguments, role, budget, a refusal the engine answered) or a
 * protocol error; `error` — an unexpected failure (`INTERNAL_ERROR`). */
export type McpCallOutcome = 'ok' | 'refused' | 'error';

/** One answered call, as the protocol layer reports it. */
export interface McpCallRecord {
  readonly method: McpRecordedMethod;
  /** The tool a `tools/call` named, when the inventory holds it. */
  readonly tool?: string;
  readonly outcome: McpCallOutcome;
  /** The refusal's code (a tool error's `code`, a JSON-RPC error's number). */
  readonly code?: string;
  readonly ms: number;
  /** What the client called itself on this message, through
   * `displayClientName` — `initialize` only on the legacy protocol. */
  readonly clientName?: string;
}

/** How long a day's counters are kept. */
export const MCP_ACTIVITY_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

/** The UTC date of `ms` as yyyymmdd — the `day` column. */
export function utcDay(ms: number): number {
  const date = new Date(ms);
  return (
    date.getUTCFullYear() * 10_000 +
    (date.getUTCMonth() + 1) * 100 +
    date.getUTCDate()
  );
}

/** The credential a row is counted under, or null when the caller's has no
 * id (a door that verified a session naming no key — never the real door). */
function credentialOf(
  caller: McpCaller,
): { kind: 'api-key'; id: string } | null {
  const { apiKeyId } = caller.credential;
  return apiKeyId === undefined || apiKeyId === ''
    ? null
    : { kind: 'api-key', id: apiKeyId };
}

/** Count one answered call. Never throws. */
export async function recordMcpActivity(
  sql: Sql,
  caller: McpCaller,
  record: McpCallRecord,
  now = Date.now(),
): Promise<void> {
  const credential = credentialOf(caller);
  if (credential === null) return;
  const refused = record.outcome === 'refused' ? 1 : 0;
  const failed = record.outcome === 'error' ? 1 : 0;
  try {
    await sql`
      INSERT INTO app.mcp_client_activity (
        org_id, user_id, credential_kind, credential_id, method, tool, day,
        calls, refusals, failures, client_name, last_at_ms
      ) VALUES (
        ${caller.organizationId}, ${caller.userId}, ${credential.kind},
        ${credential.id}, ${record.method}, ${record.tool ?? ''},
        ${utcDay(now)}, 1, ${refused}, ${failed},
        ${record.clientName ?? null}, ${now}
      )
      ON CONFLICT (org_id, user_id, credential_id, method, tool, day)
      DO UPDATE SET
        calls = app.mcp_client_activity.calls + 1,
        refusals = app.mcp_client_activity.refusals + EXCLUDED.refusals,
        failures = app.mcp_client_activity.failures + EXCLUDED.failures,
        client_name = COALESCE(
          EXCLUDED.client_name, app.mcp_client_activity.client_name
        ),
        last_at_ms = GREATEST(
          app.mcp_client_activity.last_at_ms, EXCLUDED.last_at_ms
        )
    `;
  } catch (error) {
    console.warn('[mcp] could not record the call:', error);
  }
}

/** A code as the log line prints it: a refusal code or a JSON-RPC error
 * number, never free text a caller chose. */
function loggedCode(code: string | undefined): string {
  return code !== undefined && /^-?[A-Za-z0-9_.]{1,64}$/.test(code)
    ? code
    : '-';
}

/**
 * The one log line each answered call writes — who, with which credential,
 * which method and tool, how it went and how long it took. Never an
 * argument, a result or the client's own name.
 */
export function mcpCallLogLine(
  caller: McpCaller,
  record: McpCallRecord,
): string {
  const credential = credentialOf(caller);
  return [
    '[mcp]',
    `org=${caller.organizationId}`,
    `user=${caller.userId}`,
    `cred=${credential === null ? '-' : credential.id}`,
    `method=${record.method}`,
    `tool=${record.tool ?? '-'}`,
    `outcome=${record.outcome}`,
    `code=${record.code === undefined ? '-' : loggedCode(record.code)}`,
    `ms=${Math.round(record.ms)}`,
  ].join(' ');
}

/** Delete the days past the retention window, across every organization;
 * the number of rows removed. */
export async function sweepMcpActivity(
  sql: Sql,
  now = Date.now(),
): Promise<number> {
  const cutoff = utcDay(now - MCP_ACTIVITY_RETENTION_DAYS * DAY_MS);
  const deleted = await sql`
    DELETE FROM app.mcp_client_activity WHERE day < ${cutoff}
  `;
  return deleted.count;
}
