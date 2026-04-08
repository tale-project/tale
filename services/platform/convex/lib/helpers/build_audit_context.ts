import type { MutationCtx } from '../../_generated/server';
import type { AuditContext } from '../../audit_logs/types';
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
