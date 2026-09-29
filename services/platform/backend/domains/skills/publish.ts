import {
  type OrgWideAudienceMode,
  skillOrgWideModeOf,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  mayChooseOrgWideAudience,
  roleMayChooseOrgWideAudience,
} from '../../core/lib/audience.ts';
import { SKILL_PUBLISH_FORBIDDEN } from '../../core/skills/file_actions.ts';
import { codedAppError } from '../../lib/app-error-response.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { holdsCapability } from '../governance/competence.ts';
import type { SkillWriteAudit, SkillWriteDoor } from './audit.ts';

/**
 * Who may give a skill the whole organization as its audience — the
 * organization's `skill_sharing` policy, read through the one audience rule
 * (`core/lib/audience.ts` `mayChooseOrgWideAudience`), with
 * `tale:skills.publish` as the capability that admits a named member
 * whatever the mode. Every skill write door resolves it the same way: the
 * editor's save (app and REST), the ZIP upload, and an automation package's
 * carried skills; the library listing and `GET /api/v1/me` answer it so a
 * client knows before its first write.
 *
 * A missing policy file is `everyone`, the behaviour before the policy
 * existed, and costs no capability read. The file is read the way an
 * authorization policy must be (`strict`: fresh, never a cached or default
 * stand-in for configuration that exists but cannot be read), and a file
 * that cannot be read counts as the tightest mode, `admins`: broken
 * configuration never widens who may publish, and sharing with one's own
 * teams — which this rule never governs — keeps working meanwhile.
 */

/** The capability that admits a member whatever the policy's mode. */
const SKILL_PUBLISH_CAPABILITY = 'tale:skills.publish';

/** What the caller may do with an organization-wide skill audience. */
export interface SkillPublishing {
  /** The mode the organization's policy puts in force. */
  readonly mode: OrgWideAudienceMode;
  /** Whether this caller may create, widen to, or change in place a skill
   * shared with the whole organization. */
  readonly allowed: boolean;
}

async function skillSharingMode(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<OrgWideAudienceMode> {
  try {
    return skillOrgWideModeOf(
      await readGovernancePolicyForOrg(sql, organizationId, 'skill_sharing', {
        strict: true,
      }),
    );
  } catch (error) {
    console.error(
      `[skills] ${organizationId}: the skill sharing policy cannot be read, so only owners, admins and members granted ${SKILL_PUBLISH_CAPABILITY} may share a skill with the whole organization until it is restored:`,
      error,
    );
    return 'admins';
  }
}

export async function resolveSkillPublishing(
  sql: Sql | TransactionSql,
  caller: { organizationId: string; userId: string; role: string },
  now: number = Date.now(),
): Promise<SkillPublishing> {
  const mode = await skillSharingMode(sql, caller.organizationId);
  const allowed = await mayChooseOrgWideAudience(
    { role: caller.role },
    {
      mode,
      holdsGrant: () =>
        holdsCapability(
          sql,
          caller.organizationId,
          caller.userId,
          SKILL_PUBLISH_CAPABILITY,
          now,
        ),
    },
  );
  return { mode, allowed };
}

/**
 * Only the verdict of {@link resolveSkillPublishing}, for a write door and
 * `GET /api/v1/me`: an owner or admin may in every mode, so their answer
 * costs no policy or grant read.
 */
export async function maySkillPublishOrgWide(
  sql: Sql | TransactionSql,
  caller: { organizationId: string; userId: string; role: string },
  now: number = Date.now(),
): Promise<boolean> {
  if (roleMayChooseOrgWideAudience(caller.role, 'admins')) return true;
  return (await resolveSkillPublishing(sql, caller, now)).allowed;
}

/** Whether `error` is the publish refusal, and the slug it names. */
export function publishRefusalSlug(error: unknown): string | null {
  const coded = codedAppError(error);
  if (coded?.code !== SKILL_PUBLISH_FORBIDDEN) return null;
  const slug = coded.data?.slug;
  return typeof slug === 'string' ? slug : '';
}

/** The audit action a refused publish records, in category `skill`. */
const SKILL_PUBLISH_DENIED_ACTION = 'skill.publish_denied';

/**
 * Record a refused publish — a denied attempt at governed sharing is
 * evidence too (the posture of the competence register's refused writes).
 * Written in its own transaction, because the write's transaction rolled
 * back with the refusal, and best effort: a failed audit is logged and never
 * turns the refusal into a 500. Does nothing for any other error.
 */
export async function auditIfPublishRefused(
  sql: Sql,
  error: unknown,
  args: {
    organizationId: string;
    actor: SkillWriteAudit['actor'];
    via: SkillWriteDoor;
  },
): Promise<void> {
  const slug = publishRefusalSlug(error);
  if (slug === null) return;
  try {
    await sql.begin((tx) =>
      createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actor.id,
        ...(args.actor.email ? { actorEmail: args.actor.email } : {}),
        ...(args.actor.role !== undefined
          ? { actorRole: args.actor.role }
          : {}),
        actorType: args.actor.type ?? 'user',
        action: SKILL_PUBLISH_DENIED_ACTION,
        category: 'skill',
        resourceType: 'skill',
        ...(slug !== '' ? { resourceId: slug, resourceName: slug } : {}),
        status: 'denied',
        errorMessage: 'organization-wide sharing is reserved',
        metadata: { via: args.via },
      }),
    );
  } catch (auditError) {
    console.warn('[skills] refused-publish audit failed:', auditError);
  }
}
