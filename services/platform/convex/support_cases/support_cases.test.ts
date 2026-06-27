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
    expect(list.map((c) => c._id)).toContain(caseId);

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
    expect(list).toEqual([]);
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
    expect(escalated.map((c) => c._id)).toContain(caseId);
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
