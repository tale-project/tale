import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

/**
 * #2013 regression: `cancelExecution` must reject with a structured
 * `ConvexError({ code })` so the run/debug UI can surface a specific message. A
 * raw `Error` is redacted to "Server Error" in prod, where the client has no way
 * to tell a not-found from a wrong-state rejection. Mirrors the sibling
 * `slug_mutations_error_codes.test.ts` harness (#2056).
 *
 * End-to-end through the real mutation + db: identity via withIdentity, org
 * membership via a seeded `memberMirror` row (the local-table fast path that
 * RLS reads before any Better Auth round-trip).
 */

const TEST_DIR_FROM_CONVEX_ROOT = 'workflow_executions';
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

const ORG = 'org_execguard';
const USER_ID = 'user_exec';
const IDENTITY = {
  subject: USER_ID,
  email: 'exec@example.com',
  name: 'Exec Tester',
};

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
      memberId: 'member_exec',
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedExecution(
  t: ReturnType<typeof newConvexTest>,
  status: 'completed' | 'running',
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('wfExecutions', {
      organizationId: ORG,
      wfDefinitionId: 'flow',
      status,
      currentStepSlug: 'start',
      startedAt: 0,
      updatedAt: 0,
    });
  });
}

describe('cancelExecution error codes (#2013)', () => {
  let t: ReturnType<typeof newConvexTest>;

  beforeEach(async () => {
    t = newConvexTest();
    await seedMember(t);
  });

  it('throws EXECUTION_NOT_FOUND when the execution no longer exists', async () => {
    // Insert then delete so the id is well-formed but resolves to null.
    const executionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('wfExecutions', {
        organizationId: ORG,
        wfDefinitionId: 'flow',
        status: 'running',
        currentStepSlug: 'start',
        startedAt: 0,
        updatedAt: 0,
      });
      await ctx.db.delete(id);
      return id;
    });

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(api.workflow_executions.mutations.cancelExecution, {
          executionId,
        }),
    );
    expect(code).toBe('EXECUTION_NOT_FOUND');
  });

  it('throws EXECUTION_NOT_CANCELABLE for an execution in a terminal state', async () => {
    const executionId = await seedExecution(t, 'completed');

    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .mutation(api.workflow_executions.mutations.cancelExecution, {
          executionId,
        }),
    );
    expect(code).toBe('EXECUTION_NOT_CANCELABLE');
  });
});
