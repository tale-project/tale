import type { Sql } from 'postgres';

import { createAuditLog } from '../audit_logs/service.ts';
import { detachSkillFromAgents } from '../projects/service.ts';

/**
 * What a skill delete does beside removing the bundle: every agent of the
 * organization that equipped the slug is unequipped, in one transaction, and
 * the audit log records the delete with the agents it touched. Both doors
 * (the app's and `DELETE /api/v1/skills/{slug}`) call this after the file
 * lane confirmed the removal, still under the skill's writer lock.
 *
 * Before this, the bundle vanished and the agents kept naming it: their
 * runs failed to start — and were auto-retried three times over a
 * configuration nothing could change — and their dialog refused every
 * save with `PROJECT_AGENT_SKILL_UNKNOWN` (2026-09-26 evaluation, C-09).
 */
export async function unequipDeletedSkill(
  sql: Sql,
  args: {
    organizationId: string;
    slug: string;
    actor: { id: string; email?: string | null };
  },
): Promise<number> {
  return sql.begin(async (tx) => {
    const detached = await detachSkillFromAgents(
      tx,
      args.organizationId,
      args.slug,
    );
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.id,
      ...(args.actor.email ? { actorEmail: args.actor.email } : {}),
      actorType: 'user',
      action: 'skill.deleted',
      category: 'skill',
      resourceType: 'skill',
      resourceId: args.slug,
      resourceName: args.slug,
      metadata: {
        detachedAgents: detached.map((agent) => ({
          id: agent.id,
          name: agent.name,
          projectId: agent.projectId,
        })),
      },
      status: 'success',
    });
    return detached.length;
  });
}
