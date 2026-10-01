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

import { setEnqueueBoss } from '../jobs/enqueue.ts';
import { removeMembershipCascade } from './membership.ts';

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
