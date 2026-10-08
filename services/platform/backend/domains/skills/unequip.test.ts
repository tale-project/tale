// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

const { createAuditLog, detachSkillFromAgents } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit-1'),
  detachSkillFromAgents: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../projects/service.ts', () => ({ detachSkillFromAgents }));

import { unequipDeletedSkill } from './unequip.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const tx = {} as TransactionSql;

describe('unequipDeletedSkill [SKILL-R16]', () => {
  it('detaches the slug from every agent in one transaction and audits the delete with them', async () => {
    detachSkillFromAgents.mockResolvedValueOnce([
      { id: 'agent-1', name: 'Reviewer', projectId: 'project-1' },
    ]);

    await expect(
      unequipDeletedSkill(tx, {
        organizationId: 'org_1',
        slug: 'gone-skill',
        actor: { id: 'user-1', email: 'ada@example.com' },
      }),
    ).resolves.toBe(1);

    expect(detachSkillFromAgents).toHaveBeenCalledWith(
      tx,
      'org_1',
      'gone-skill',
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org_1',
        actorId: 'user-1',
        actorEmail: 'ada@example.com',
        action: 'skill.deleted',
        category: 'skill',
        resourceType: 'skill',
        resourceId: 'gone-skill',
        metadata: {
          detachedAgents: [
            { id: 'agent-1', name: 'Reviewer', projectId: 'project-1' },
          ],
        },
        status: 'success',
      }),
    );
  });

  it('still audits a delete that touched no agent', async () => {
    detachSkillFromAgents.mockResolvedValueOnce([]);
    await expect(
      unequipDeletedSkill(tx, {
        organizationId: 'org_1',
        slug: 'lonely',
        actor: { id: 'user-1' },
      }),
    ).resolves.toBe(0);
    expect(createAuditLog).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({
        action: 'skill.deleted',
        metadata: { detachedAgents: [] },
      }),
    );
  });
});
