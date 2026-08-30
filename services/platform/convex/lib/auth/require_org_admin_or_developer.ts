/**
 * Stricter variant of {@link requireOrgMembershipById} that additionally
 * enforces the `developerSettings` CASL capability — matching the
 * `requireDeveloperSettingsAccess` pattern in `providers/auth.ts`. Used to
 * gate skill creation, editing, deletion, and any agent-config write that
 * changes capability fields.
 *
 * The capability — not a hardcoded role list — is the source of truth.
 * `developer`, `admin`, and `owner` all hold `read developerSettings` per
 * `lib/permissions/ability.ts`; if the role matrix is ever expanded to add
 * (say) `auditor` with this capability, this gate picks it up without
 * a code change. The `developer` role IS provisioned by Better Auth
 * (see `convex/auth.ts:111-133, 236-253, 557`).
 *
 * NOTE: this file is intentionally NOT `'use node'` — it does only V8 work
 * (ctx.runQuery against Better Auth), so it can be imported from both Node
 * and V8 actions.
 */

import { defineAbilityFor } from '../../../lib/permissions/ability';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { ActionCtx, MutationCtx } from '../../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from './require_org_membership';

export async function requireOrgAdminOrDeveloper(
  ctx: ActionCtx | MutationCtx,
  organizationId: string,
): Promise<OrgMembershipAuth> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  const ability = defineAbilityFor(auth.member.role);
  if (ability.cannot('read', 'developerSettings')) {
    // Distinct from the inner helper's `ORG_FORBIDDEN` so the UI can
    // distinguish "not a member" from "wrong role" and surface different
    // toasts. The settings/providers dispatcher already maps this code.
    throw new AppError({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      message: `Role "${auth.member.role}" lacks the developer-settings capability required to perform this action.`,
    });
  }
  return auth;
}
