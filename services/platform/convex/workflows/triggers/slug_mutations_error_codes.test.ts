import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../_generated/api';
import schema from '../../schema';

/**
 * #2056 regression: the automation-trigger mutations must reject with a
 * structured `ConvexError({ code })` so the event/schedule dialogs can surface a
 * specific message. A raw `Error` is redacted to "Server Error" in prod, where
 * the dialogs fall back to a single generic toast for every failure.
 *
 * End-to-end through the real mutation + db: identity via withIdentity, org
 * membership via a seeded `memberMirror` row (the local-table fast path that
 * `getOrganizationMember` reads before any Better Auth round-trip). These
 * mutations use no rate limiter, so no component plumbing is needed.
 */

const TEST_DIR_FROM_CONVEX_ROOT = 'workflows/triggers';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_trigguard';
const USER_ID = 'user_trig';
const IDENTITY = {
  subject: USER_ID,
  email: 'trig@example.com',
  name: 'Trigger Tester',
};
const VALID_EVENT = 'discussion.created';

function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = (err as { data: unknown }).data;
  // convex-test can double-encode the payload (a JSON string of a JSON string).
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = (data as { code: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return codeOf(err);
  }
  return undefined;
}

function newConvexTest() {
  return convexTest(schema, modules);
}

async function seedMember(t: ReturnType<typeof newConvexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      organizationId: ORG,
      userId: USER_ID,
      memberId: 'member_trig',
      role: 'member',
      createdAt: 0,
    });
  });
}

describe('automation-trigger mutation error codes (#2056)', () => {
  let t: ReturnType<typeof newConvexTest>;

  beforeEach(async () => {
    t = newConvexTest();
    await seedMember(t);
  });

  it('throws UNAUTHENTICATED when no identity is present', async () => {
    const code = await catchCode(() =>
      t.mutation(api.workflows.triggers.slug_mutations.createScheduleBySlug, {
        organizationId: ORG,
        workflowSlug: 'flow',
        cronExpression: '0 * * * *',
        timezone: 'UTC',
      }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('throws INVALID_SLUG for a malformed workflow slug', async () => {
    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(api.workflows.triggers.slug_mutations.createScheduleBySlug, {
          organizationId: ORG,
          // `__` is the reserved URL separator — never valid inside a slug.
          workflowSlug: 'bad__slug',
          cronExpression: '0 * * * *',
          timezone: 'UTC',
        }),
    );
    expect(code).toBe('INVALID_SLUG');
  });

  it('throws NOT_INSTALLED when scheduling a workflow that is not installed', async () => {
    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(api.workflows.triggers.slug_mutations.createScheduleBySlug, {
          organizationId: ORG,
          workflowSlug: 'never-installed',
          cronExpression: '0 * * * *',
          timezone: 'UTC',
        }),
    );
    expect(code).toBe('NOT_INSTALLED');
  });

  it('throws NOT_FOUND when updating a schedule that no longer exists', async () => {
    // Insert then delete so the id is well-formed but resolves to null.
    const scheduleId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('wfSchedules', {
        organizationId: ORG,
        workflowSlug: 'flow',
        cronExpression: '0 * * * *',
        timezone: 'UTC',
        isActive: true,
        createdAt: 0,
        createdBy: USER_ID,
      });
      await ctx.db.delete(id);
      return id;
    });

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(api.workflows.triggers.slug_mutations.updateScheduleBySlug, {
          scheduleId,
          cronExpression: '5 * * * *',
          timezone: 'UTC',
        }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('throws AUTOMATION_OWNED_WORKFLOW when subscribing an app-owned workflow to events', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('wfInstallations', {
        organizationId: ORG,
        workflowSlug: 'issue-desk/flow',
        automationSlug: 'issue-desk', // recorded ownership → app-owned
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
      });
    });

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(
          api.workflows.triggers.slug_mutations.createEventSubscriptionBySlug,
          {
            organizationId: ORG,
            workflowSlug: 'issue-desk/flow',
            eventType: VALID_EVENT,
          },
        ),
    );
    expect(code).toBe('AUTOMATION_OWNED_WORKFLOW');
  });

  it('throws INVALID_EVENT_TYPE for an unknown event type', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('wfInstallations', {
        organizationId: ORG,
        workflowSlug: 'flow-y',
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
      });
    });

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(
          api.workflows.triggers.slug_mutations.createEventSubscriptionBySlug,
          {
            organizationId: ORG,
            workflowSlug: 'flow-y',
            eventType: 'totally.madeup',
          },
        ),
    );
    expect(code).toBe('INVALID_EVENT_TYPE');
  });

  it('throws DUPLICATE_SUBSCRIPTION when the workflow already subscribes to that event', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('wfInstallations', {
        organizationId: ORG,
        workflowSlug: 'flow-z',
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
      });
      await ctx.db.insert('wfEventSubscriptions', {
        organizationId: ORG,
        workflowSlug: 'flow-z',
        eventType: VALID_EVENT,
        isActive: true,
        createdAt: 0,
        createdBy: USER_ID,
      });
    });

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(
          api.workflows.triggers.slug_mutations.createEventSubscriptionBySlug,
          {
            organizationId: ORG,
            workflowSlug: 'flow-z',
            eventType: VALID_EVENT,
          },
        ),
    );
    expect(code).toBe('DUPLICATE_SUBSCRIPTION');
  });
});
