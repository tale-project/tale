import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

/**
 * #2049 regression: the tasks read-side (`tasks/queries.ts`) must reject with a
 * structured `ConvexError({ code })` so the board/list UI can tell an
 * unauthenticated caller from a missing project. A raw `Error` is redacted to
 * "Server Error" in prod, leaving the client no machine-readable code. Mirrors
 * the sibling `workflow_executions/mutations_error_codes.test.ts` harness.
 *
 * End-to-end through the real query + db: identity is omitted to reach the auth
 * gate, and a well-formed-but-deleted project id reaches the not-found gate.
 */

const TEST_DIR_FROM_CONVEX_ROOT = 'tasks';
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

const ORG = 'org_tasks_queryguard';

function dataOf(err: unknown): Record<string, unknown> | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = err.data;
  // convex-test can double-encode the payload (a JSON string of a JSON string).
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  return data as Record<string, unknown>;
}

function codeOf(err: unknown): string | undefined {
  const candidate: unknown = dataOf(err)?.code;
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

type T = TestConvex<typeof schema>;

function seedProject(t: T, name: string): Promise<Id<'projects'>> {
  return t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe('tasks/queries ConvexError codes (#2049)', () => {
  it('throws UNAUTHENTICATED when no caller identity is present', async () => {
    const t = convexTest(schema, modules);
    // The project exists and is in the caller's active org, so the read clears
    // the project + active-org gates and reaches the auth gate under test.
    const projectId = await seedProject(t, 'Roadmap');

    const code = await catchCode(() =>
      t.query(api.tasks.queries.listExternalKeysByProject, {
        projectId,
        organizationId: ORG,
        externalSystem: 'github',
      }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('throws PROJECT_NOT_FOUND for a well-formed but missing project id', async () => {
    const t = convexTest(schema, modules);
    // Insert then delete so the id is well-formed but resolves to null — the
    // project fetch fails ahead of the auth/active-org gates, so no identity is
    // required to reach this branch.
    const projectId = await seedProject(t, 'Doomed');
    await t.run((ctx) => ctx.db.delete(projectId));

    const code = await catchCode(() =>
      t.query(api.tasks.queries.listExternalKeysByProject, {
        projectId,
        organizationId: ORG,
        externalSystem: 'github',
      }),
    );
    expect(code).toBe('PROJECT_NOT_FOUND');
  });
});
