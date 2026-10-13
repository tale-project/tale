import type { TransactionSql } from 'postgres';

import { endAgentConnectionsAndTellInTx } from '../domains/agent_connections/end-and-tell.ts';
import type { AgentConnectionAuditActor } from '../domains/agent_connections/end.ts';

/**
 * Taking a person's access back when their account may be in other hands: a
 * password someone else set, a passkey or a second factor an admin removed.
 *
 * What a sign-in gave outlives the password that earned it unless it is
 * ended with it. A session ends with the credential, and so does every coding
 * agent the person connected — in every organization, with its consent and
 * tokens — recorded as the platform's doing (or the admin's, who is named),
 * with the reason "account security". The agent is told to connect again.
 *
 * One door for it, so a place that ends a person's sessions cannot forget
 * their agents (`tests/guards/account-security.guard.test.ts`).
 */

/** Better Auth's endpoint that changes a signed-in person's password. */
export const CHANGE_PASSWORD_PATH = '/change-password';

/** End every coding agent a person connected, in every organization. `by` is
 * the admin whose act it is; left out, the platform's. */
export async function endAgentsOf(
  tx: TransactionSql,
  userId: string,
  by?: AgentConnectionAuditActor,
): Promise<void> {
  await endAgentConnectionsAndTellInTx(tx, {
    userId,
    reason: 'account_security',
    revokedBy: by?.actorId ?? 'system',
    ...(by === undefined ? {} : { actor: by }),
  });
}

/** End every session of a person and every coding agent they connected. */
export async function endAllAccessOf(
  tx: TransactionSql,
  userId: string,
  by?: AgentConnectionAuditActor,
): Promise<void> {
  await tx`DELETE FROM "session" WHERE "userId" = ${userId}`;
  await endAgentsOf(tx, userId, by);
}
