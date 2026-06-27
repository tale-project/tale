import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { supportCaseRowValidator } from './queries';
import { supportCasesTable } from './schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/support_cases/), mirroring tasks/queries.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'support_cases';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_support';
const USER = 'user_support';
const OTHER = 'user_outsider';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: 'm_support',
      userId: USER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function openCase(
  t: TestConvex<typeof schema>,
  subject = 'Cannot log in',
): Promise<Id<'supportCases'>> {
  const asUser = t.withIdentity({ subject: USER });
  const { caseId } = await asUser.mutation(
    api.support_cases.mutations.createCase,
    { organizationId: ORG, subject },
  );
  return caseId;
}

// Convex return-validation is STRICT: a field stored on a case but missing from
// the row validator throws at runtime (the empty-list failure mode documented
// in tasks/queries.test.ts). Assert validator ⊇ schema so that drift is caught
// the moment a new schema field lands without the validator.
describe('supportCaseRowValidator', () => {
  it('covers every supportCasesTable field', () => {
    const schemaFields = Object.keys(supportCasesTable.validator.fields);
    const validatorFields = new Set(
      Object.keys(supportCaseRowValidator.fields),
    );
    const missing = schemaFields.filter((f) => !validatorFields.has(f));
    expect(missing).toEqual([]);
  });
});

describe('createCase / listCases / getCase', () => {
  it('opens a case, lists it, and reads it back (org member)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);

    const asUser = t.withIdentity({ subject: USER });
    const got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.status).toBe('open');
    expect(got?.escalationLevel).toBe(0);
    expect(got?.commentCount).toBe(0);

    const list = await asUser.query(api.support_cases.queries.listCases, {
      organizationId: ORG,
    });
    expect(list.cases.map((c) => c._id)).toContain(caseId);
    expect(list.truncated).toBe(false);

    // The creation activity row is recorded.
    const activity = await asUser.query(
      api.support_cases.queries.listCaseActivity,
      { organizationId: ORG, caseId },
    );
    expect(activity.map((a) => a.action)).toContain('created');
  });

  it('rejects a non-member and returns empty reads for them', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await openCase(t);

    const asOutsider = t.withIdentity({ subject: OTHER });
    await expect(
      asOutsider.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'nope',
      }),
    ).rejects.toThrow();
    const list = await asOutsider.query(api.support_cases.queries.listCases, {
      organizationId: ORG,
    });
    expect(list.cases).toEqual([]);
    expect(list.truncated).toBe(false);
  });

  it('rejects an empty subject', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const asUser = t.withIdentity({ subject: USER });
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: '   ',
      }),
    ).rejects.toThrow();
  });

  it('rejects a half-specified assignee (type/id must be set together)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const asUser = t.withIdentity({ subject: USER });
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'Lonely assignee type',
        assigneeType: 'user',
      }),
    ).rejects.toThrow();
  });

  it('rejects a customerId that belongs to another organization', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    // A customer in a DIFFERENT org must not be linkable from ORG's case.
    const foreignCustomerId = await t.run(async (ctx) =>
      ctx.db.insert('customers', {
        organizationId: 'org_other',
        name: 'Foreign Co',
        source: 'manual_import',
      }),
    );
    const asUser = t.withIdentity({ subject: USER });
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'Cross-org link attempt',
        customerId: foreignCustomerId,
      }),
    ).rejects.toThrow();
  });

  it('rejects free-text inputs that exceed their length caps', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const asUser = t.withIdentity({ subject: USER });

    // Over-long subject.
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'x'.repeat(201),
      }),
    ).rejects.toThrow();
    // Over-long description.
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'Valid subject',
        description: 'x'.repeat(20_001),
      }),
    ).rejects.toThrow();
    // Over-long requester email / name.
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'Valid subject',
        requesterEmail: 'x'.repeat(321),
      }),
    ).rejects.toThrow();
    await expect(
      asUser.mutation(api.support_cases.mutations.createCase, {
        organizationId: ORG,
        subject: 'Valid subject',
        requesterName: 'x'.repeat(201),
      }),
    ).rejects.toThrow();
  });

  it('never surfaces another org’s cases in listCases (org isolation)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    // Seed a second org with its own member + case.
    const OTHER_ORG = 'org_other';
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: 'm_other',
        userId: OTHER,
        organizationId: OTHER_ORG,
        role: 'member',
        createdAt: 0,
      });
    });
    const asOther = t.withIdentity({ subject: OTHER });
    const { caseId: otherOrgCaseId } = await asOther.mutation(
      api.support_cases.mutations.createCase,
      { organizationId: OTHER_ORG, subject: 'Other org case' },
    );
    const ourCaseId = await openCase(t);

    const asUser = t.withIdentity({ subject: USER });
    const list = await asUser.query(api.support_cases.queries.listCases, {
      organizationId: ORG,
    });
    const ids = list.cases.map((c) => c._id);
    expect(ids).toContain(ourCaseId);
    expect(ids).not.toContain(otherOrgCaseId);

    // And a direct fetch across the boundary returns null, not the row.
    const leaked = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId: otherOrgCaseId,
    });
    expect(leaked).toBeNull();
  });
});

describe('updateCase', () => {
  it('changes status, stamps lifecycle timestamps, and logs activity', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'resolved',
    });
    let got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.status).toBe('resolved');
    expect(got?.resolvedAt).toBeTypeOf('number');

    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'closed',
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.status).toBe('closed');
    expect(got?.closedAt).toBeTypeOf('number');

    // Reopening clears the terminal timestamps.
    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'open',
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.status).toBe('open');
    expect(got?.resolvedAt).toBeUndefined();
    expect(got?.closedAt).toBeUndefined();

    const activity = await asUser.query(
      api.support_cases.queries.listCaseActivity,
      { organizationId: ORG, caseId },
    );
    expect(activity.filter((a) => a.action === 'status_changed').length).toBe(
      3,
    );
  });

  it('clears the stale closedAt when a closed case is resolved', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'closed',
    });
    let got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.closedAt).toBeTypeOf('number');

    // closed → resolved must drop the terminal closedAt so SLA reporting is
    // honest (the case is no longer closed).
    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'resolved',
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.status).toBe('resolved');
    expect(got?.resolvedAt).toBeTypeOf('number');
    expect(got?.closedAt).toBeUndefined();
  });

  it('assigns and unassigns, logging each change', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      assignee: { type: 'user', id: USER },
    });
    let got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.assigneeId).toBe(USER);
    expect(got?.assigneeType).toBe('user');

    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      assignee: { type: 'none' },
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.assigneeId).toBeUndefined();
    expect(got?.assigneeType).toBeUndefined();
  });
});

describe('escalateCase', () => {
  it('bumps the escalation level and records an internal note', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    const r1 = await asUser.mutation(api.support_cases.mutations.escalateCase, {
      organizationId: ORG,
      caseId,
      note: 'Customer is a VIP',
    });
    expect(r1.escalationLevel).toBe(1);

    const r2 = await asUser.mutation(api.support_cases.mutations.escalateCase, {
      organizationId: ORG,
      caseId,
    });
    expect(r2.escalationLevel).toBe(2);

    const got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.escalationLevel).toBe(2);
    expect(got?.status).toBe('open'); // escalation is orthogonal to status

    // The note landed as an internal comment, hidden from the customer view.
    const staffView = await asUser.query(
      api.support_cases.queries.listCaseComments,
      { organizationId: ORG, caseId },
    );
    expect(staffView.length).toBe(1);
    expect(staffView[0].internal).toBe(true);
    const customerView = await asUser.query(
      api.support_cases.queries.listCaseComments,
      { organizationId: ORG, caseId, includeInternal: false },
    );
    expect(customerView.length).toBe(0);

    // escalatedOnly filter surfaces it.
    const escalated = await asUser.query(api.support_cases.queries.listCases, {
      organizationId: ORG,
      escalatedOnly: true,
    });
    expect(escalated.cases.map((c) => c._id)).toContain(caseId);
  });

  it('rejects an over-long escalation note', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });
    await expect(
      asUser.mutation(api.support_cases.mutations.escalateCase, {
        organizationId: ORG,
        caseId,
        note: 'x'.repeat(10_001),
      }),
    ).rejects.toThrow();
  });

  it('refuses to escalate a closed case', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });
    await asUser.mutation(api.support_cases.mutations.updateCase, {
      organizationId: ORG,
      caseId,
      status: 'closed',
    });
    await expect(
      asUser.mutation(api.support_cases.mutations.escalateCase, {
        organizationId: ORG,
        caseId,
      }),
    ).rejects.toThrow();
  });
});

describe('comments', () => {
  it('adds a public reply (sets first-response), edits and deletes it', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    const { commentId } = await asUser.mutation(
      api.support_cases.mutations.addComment,
      { organizationId: ORG, caseId, body: 'Working on it.' },
    );
    let got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.commentCount).toBe(1);
    expect(got?.firstRespondedAt).toBeTypeOf('number');

    await asUser.mutation(api.support_cases.mutations.editComment, {
      organizationId: ORG,
      commentId,
      body: 'Working on it now.',
    });
    const comments = await asUser.query(
      api.support_cases.queries.listCaseComments,
      { organizationId: ORG, caseId },
    );
    expect(comments[0].body).toBe('Working on it now.');
    expect(comments[0].editedAt).toBeTypeOf('number');

    await asUser.mutation(api.support_cases.mutations.deleteComment, {
      organizationId: ORG,
      commentId,
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.commentCount).toBe(0);
  });

  it('does not stamp first-response for an internal-only note', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.support_cases.mutations.addComment, {
      organizationId: ORG,
      caseId,
      body: 'Internal triage note',
      internal: true,
    });
    let got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    // An internal note is staff-only and must NOT count as the first response.
    expect(got?.firstRespondedAt).toBeUndefined();
    expect(got?.commentCount).toBe(1);

    // The first PUBLIC reply is what stamps the SLA milestone.
    await asUser.mutation(api.support_cases.mutations.addComment, {
      organizationId: ORG,
      caseId,
      body: 'Hello, looking into this.',
    });
    got = await asUser.query(api.support_cases.queries.getCase, {
      organizationId: ORG,
      caseId,
    });
    expect(got?.firstRespondedAt).toBeTypeOf('number');
  });

  it('does not let a non-author delete a comment', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: 'm_support2',
        userId: OTHER,
        organizationId: ORG,
        role: 'member',
        createdAt: 0,
      });
    });
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });
    const { commentId } = await asUser.mutation(
      api.support_cases.mutations.addComment,
      { organizationId: ORG, caseId, body: 'mine to delete' },
    );

    const asOther = t.withIdentity({ subject: OTHER });
    await expect(
      asOther.mutation(api.support_cases.mutations.deleteComment, {
        organizationId: ORG,
        commentId,
      }),
    ).rejects.toThrow();
  });

  it('rejects an empty comment and an over-long one', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });

    await expect(
      asUser.mutation(api.support_cases.mutations.addComment, {
        organizationId: ORG,
        caseId,
        body: '   ',
      }),
    ).rejects.toThrow();
    await expect(
      asUser.mutation(api.support_cases.mutations.addComment, {
        organizationId: ORG,
        caseId,
        body: 'x'.repeat(10_001),
      }),
    ).rejects.toThrow();
  });

  it('does not let a non-author edit a comment', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    // A second member of the same org.
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: 'm_support2',
        userId: OTHER,
        organizationId: ORG,
        role: 'member',
        createdAt: 0,
      });
    });
    const caseId = await openCase(t);
    const asUser = t.withIdentity({ subject: USER });
    const { commentId } = await asUser.mutation(
      api.support_cases.mutations.addComment,
      { organizationId: ORG, caseId, body: 'mine' },
    );

    const asOther = t.withIdentity({ subject: OTHER });
    await expect(
      asOther.mutation(api.support_cases.mutations.editComment, {
        organizationId: ORG,
        commentId,
        body: 'hijacked',
      }),
    ).rejects.toThrow();
  });
});
