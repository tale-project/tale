import type { AuditContext } from '../../../domains/audit_logs/types.ts';
import type { MutationCtx } from '../ctx';
import { getAuthenticatedUser } from '../rls/auth/get_authenticated_user';

export async function buildAuditContext(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuditContext> {
  const authUser = await getAuthenticatedUser(ctx);
  return {
    organizationId,
    actor: authUser
      ? { id: authUser.userId, email: authUser.email, type: 'user' as const }
      : { id: 'system', type: 'system' as const },
  };
}
