// @vitest-environment node

/**
 * `removeMembershipCascade` ends every competence grant with the
 * membership. A capability grant (`tale:…` in the competence register)
 * delegates a right the membership carried, and a qualification gates who
 * may approve a review; left live, a re-add — through the members door, or
 * SCIM's next POST re-attaching the existing user — would bring the right
 * back without an admin granting it again. The grants are stamped revoked,
 * never deleted: the register is the trail.
 */

import type { PgBoss } from 'pg-boss';
import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { recordingSql } from '../domains/agent_connections/test-helpers.ts';
import { installReviewHandoverHook } from '../domains/tasks/reviews.ts';
import { setEnqueueBoss } from '../jobs/enqueue.ts';
import {
  removeMembershipCascade,
  setMembershipAccessLossHook,
} from './membership.ts';

/** Capture what the cascade queues: a stand-in exposing the one method
 * `addJobInTx` calls. */
function installFakeBoss(): { name: string; data: unknown }[] {
  const sends: { name: string; data: unknown }[] = [];
  const fake = {
    send: (name: string, data: unknown) => {
      sends.push({ name, data });
      return Promise.resolve('job-id');
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; addJobInTx only calls send()
  setEnqueueBoss(fake as unknown as PgBoss);
  return sends;
}

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the module-level boss between tests
  setEnqueueBoss(null as unknown as PgBoss);
  setMembershipAccessLossHook(null);
});

function fakeTx(): {
  tx: TransactionSql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { tx: tag as unknown as TransactionSql, statements };
}

describe('removeMembershipCascade — competence grants', () => {
  it('revokes every live grant of the member in this organization and keeps the rows', async () => {
    installFakeBoss();
    const { tx, statements } = fakeTx();
    const before = Date.now();
    await removeMembershipCascade(tx, 'org-1', 'u-1');

    const revoke = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.competence_records'),
    );
    expect(revoke?.text).toContain(
      "SET revoked_at_ms = ?, revoked_by = 'system' WHERE org_id = ? AND user_id = ? AND revoked_at_ms IS NULL",
    );
    // Qualifications go with the capabilities: a review-gating grant that
    // survived the removal re-attached to the person on a re-add.
    expect(revoke?.text).not.toContain('competence LIKE');
    expect(revoke?.values).toEqual([expect.any(Number), 'org-1', 'u-1']);
    expect(Number(revoke?.values[0])).toBeGreaterThanOrEqual(before);
    expect(
      statements.some((statement) =>
        statement.text.includes('DELETE FROM app.competence_records'),
      ),
    ).toBe(false);
  });
});

describe('removeMembershipCascade — coding agents [AGCONN-R4]', () => {
  it('ends the agents the member connected in this organization, for the platform, and no other organization’s', async () => {
    installFakeBoss();
    const { tx, statements } = recordingSql();
    await removeMembershipCascade(tx, 'org-1', 'u-1');
    const ended = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.agent_connections'),
    );
    expect(ended?.values).toEqual([
      expect.any(Number),
      'system',
      'membership_ended',
      'org-1',
      'u-1',
    ]);
  });
});

describe('removeMembershipCascade — waiting reviews [TASK-R39]', () => {
  it('looks for the reviews that wait on the member in this organization only, after their teams are gone', async () => {
    installFakeBoss();
    installReviewHandoverHook();
    const { tx, statements } = fakeTx();
    await removeMembershipCascade(tx, 'org-1', 'u-1');

    const teamsGoneAt = statements.findIndex((statement) =>
      statement.text.startsWith('DELETE FROM "teamMember"'),
    );
    const candidatesAt = statements.findIndex((statement) =>
      statement.text.startsWith(
        'SELECT id, project_id AS "projectId" FROM app.tasks',
      ),
    );
    expect(teamsGoneAt).toBeGreaterThan(-1);
    // Their access is judged on what is left, so it reads after the delete.
    expect(candidatesAt).toBeGreaterThan(teamsGoneAt);
    const candidates = statements[candidatesAt];
    expect(candidates?.text).toContain('reviewer_user_id = ?');
    // The designations and the open requests, both in this organization.
    expect(candidates?.values).toEqual(
      expect.arrayContaining(['org-1', 'u-1']),
    );
    expect(
      candidates?.values.filter((value) => value === 'org-1'),
    ).toHaveLength(2);
  });

  it('hands the installed step the organization, the person who left and the cause, inside the cascade', async () => {
    installFakeBoss();
    const calls: unknown[] = [];
    setMembershipAccessLossHook((_tx, event) => {
      calls.push(event);
      return Promise.resolve();
    });
    const { tx } = fakeTx();
    await removeMembershipCascade(tx, 'org-1', 'u-1');
    expect(calls).toEqual([
      { organizationId: 'org-1', userId: 'u-1', cause: 'member_removed' },
    ]);
  });

  it('runs no hand-over, and still removes the rest, until a step is installed', async () => {
    installFakeBoss();
    const { tx, statements } = fakeTx();
    await removeMembershipCascade(tx, 'org-1', 'u-1');
    expect(
      statements.some((statement) =>
        statement.text.startsWith(
          'SELECT id, project_id AS "projectId" FROM app.tasks',
        ),
      ),
    ).toBe(false);
    expect(
      statements.some((statement) =>
        statement.text.startsWith('DELETE FROM "teamMember"'),
      ),
    ).toBe(true);
  });

  it('fails the cascade when the step fails, so the removal and the hand-over roll back together', async () => {
    installFakeBoss();
    setMembershipAccessLossHook(() =>
      Promise.reject(new Error('hand-over failed')),
    );
    const { tx } = fakeTx();
    await expect(removeMembershipCascade(tx, 'org-1', 'u-1')).rejects.toThrow(
      'hand-over failed',
    );
  });
});

describe('removeMembershipCascade — sandbox workspaces', () => {
  it("queues the deletion of the member's workspaces with the organization's agents", async () => {
    const sends = installFakeBoss();
    const { tx } = fakeTx();
    await removeMembershipCascade(tx, 'org-1', 'u-1');
    expect(sends).toEqual([
      {
        name: 'sandbox.retire_workspaces',
        data: {
          organizationId: 'org-1',
          reason: 'member_removed',
          userId: 'u-1',
        },
      },
    ]);
  });
});
