import type { TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import type { WriteOrigin } from '../../lib/write-origin.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * The audit row of a change to an automation's DEFINITION — a version saved,
 * a version deployed, a trigger set or removed, an installation in a project
 * added or removed, a write it may make without approval granted or
 * withdrawn, the automation deleted. Every door reaches these writes
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
 * Lock order: a definition writer takes the automation's name before any
 * trigger row (`trigger-failures.ts`); the audit row it writes takes no
 * lock — the chain is sealed off the write path.
 */

/** The definition writes that are audited, and nothing else. */
export type AutomationDefinitionAction =
  | 'automation.version.saved'
  | 'automation.deployed'
  | 'automation.rolled_back'
  | 'automation.deleted'
  | 'automation.trigger.set'
  | 'automation.trigger.deleted'
  | 'automation.project.bound'
  | 'automation.project.unbound'
  | 'automation.approval_allowance.granted'
  | 'automation.approval_allowance.revoked';

/** Who an actor string names, as the audit row records it: the person (a
 * bare id, `user:<id>`, `api-key:<id>`) with the door's actor type, or the
 * system for a writer that is not a person (`system:provisioning`). */
export function auditActor(actor: string): {
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
    /** Who made the write, through which door (`write-origin.ts`). */
    origin: WriteOrigin;
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
    ...auditActor(args.origin.actor),
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
