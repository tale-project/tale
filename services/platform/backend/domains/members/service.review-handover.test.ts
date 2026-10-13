// @vitest-environment node

/**
 * A role change that takes a person's project edit access takes the reviews
 * waiting on them with it, so `updateMemberRole` hands them on in the same
 * transaction, once the new role is written (the check reads the role it was
 * just given). A removal does the same through the membership cascade, which
 * SCIM and the sign-in handler's hook share
 * (`auth/membership.cascade.test.ts`).
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { retargetPendingTaskReviewsForUser } from '../tasks/reviews.ts';
import { updateMemberRole } from './service.ts';

vi.mock('../tasks/reviews.ts', () => ({
  retargetPendingTaskReviewsForUser: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ logSuccess: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const ORG_ID = 'org-under-test';
const CALLER_ID = 'user-caller';
const TARGET_USER_ID = 'user-target';
const TARGET_MEMBER_ID = 'member-target';

/** What happened, in order: statements and the hand-over. */
let timeline: string[] = [];

function recordingTx(targetRole: string): TransactionSql {
  const answer = (text: string): unknown[] => {
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role", "createdAt"',
      )
    ) {
      return [
        {
          id: TARGET_MEMBER_ID,
          organizationId: ORG_ID,
          userId: TARGET_USER_ID,
          role: targetRole,
          createdAt: '2026-01-01',
        },
      ];
    }
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role" FROM "member"',
      )
    ) {
      return [
        {
          id: 'member-caller',
          organizationId: ORG_ID,
          userId: CALLER_ID,
          role: 'admin',
        },
      ];
    }
    if (text.startsWith('SELECT "metadata" FROM "organization"')) {
      return [{ metadata: null }];
    }
    if (text.startsWith('SELECT count(*)::text AS count FROM "member"')) {
      return [{ count: '2' }];
    }
    return [];
  };
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    timeline.push(text);
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return tag as unknown as TransactionSql;
}

beforeEach(() => {
  timeline = [];
  vi.mocked(retargetPendingTaskReviewsForUser)
    .mockReset()
    .mockImplementation(() => {
      timeline.push('hand over');
      return Promise.resolve();
    });
});

describe('updateMemberRole — the reviews waiting on the member [TASK-R39]', () => {
  it.each([
    ['editor', 'member'],
    ['developer', 'disabled'],
    ['admin', 'editor'],
    ['member', 'editor'],
  ])(
    'hands them on after a change from %s to %s is written',
    async (from, to) => {
      const tx = recordingTx(from);
      await updateMemberRole(
        tx,
        { userId: CALLER_ID },
        { memberId: TARGET_MEMBER_ID, role: to },
      );

      expect(retargetPendingTaskReviewsForUser).toHaveBeenCalledTimes(1);
      expect(retargetPendingTaskReviewsForUser).toHaveBeenCalledWith(tx, {
        organizationId: ORG_ID,
        userId: TARGET_USER_ID,
        cause: 'role_changed',
      });
      // The check reads the role it was just given, so it runs after it.
      expect(timeline.indexOf('hand over')).toBeGreaterThan(
        timeline.findIndex((text) =>
          text.startsWith('UPDATE "member" SET "role"'),
        ),
      );
    },
  );

  it('leaves the reviews alone when the role does not change', async () => {
    const tx = recordingTx('editor');
    await updateMemberRole(
      tx,
      { userId: CALLER_ID },
      { memberId: TARGET_MEMBER_ID, role: 'editor' },
    );
    expect(retargetPendingTaskReviewsForUser).not.toHaveBeenCalled();
  });

  it('writes no role and hands nothing on when the change is refused', async () => {
    const tx = recordingTx('owner');
    await expect(
      updateMemberRole(
        tx,
        { userId: CALLER_ID },
        { memberId: TARGET_MEMBER_ID, role: 'member' },
      ),
    ).rejects.toMatchObject({ code: 'MEMBER_OWNER_ROLE_IMMUTABLE' });
    expect(retargetPendingTaskReviewsForUser).not.toHaveBeenCalled();
    expect(timeline.some((text) => text.startsWith('UPDATE'))).toBe(false);
  });
});
