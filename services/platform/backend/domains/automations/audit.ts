import type { Sql, TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * The audit row of a change to an automation's DEFINITION — a version saved,
 * a version deployed, a trigger set or removed, an installation in a project
 * added or removed, the automation deleted. Every door reaches these writes
 * through the store (the editor, a package upload, the REST API, a coding
 * agent over MCP, managed configuration, the shipped default packs), so the
 * row is written there, in the write's own transaction: no door can change a
 * definition without leaving one.
 *
 * Written inside an MCP tool call, the request channel stamps the row with
 * `via: 'mcp'`, the tool, the key and the client (`lib/request-channel.ts`);
 * this module never sets `via` itself. A row never holds a document, a
 * secret or a webhook token — only names, version numbers and the shape of
 * what changed.
 *
 * Lock order: the organization's audit chain is taken by `createAuditLog`;
 * a writer that also locks a trigger row takes the chain FIRST
 * (`lockAuditChain`), the order `trigger-failures.ts` documents for every
 * transaction that holds both.
 */

/** The definition writes that are audited, and nothing else. */
export type AutomationDefinitionAction =
  | 'automation.version.saved'
  | 'automation.deployed'
  | 'automation.deleted'
  | 'automation.trigger.set'
  | 'automation.trigger.deleted'
  | 'automation.project.bound'
  | 'automation.project.unbound';

/** Who an actor string names, as the audit row records it: the person (a
 * bare id, `user:<id>`, `api-key:<id>`) with the door's actor type, or the
 * system for a writer that is not a person (`system:provisioning`). */
function auditActor(actor: string): {
  actorId: string;
  actorType: AuditLogActorType;
} {
  const starter = parseRunStarter(actor);
  if (starter.kind === 'user') {
    return { actorId: starter.userId, actorType: 'user' };
  }
  if (starter.kind === 'api-key') {
    return { actorId: starter.userId, actorType: 'api' };
  }
  return { actorId: actor, actorType: 'system' };
}

export async function auditDefinitionWrite(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actor: string;
    action: AutomationDefinitionAction;
    name: string;
    /** The version the write is about, when it is about one: the row then
     * names `name@version`, as the run rows do. */
    version?: number;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    ...auditActor(args.actor),
    action: args.action,
    category: 'workflow',
    resourceType: 'automation',
    resourceId: args.name,
    resourceName:
      args.version === undefined ? args.name : `${args.name}@${args.version}`,
    ...(args.previousState === undefined
      ? {}
      : { previousState: args.previousState }),
    ...(args.newState === undefined ? {} : { newState: args.newState }),
    ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
    status: 'success',
  });
}

/** How many deploys a history read answers — the recent ones a rollback
 * chooses from. */
const DEPLOYMENT_HISTORY_LIMIT = 20;

/**
 * When each version of an automation went live, newest first, read from the
 * `automation.deployed` rows this module writes: the version, what was live
 * before it, when, who, and the door when it was a coding agent's. A deploy
 * from before these rows were written, or one the audit retention removed,
 * is not in it — and neither is one of an automation of the same name that
 * was deleted since: only the rows after the name's last
 * `automation.deleted` row (the chain's `ts` is strictly increasing per
 * organization), so a rollback never offers a version of the old one.
 */
export async function listDeployments(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<
  Array<{
    version: number;
    previousVersion: number | null;
    deployedAt: number;
    deployedBy: string;
    via: string | null;
  }>
> {
  const rows = await sql<
    {
      version: string | null;
      previousVersion: string | null;
      deployedAt: number;
      deployedBy: string;
      via: string | null;
    }[]
  >`
    SELECT new_state->>'deployedVersion' AS version,
           previous_state->>'deployedVersion' AS "previousVersion",
           ts::float8 AS "deployedAt", actor_id AS "deployedBy",
           metadata->>'via' AS via
    FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND action = 'automation.deployed'
      AND resource_type = 'automation' AND resource_id = ${name}
      AND ts > coalesce((
        SELECT max(ts) FROM app.audit_logs
        WHERE org_id = ${organizationId}
          AND action = 'automation.deleted'
          AND resource_type = 'automation' AND resource_id = ${name}
      ), 0)
    ORDER BY ts DESC
    LIMIT ${DEPLOYMENT_HISTORY_LIMIT}
  `;
  /** A version number a row holds, or null for anything else. */
  const versionOf = (raw: string | null): number | null => {
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(value) && value >= 1 ? value : null;
  };
  return rows.flatMap((row) => {
    const version = versionOf(row.version);
    if (version === null) return [];
    return [
      {
        version,
        previousVersion: versionOf(row.previousVersion),
        deployedAt: row.deployedAt,
        deployedBy: row.deployedBy,
        via: row.via,
      },
    ];
  });
}
