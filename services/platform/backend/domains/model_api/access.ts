import {
  type ModelAccessConfig,
  modelApiEnabledOf,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { PlatformCapability } from '../../../lib/shared/competences.ts';
import {
  readGovernancePolicy,
  readGovernancePolicyForOrg,
} from '../../lib/org-config.ts';
import { holdsCapability } from '../governance/competence.ts';

/**
 * Who may call the model endpoints for API keys, and whether they are on —
 * the door's two gates, read the same way by every surface that answers
 * them: the endpoints themselves (`rest/v1-model-api.ts`), `GET /api/v1/me`
 * (`capabilities.modelApi`), and the app's API settings (`GET /api/app/
 * governance/my/model-api`).
 *
 *  - The SWITCH is the organization's: `modelApi.enabled` on its
 *    model-access policy, off unless an admin turned it on. The file is read
 *    the way an authorization policy must be (`strict`: fresh, never a cached
 *    or default stand-in for configuration that exists but cannot be read),
 *    and a file that cannot be read keeps the door shut.
 *  - The RIGHT is the person's: owners, admins and developers carry it by
 *    role (the role's `developerSettings` ability, the developer capability
 *    the REST door documents), any other member only through a live
 *    `tale:models.api` grant in the competence register — organization-
 *    scoped, audited, optionally expiring, revoked with the membership. A
 *    disabled seat never calls, whatever it holds.
 */

const MODEL_API_CAPABILITY: PlatformCapability = 'tale:models.api';

/** The member the gates judge. `orgSlug`, when the caller already resolved
 * it (the REST door has), saves the slug read. */
export interface ModelApiCaller {
  organizationId: string;
  orgSlug?: string;
  userId: string;
  role: string;
}

/** Whether the caller's role or grants admit them — independent of the
 * organization's switch. */
export async function mayCallModelApi(
  sql: Sql | TransactionSql,
  caller: ModelApiCaller,
  now: number = Date.now(),
): Promise<boolean> {
  if (caller.role.toLowerCase() === 'disabled') return false;
  if (defineAbilityFor(caller.role).can('read', 'developerSettings')) {
    return true;
  }
  return holdsCapability(
    sql,
    caller.organizationId,
    caller.userId,
    MODEL_API_CAPABILITY,
    now,
  );
}

/** The organization's model-access policy, strictly: `null` when no file
 * exists, a throw when one exists and cannot be read. */
async function readModelAccessStrict(
  sql: Sql | TransactionSql,
  caller: ModelApiCaller,
): Promise<ModelAccessConfig | null> {
  return caller.orgSlug !== undefined
    ? readGovernancePolicy(caller.orgSlug, 'model_access', { strict: true })
    : readGovernancePolicyForOrg(sql, caller.organizationId, 'model_access', {
        strict: true,
      });
}

/** What the door answers the caller: open (with the policy every call is
 * then held to), or why not. */
export type ModelApiGate =
  | { kind: 'open'; policy: ModelAccessConfig }
  | { kind: 'disabled' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' };

/** The switch first, then the right: an organization that has not turned
 * the endpoints on answers the same for every member, and costs no grant
 * read. */
export async function resolveModelApiGate(
  sql: Sql | TransactionSql,
  caller: ModelApiCaller,
  now: number = Date.now(),
): Promise<ModelApiGate> {
  let policy: ModelAccessConfig | null;
  try {
    policy = await readModelAccessStrict(sql, caller);
  } catch (error) {
    console.error(
      `[model-api] ${caller.organizationId}: the model access policy cannot be read, so the model endpoints stay closed until it is restored:`,
      error,
    );
    return { kind: 'unavailable' };
  }
  if (policy === null || !modelApiEnabledOf(policy)) {
    return { kind: 'disabled' };
  }
  if (!(await mayCallModelApi(sql, caller, now))) return { kind: 'forbidden' };
  return { kind: 'open', policy };
}

/** The caller's standing for a surface that shows it rather than enforces
 * it: whether the organization turned the endpoints on, and whether this
 * member may call them once it has. An unreadable policy reads as off. */
export interface ModelApiStanding {
  enabled: boolean;
  allowed: boolean;
}

export async function readModelApiStanding(
  sql: Sql | TransactionSql,
  caller: ModelApiCaller,
  now: number = Date.now(),
): Promise<ModelApiStanding> {
  let enabled = false;
  try {
    enabled = modelApiEnabledOf(await readModelAccessStrict(sql, caller));
  } catch (error) {
    console.error(
      `[model-api] ${caller.organizationId}: the model access policy cannot be read; the model endpoints read as off:`,
      error,
    );
  }
  return { enabled, allowed: await mayCallModelApi(sql, caller, now) };
}
