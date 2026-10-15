import type { TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * A project agent pins a connector credential by its name
 * (`app.project_agents.connector_credentials`, migration 0219). When the
 * credential is renamed, every agent of the organization that pins it is
 * moved to the new name in the rename's own transaction [CCRED-R13]: it
 * keeps acting as the same credential, rather than losing its access as a
 * pin naming nothing would. The agents' `updatedAt` moves, so a dialog
 * still holding the old name is refused as stale rather than saving it back.
 * Answers how many agents moved.
 */
export async function carryCredentialPins(
  tx: TransactionSql,
  args: {
    organizationId: string;
    connectorSlug: string;
    from: string;
    to: string;
  },
): Promise<number> {
  if (args.from === args.to) return 0;
  const moved = await tx<{ projectId: string }[]>`
    UPDATE app.project_agents SET
      connector_credentials = jsonb_set(
        connector_credentials,
        ARRAY[${args.connectorSlug}]::text[],
        to_jsonb(${args.to}::text)
      ),
      updated_at_ms = GREATEST(updated_at_ms + 1, ${Date.now()})
    WHERE org_id = ${args.organizationId}
      AND lower(connector_credentials ->> ${args.connectorSlug}) = lower(${args.from})
    RETURNING project_id AS "projectId"
  `;
  for (const projectId of new Set(moved.map((row) => row.projectId))) {
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'project',
      entityId: projectId,
    });
  }
  return moved.length;
}
