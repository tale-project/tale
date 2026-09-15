// @vitest-environment node

/**
 * `removeMembershipCascade` ends a member's platform capabilities with the
 * membership. A capability grant (`tale:…` in the competence register)
 * delegates a right the membership carried; left live, a re-add — through
 * the members door, or SCIM's next POST re-attaching the existing user —
 * would bring the right back without an admin granting it again. The grants
 * are stamped revoked, never deleted: the register is the trail.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { PLATFORM_CAPABILITY_PREFIX } from '../domains/governance/competence.ts';
import { removeMembershipCascade } from './membership.ts';

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

describe('removeMembershipCascade — platform capabilities', () => {
  it('revokes the member’s live capability grants in this organization and keeps the rows', async () => {
    const { tx, statements } = fakeTx();
    const before = Date.now();
    await removeMembershipCascade(tx, 'org-1', 'u-1');

    const revoke = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.competence_records'),
    );
    expect(revoke?.text).toContain(
      "SET revoked_at_ms = ?, revoked_by = 'system' WHERE org_id = ? AND user_id = ? AND revoked_at_ms IS NULL",
    );
    // Exactly the reserved namespace the register refuses to extend — an
    // organization's own review competences are left as they are.
    expect(revoke?.text).toContain(
      `AND competence LIKE '${PLATFORM_CAPABILITY_PREFIX}%'`,
    );
    expect(revoke?.values).toEqual([expect.any(Number), 'org-1', 'u-1']);
    expect(Number(revoke?.values[0])).toBeGreaterThanOrEqual(before);
    expect(
      statements.some((statement) =>
        statement.text.includes('DELETE FROM app.competence_records'),
      ),
    ).toBe(false);
  });
});
